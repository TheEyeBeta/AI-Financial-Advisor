import os
from dataclasses import dataclass
from urllib.parse import urlparse

TRUTHY_VALUES = {"1", "true", "yes", "on"}


def parse_csv_env(value: str | None) -> list[str]:
    return [item.strip() for item in (value or "").split(",") if item.strip()]


def is_truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in TRUTHY_VALUES


def is_valid_origin(origin: str) -> bool:
    try:
        parsed = urlparse(origin)
    except ValueError:
        return False

    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def is_valid_trusted_host(host: str) -> bool:
    return bool(host) and "://" not in host and "/" not in host


@dataclass(frozen=True)
class AppSettings:
    environment: str
    app_version: str
    cors_origins: list[str]
    trusted_hosts: list[str]
    enable_debug_routes: bool

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


def get_app_settings() -> AppSettings:
    environment = (os.getenv("ENVIRONMENT", "development").strip().lower() or "development")
    explicit_debug = os.getenv("ENABLE_DEBUG_ROUTES")
    if explicit_debug is None:
        enable_debug_routes = environment == "development"
    else:
        enable_debug_routes = is_truthy(explicit_debug)

    return AppSettings(
        environment=environment,
        app_version=(
            (os.getenv("APP_VERSION") or "").strip()
            or (os.getenv("RAILWAY_GIT_COMMIT_SHA") or "").strip()
            or "0.1.0"
        ),
        cors_origins=parse_csv_env(os.getenv("CORS_ORIGINS")),
        trusted_hosts=parse_csv_env(os.getenv("TRUSTED_HOSTS")),
        enable_debug_routes=enable_debug_routes,
    )


# Default origins for local development. Production never falls back to these:
# validate_app_settings() requires an explicit CORS_ORIGINS list there.
DEFAULT_DEV_ORIGINS = [
    "http://localhost:8080",   # Vite on custom port (this project)
    "http://localhost:5173",   # Vite default
    "http://localhost:3000",   # CRA / other
    "http://127.0.0.1:8080",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
]


def resolve_allowed_origins(settings: AppSettings | None = None) -> list[str]:
    """Origins allowed for CORS and WebSocket Origin validation."""
    settings = settings or get_app_settings()
    if settings.is_production:
        return list(settings.cors_origins)
    # dict.fromkeys preserves insertion order and deduplicates
    return list(dict.fromkeys(DEFAULT_DEV_ORIGINS + settings.cors_origins))


# Secrets/config that production cannot start without (#210). Optional or
# feature-gated settings (Redis, DataAPI, Tavily/Perplexity, Sentry) are
# deliberately NOT here — their absence degrades a feature, not safety.
REQUIRED_PRODUCTION_ENV = (
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_JWT_SECRET",
    "OPENAI_API_KEY",
)

PLACEHOLDER_MARKERS = (
    "your-",
    "your_",
    "change-me",
    "changeme",
    "placeholder",
    "sk-your",
    "xxxx",
)


def looks_like_placeholder(value: str) -> bool:
    lowered = value.strip().lower()
    return any(marker in lowered for marker in PLACEHOLDER_MARKERS)


def validate_required_production_env() -> None:
    """Fail fast (never at first request) when production config is absent or template junk."""
    missing = [key for key in REQUIRED_PRODUCTION_ENV if not (os.getenv(key) or "").strip()]
    if missing:
        raise RuntimeError(
            "FATAL: Missing required production configuration: "
            f"{', '.join(missing)}. Set these in the deployment environment "
            "(see backend/websearch_service/.env.example for descriptions)."
        )

    placeholder_keys = [
        key for key in REQUIRED_PRODUCTION_ENV if looks_like_placeholder(os.getenv(key) or "")
    ]
    if placeholder_keys:
        raise RuntimeError(
            "FATAL: Production configuration still contains template placeholder "
            f"values for: {', '.join(placeholder_keys)}. Replace them with real values."
        )


def validate_app_settings(settings: AppSettings) -> None:
    if not settings.is_production:
        return

    validate_required_production_env()

    if not settings.cors_origins or "*" in settings.cors_origins:
        raise RuntimeError(
            "FATAL: CORS_ORIGINS must be set to an explicit list of allowed origins in "
            "production (e.g. 'https://yourdomain.com'). Wildcard '*' is not permitted."
        )

    invalid_origins = [origin for origin in settings.cors_origins if not is_valid_origin(origin)]
    if invalid_origins:
        raise RuntimeError(
            f"FATAL: Invalid CORS_ORIGINS value(s): {', '.join(invalid_origins)}. Use comma-separated http(s) origins."
        )

    if not settings.trusted_hosts or "*" in settings.trusted_hosts:
        raise RuntimeError(
            "FATAL: TRUSTED_HOSTS must be set to an explicit list of allowed hostnames in production "
            "(e.g. 'yourdomain.com,api.yourdomain.com'). Wildcard '*' is not permitted."
        )

    invalid_hosts = [host for host in settings.trusted_hosts if not is_valid_trusted_host(host)]
    if invalid_hosts:
        raise RuntimeError(
            f"FATAL: Invalid TRUSTED_HOSTS value(s): {', '.join(invalid_hosts)}. Use bare hostnames only."
        )
