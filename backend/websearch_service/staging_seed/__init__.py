"""Synthetic staging-data seeder and environment-isolation guard.

This package NEVER reads or copies production data. Every row it writes is
generated deterministically from a fixed random seed and is tagged with a
clearly synthetic marker (``synthetic-seed-`` email prefix on the
``staging.invalid`` domain — an IANA-reserved, non-resolvable TLD per
RFC 2606) so it can be reliably cleaned up and can never collide with a real
user.

See ``staging_seed/README.md`` for exact execution commands.
"""

from __future__ import annotations

SYNTHETIC_EMAIL_DOMAIN = "staging.invalid"
SYNTHETIC_EMAIL_PREFIX = "synthetic-seed-"
SYNTHETIC_MARKER = "synthetic-seed-script"

__all__ = [
    "SYNTHETIC_EMAIL_DOMAIN",
    "SYNTHETIC_EMAIL_PREFIX",
    "SYNTHETIC_MARKER",
]
