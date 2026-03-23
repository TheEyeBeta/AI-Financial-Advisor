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

    return AppSettings(
        environment=environment,
        app_version=os.getenv("APP_VERSION", "0.1.0"),
        cors_origins=parse_csv_env(os.getenv("CORS_ORIGINS")),
        trusted_hosts=parse_csv_env(os.getenv("TRUSTED_HOSTS")),
        enable_debug_routes=is_truthy(os.getenv("ENABLE_DEBUG_ROUTES")) or environment != "production",
    )


def validate_app_settings(settings: AppSettings) -> None:
    if not settings.is_production:
        return

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
