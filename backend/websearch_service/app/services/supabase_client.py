"""Centralised Supabase service-role client.

Import ``supabase_client`` from this module rather than calling
``create_client`` individually in each service.  A single shared instance
means:

  • Key rotation or misconfiguration fails loudly at startup (one clear
    error) rather than silently per-service (hard to diagnose).
  • One set of connection resources instead of N parallel clients.

Usage::

    from .supabase_client import supabase_client, get_schema

    # Shorthand for supabase_client.schema("core")
    result = get_schema("core").table("users").select("id").limit(1).execute()
"""
from __future__ import annotations

import os

from supabase import Client, create_client

_SUPABASE_URL_ENV = "SUPABASE_URL"
_SUPABASE_SERVICE_ROLE_KEY_ENV = "SUPABASE_SERVICE_ROLE_KEY"


def _init_client() -> Client:
    url = (os.getenv(_SUPABASE_URL_ENV) or "").strip()
    key = (os.getenv(_SUPABASE_SERVICE_ROLE_KEY_ENV) or "").strip()

    if not url:
        raise RuntimeError(
            f"FATAL: {_SUPABASE_URL_ENV} is missing or empty. "
            "Set it to your Supabase project URL "
            "(e.g. https://<project-ref>.supabase.co)."
        )
    if not key:
        raise RuntimeError(
            f"FATAL: {_SUPABASE_SERVICE_ROLE_KEY_ENV} is missing or empty. "
            "Set it to the service-role key from your Supabase project settings. "
            "Never use the anon key for backend service operations."
        )

    return create_client(url, key)


#: Module-level singleton — initialised once at import time.
#: The app will refuse to start if the required env vars are absent.
supabase_client: Client = _init_client()


def get_schema(schema_name: str):
    """Return a schema-scoped builder: ``supabase_client.schema(schema_name)``."""
    return supabase_client.schema(schema_name)
