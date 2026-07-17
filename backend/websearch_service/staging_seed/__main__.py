"""CLI entrypoint.

    python -m staging_seed preflight
    python -m staging_seed seed
    python -m staging_seed cleanup
    python -m staging_seed reset
    python -m staging_seed verify

Run from ``backend/websearch_service`` with the target environment's env
vars set (see ``staging_seed/README.md`` for exact commands).
"""

from __future__ import annotations

import argparse
import json
import logging
import sys

from .cleanup import run_cleanup, run_reset
from .config import load_config
from .guard import SeedGuardError, assert_safe_to_inspect, assert_safe_to_mutate
from .identity import gather_identity
from .seeder import run_seed
from .verify import IntegrityError, run_verify

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


def cmd_preflight(config) -> int:
    try:
        assert_safe_to_inspect(config)
    except SeedGuardError as exc:
        print(json.dumps({"refused": True, "reason": str(exc)}), file=sys.stderr)
        return 1

    identity = gather_identity(config)
    print(json.dumps(identity.as_dict(), indent=2))
    return 0


def cmd_seed(config) -> int:
    try:
        assert_safe_to_mutate(config)
    except SeedGuardError as exc:
        print(json.dumps({"refused": True, "reason": str(exc)}), file=sys.stderr)
        return 1

    summary = run_seed(config)
    print(json.dumps(summary, indent=2))
    return 0


def cmd_cleanup(config) -> int:
    try:
        assert_safe_to_mutate(config)
    except SeedGuardError as exc:
        print(json.dumps({"refused": True, "reason": str(exc)}), file=sys.stderr)
        return 1

    result = run_cleanup(config)
    print(json.dumps(result, indent=2))
    return 0


def cmd_reset(config) -> int:
    try:
        assert_safe_to_mutate(config)
    except SeedGuardError as exc:
        print(json.dumps({"refused": True, "reason": str(exc)}), file=sys.stderr)
        return 1

    result = run_reset(config)
    print(json.dumps(result, indent=2))
    return 0


def cmd_verify(config) -> int:
    try:
        assert_safe_to_inspect(config)
    except SeedGuardError as exc:
        print(json.dumps({"refused": True, "reason": str(exc)}), file=sys.stderr)
        return 1

    try:
        report = run_verify(config)
    except IntegrityError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2), file=sys.stderr)
        return 1

    print(json.dumps(report.as_dict(), indent=2))
    return 0 if report.ok else 1


COMMANDS = {
    "preflight": cmd_preflight,
    "seed": cmd_seed,
    "cleanup": cmd_cleanup,
    "reset": cmd_reset,
    "verify": cmd_verify,
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="staging_seed")
    parser.add_argument("command", choices=sorted(COMMANDS))
    args = parser.parse_args(argv)

    config = load_config()
    return COMMANDS[args.command](config)


if __name__ == "__main__":
    raise SystemExit(main())
