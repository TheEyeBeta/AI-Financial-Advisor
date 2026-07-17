"""Deterministic synthetic-data generation.

Everything here is derived from a single integer seed via ``random.Random``
plus fixed word lists. The same seed always produces the same values, and
every entity id is a UUIDv5 derived from ``(seed, kind, index)`` — so
re-running the seeder against a target that already has these rows is a
no-op (see ``seeder.py``'s ``ON CONFLICT DO NOTHING``/``DO UPDATE`` usage).

Names and emails are deliberately, unambiguously synthetic:
  - Emails: ``synthetic-seed-XXXX@staging.invalid`` — ``.invalid`` is an
    IANA-reserved TLD (RFC 2606) that can never resolve or receive mail.
  - Names: combinations from a fixed "Synthetic"/Greek-letter word list,
    never real-looking names.
"""

from __future__ import annotations

import random
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from . import SYNTHETIC_EMAIL_DOMAIN, SYNTHETIC_EMAIL_PREFIX

# Fixed namespace UUID for this project's synthetic-seed id derivation.
# Never change this value — changing it breaks idempotency for existing
# staging data (a re-seed would generate a second, disjoint set of rows).
SEED_NAMESPACE = uuid.UUID("a11ce7ed-0000-4000-8000-000000000000")

FIRST_NAME_STEMS = ["Synthetic", "Sandbox", "Fixture", "Mockuser", "Placeholder"]
LAST_NAME_STEMS = [
    "Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta",
    "Iota", "Kappa", "Lambda", "Sigma", "Omega", "Tau", "Chi",
]
EXPERIENCE_LEVELS = ["beginner", "intermediate", "advanced"]
RISK_LEVELS = ["low", "mid", "high", "very_high"]
MARITAL_STATUSES = ["single", "married", "divorced", "widowed"]
INVESTMENT_GOALS = [
    "retirement", "wealth_building", "education", "house_purchase", "other",
]
STOCK_SYMBOLS = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "TSLA", "META", "NFLX"]
CHAT_TOPICS = [
    "retirement planning", "index fund allocation", "risk tolerance review",
    "emergency fund sizing", "tax-advantaged accounts", "diversification basics",
]


def deterministic_uuid(seed: int, kind: str, index: int | str) -> uuid.UUID:
    return uuid.uuid5(SEED_NAMESPACE, f"{seed}:{kind}:{index}")


def synthetic_email(index: int) -> str:
    return f"{SYNTHETIC_EMAIL_PREFIX}{index:04d}@{SYNTHETIC_EMAIL_DOMAIN}"


@dataclass(frozen=True)
class SyntheticUserProfile:
    index: int
    id: uuid.UUID
    email: str
    first_name: str
    last_name: str
    age: int
    experience_level: str
    risk_level: str
    marital_status: str
    investment_goal: str
    onboarding_complete: bool


class SeedRandom:
    """Deterministic RNG facade keyed off the configured integer seed."""

    def __init__(self, seed: int) -> None:
        self._seed = seed
        self._rng = random.Random(seed)

    def user_profile(self, index: int) -> SyntheticUserProfile:
        # Reseed per-user so profile fields don't shift if earlier users'
        # generation logic changes shape (keeps idempotency robust).
        rng = random.Random(f"{self._seed}:user:{index}")
        return SyntheticUserProfile(
            index=index,
            id=deterministic_uuid(self._seed, "user", index),
            email=synthetic_email(index),
            first_name=f"{rng.choice(FIRST_NAME_STEMS)}{index:04d}",
            last_name=rng.choice(LAST_NAME_STEMS),
            age=rng.randint(18, 75),
            experience_level=rng.choice(EXPERIENCE_LEVELS),
            risk_level=rng.choice(RISK_LEVELS),
            marital_status=rng.choice(MARITAL_STATUSES),
            investment_goal=rng.choice(INVESTMENT_GOALS),
            onboarding_complete=rng.random() > 0.3,
        )

    def rng_for(self, *parts: object) -> random.Random:
        key = ":".join(str(p) for p in (self._seed, *parts))
        return random.Random(key)


def days_ago(n: int, *, anchor: datetime | None = None) -> datetime:
    base = anchor or datetime(2026, 1, 1, tzinfo=timezone.utc)
    return base - timedelta(days=n)


def date_days_ago(n: int, *, anchor: date | None = None) -> date:
    base = anchor or date(2026, 1, 1)
    return base - timedelta(days=n)
