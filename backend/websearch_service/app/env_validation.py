"""Environment / configuration validator (Phase 12).

A single, side-effect-free validator that inspects an environment mapping and
returns a structured report of misconfigurations, ranked by severity. It is
designed to run in three places:

* application startup (fail-closed on ERROR in production),
* CI ("env-schema validation" job), and
* a deploy pre-flight check.

Safety: this module **never emits secret values**. Findings reference the
offending environment *variable name* and a human reason only — never the
value. Placeholder / denylist checks read values internally but do not surface
them.

It complements (and reuses) the fail-fast checks already in ``app.config`` and
adds the cross-cutting production-safety checks the deployment plan requires:
authentication enabled, debug routes disabled, cost/rate controls that do not
"fail open", Redis presence, AI-model/ceiling sanity, and cross-environment
resource contamination via a configurable denylist.
"""
from __future__ import annotations

import os
from dataclasses import asdict, dataclass
from enum import Enum
from typing import List, Mapping, Optional

from app.config import (
    REQUIRED_PRODUCTION_ENV,
    is_truthy,
    is_valid_origin,
    is_valid_trusted_host,
    looks_like_placeholder,
    parse_csv_env,
)


class Severity(str, Enum):
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


# Deployed environments held to the strict production-safety bar. Development /
# test are lenient (findings downgraded to warnings, startup does not fail).
STRICT_ENVIRONMENTS = frozenset({"production", "staging"})


# Redis connection is read from either of these (see rate_limit_redis.py).
REDIS_URL_ENV = ("RATE_LIMIT_REDIS_URL", "REDIS_URL")

# Truthy flags that silently weaken a safety/cost control and must be OFF in
# production. Enabling any of these makes the app "fail open".
UNSAFE_PROD_TRUTHY_FLAGS = {
    "AI_BUDGET_FAIL_OPEN_ON_REDIS_OUTAGE": (
        "AI budget circuit breaker would fail OPEN on a Redis outage — a "
        "cost-control bypass. Must be false in production."
    ),
    "AI_BUDGET_ALLOW_IN_MEMORY": (
        "AI budget would fall back to per-process memory (not shared across "
        "workers), under-counting spend. Must be false in production."
    ),
    "ALLOW_IN_MEMORY_RATE_LIMIT": (
        "Rate limiter would use per-process memory — bypassable and not shared "
        "across workers. Must be false in production."
    ),
}

# Environment variables that point at external resources; scanned for
# cross-environment contamination against the configurable denylists.
RESOURCE_KEYS = (
    "SUPABASE_URL",
    "RATE_LIMIT_REDIS_URL",
    "REDIS_URL",
    "DATAAPI_URL",
    "DATA_API_BASE_URL",
    "SENTRY_DSN",
)


@dataclass(frozen=True)
class Finding:
    severity: Severity
    code: str
    key: str  # environment variable name — never its value
    message: str

    def to_dict(self) -> dict:
        d = asdict(self)
        d["severity"] = self.severity.value
        return d


@dataclass
class ValidationReport:
    environment: str
    findings: List[Finding]

    @property
    def errors(self) -> List[Finding]:
        return [f for f in self.findings if f.severity is Severity.ERROR]

    @property
    def warnings(self) -> List[Finding]:
        return [f for f in self.findings if f.severity is Severity.WARNING]

    @property
    def infos(self) -> List[Finding]:
        return [f for f in self.findings if f.severity is Severity.INFO]

    @property
    def ok(self) -> bool:
        """True when there are no ERROR-level findings."""
        return not self.errors

    def to_dict(self) -> dict:
        return {
            "environment": self.environment,
            "ok": self.ok,
            "counts": {
                "error": len(self.errors),
                "warning": len(self.warnings),
                "info": len(self.infos),
            },
            "findings": [f.to_dict() for f in self.findings],
        }

    def format_text(self) -> str:
        """Redacted, human-readable summary (no secret values)."""
        lines = [
            f"Environment: {self.environment}",
            f"Result: {'PASS' if self.ok else 'FAIL'} "
            f"({len(self.errors)} error, {len(self.warnings)} warning, {len(self.infos)} info)",
        ]
        for f in self.findings:
            lines.append(f"  [{f.severity.value.upper():7}] {f.key}: {f.message}")
        return "\n".join(lines)


def validate_environment(env: Optional[Mapping[str, str]] = None) -> ValidationReport:
    """Validate an environment mapping and return a structured report."""
    env = os.environ if env is None else env
    environment = (env.get("ENVIRONMENT", "development") or "development").strip().lower()
    is_prod = environment == "production"
    # Safety checks apply to every deployed environment (production AND staging).
    strict = environment in STRICT_ENVIRONMENTS

    findings: List[Finding] = []

    def add(severity: Severity, code: str, key: str, message: str) -> None:
        findings.append(Finding(severity, code, key, message))

    # 1) Required production configuration present and not placeholder junk.
    for key in REQUIRED_PRODUCTION_ENV:
        value = (env.get(key) or "").strip()
        if not value:
            add(
                Severity.ERROR if strict else Severity.WARNING,
                "missing_required",
                key,
                "required configuration is not set",
            )
        elif looks_like_placeholder(value):
            add(
                Severity.ERROR if strict else Severity.WARNING,
                "placeholder_value",
                key,
                "still contains a template placeholder value",
            )

    # 2) Authentication must be enabled in production.
    auth_required = env.get("AUTH_REQUIRED")
    if strict:
        if auth_required is None:
            add(Severity.WARNING, "auth_unset", "AUTH_REQUIRED",
                "not explicitly set; production must default to enabled")
        elif not is_truthy(auth_required):
            add(Severity.ERROR, "auth_disabled", "AUTH_REQUIRED",
                "authentication is DISABLED in production")

    # 3) Debug routes must be disabled in production.
    debug = env.get("ENABLE_DEBUG_ROUTES")
    if strict and debug is not None and is_truthy(debug):
        add(Severity.ERROR, "debug_routes_enabled", "ENABLE_DEBUG_ROUTES",
            "debug routes must be disabled in production")

    # 4) CORS origins: explicit, non-wildcard, valid (production only).
    cors = parse_csv_env(env.get("CORS_ORIGINS"))
    if strict:
        if not cors or "*" in cors:
            add(Severity.ERROR, "cors_wildcard_or_empty", "CORS_ORIGINS",
                "must be an explicit, non-wildcard list in production")
        else:
            invalid = [o for o in cors if not is_valid_origin(o)]
            if invalid:
                add(Severity.ERROR, "cors_invalid", "CORS_ORIGINS",
                    f"{len(invalid)} invalid origin value(s)")

    # 5) Trusted hosts: explicit, non-wildcard, valid (production only).
    hosts = parse_csv_env(env.get("TRUSTED_HOSTS"))
    if strict:
        if not hosts or "*" in hosts:
            add(Severity.ERROR, "trusted_hosts_wildcard_or_empty", "TRUSTED_HOSTS",
                "must be an explicit, non-wildcard list in production")
        else:
            invalid = [h for h in hosts if not is_valid_trusted_host(h)]
            if invalid:
                add(Severity.ERROR, "trusted_hosts_invalid", "TRUSTED_HOSTS",
                    f"{len(invalid)} invalid host value(s)")

    # 6) Cost/rate controls must not "fail open" in production.
    for key, why in UNSAFE_PROD_TRUTHY_FLAGS.items():
        value = env.get(key)
        if strict and value is not None and is_truthy(value):
            add(Severity.ERROR, "unsafe_flag_enabled", key, why)

    # 7) Redis must be configured in production (shared rate-limit / budget)
    #    unless an in-memory fallback is explicitly (and unsafely) allowed.
    has_redis = any((env.get(k) or "").strip() for k in REDIS_URL_ENV)
    if strict and not has_redis and not is_truthy(env.get("ALLOW_IN_MEMORY_RATE_LIMIT")):
        add(Severity.WARNING, "redis_missing", "REDIS_URL",
            "no Redis URL configured; production rate limiting and budget "
            "controls need a shared Redis")

    # 8) AI model configuration.
    if not (env.get("OPENAI_CHAT_MODEL") or env.get("OPENAI_MODEL") or "").strip():
        add(Severity.INFO, "ai_model_default", "OPENAI_CHAT_MODEL",
            "not set; falling back to the in-code default model")

    # 9) Output-token ceiling sanity (Phase 2 depends on a positive ceiling).
    raw_ceiling = env.get("OPENAI_MAX_TOKENS")
    if raw_ceiling is not None and raw_ceiling.strip():
        try:
            if int(raw_ceiling.strip()) <= 0:
                add(Severity.ERROR, "invalid_max_tokens", "OPENAI_MAX_TOKENS",
                    "must be a positive integer output-token ceiling")
        except ValueError:
            add(Severity.ERROR, "invalid_max_tokens", "OPENAI_MAX_TOKENS",
                "must be an integer")

    # 10) Cross-environment resource contamination (configurable, value-safe).
    prod_denylist = parse_csv_env(env.get("PRODUCTION_RESOURCE_DENYLIST"))
    staging_denylist = parse_csv_env(env.get("STAGING_RESOURCE_DENYLIST"))
    if not is_prod and prod_denylist:
        for key in RESOURCE_KEYS:
            value = (env.get(key) or "").lower()
            if value and any(marker.lower() in value for marker in prod_denylist):
                add(Severity.ERROR, "production_resource_in_nonprod", key,
                    f"references a production resource marker while ENVIRONMENT={environment}")
    if is_prod and staging_denylist:
        for key in RESOURCE_KEYS:
            value = (env.get(key) or "").lower()
            if value and any(marker.lower() in value for marker in staging_denylist):
                add(Severity.ERROR, "staging_resource_in_prod", key,
                    "references a staging resource marker while ENVIRONMENT=production")

    return ValidationReport(environment=environment, findings=findings)


# Finding codes that MUST fail startup in a strict (deployed) environment.
# The Redis-dependent flags (``unsafe_flag_enabled`` / ``redis_missing``) are
# intentionally excluded: the app's dedicated ``validate_rate_limit_configuration``
# and ``validate_ai_budget_configuration`` already own that policy — production
# refuses to start without Redis unless an explicit single-worker-beta opt-in is
# set. Those remain ERROR findings in the audit report and are logged as SECURITY
# warnings at startup, so they are never silent. Flip them into this set to make
# the opt-in impossible once Redis is provisioned.
STARTUP_FATAL_CODES = frozenset({
    "missing_required",
    "placeholder_value",
    "auth_disabled",
    "debug_routes_enabled",
    "cors_wildcard_or_empty",
    "cors_invalid",
    "trusted_hosts_wildcard_or_empty",
    "trusted_hosts_invalid",
    "production_resource_in_nonprod",
    "staging_resource_in_prod",
    "invalid_max_tokens",
})


def enforce_startup_environment(env: Optional[Mapping[str, str]] = None) -> ValidationReport:
    """Run at application startup.

    In a strict (deployed) environment, ERROR findings whose code is in
    ``STARTUP_FATAL_CODES`` raise ``RuntimeError`` so the process fails fast
    rather than serving traffic with unsafe config. Redis-dependent flag findings
    are logged as SECURITY warnings (their policy is owned by the dedicated
    rate-limit / budget validators). Development/test never raise. Never emits
    secret values — only offending variable names + reasons.
    """
    import logging

    logger = logging.getLogger("app.env_validation")
    report = validate_environment(env)
    strict = report.environment in STRICT_ENVIRONMENTS

    if strict:
        fatal = [f for f in report.errors if f.code in STARTUP_FATAL_CODES]
        if fatal:
            summary = "; ".join(f"{f.key}: {f.message}" for f in fatal)
            raise RuntimeError(
                f"FATAL: unsafe {report.environment} configuration — refusing to start. "
                f"{len(fatal)} blocking error(s): {summary}"
            )
        # Non-blocking ERROR findings (deferred to dedicated service validators).
        for finding in report.errors:
            if finding.code not in STARTUP_FATAL_CODES:
                logger.error("SECURITY: env-validation flagged %s — %s", finding.key, finding.message)

    for finding in report.warnings:
        logger.warning("env-validation: %s — %s", finding.key, finding.message)
    return report


def main(argv: Optional[List[str]] = None) -> int:
    """CLI entry point. Prints a redacted report; exits non-zero on ERROR."""
    import argparse
    import json

    parser = argparse.ArgumentParser(description="Validate runtime environment configuration.")
    parser.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    args = parser.parse_args(argv)

    report = validate_environment()
    if args.json:
        print(json.dumps(report.to_dict(), indent=2))
    else:
        print(report.format_text())
    return 0 if report.ok else 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
