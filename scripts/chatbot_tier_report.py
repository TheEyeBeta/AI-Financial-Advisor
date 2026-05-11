"""Generate a report-ready Instant/Fast/Balanced chatbot tier results table.

This is a deterministic routing benchmark: it measures the local tier classifier
used before the AI provider call. It does not call OpenAI, Supabase, or the live
chat endpoint, so the results are safe to run in CI and without secrets.
"""
from __future__ import annotations

import argparse
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from statistics import median
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = ROOT / "backend" / "websearch_service"
sys.path.insert(0, str(BACKEND_ROOT))

from app.services.subagents import classify_tier  # noqa: E402


@dataclass(frozen=True)
class TierCase:
    message: str
    expected_tier: str


CASES: tuple[TierCase, ...] = (
    TierCase("hi", "INSTANT"),
    TierCase("ok thanks", "INSTANT"),
    TierCase("continue", "INSTANT"),
    TierCase("tell me more", "INSTANT"),
    TierCase("cool!", "INSTANT"),
    TierCase("how was your weekend?", "FAST"),
    TierCase("What's the weather like today in London?", "FAST"),
    TierCase("Can you explain recursion simply?", "FAST"),
    TierCase("Can you rephrase that in one sentence?", "FAST"),
    TierCase("What does that mean in plain English?", "FAST"),
    TierCase("What is my portfolio performance this quarter?", "BALANCED"),
    TierCase("Show me the top stocks ranked by momentum", "BALANCED"),
    TierCase("Should I invest in AAPL?", "BALANCED"),
    TierCase("Review my NVDA position.", "BALANCED"),
    TierCase("Compare ETFs and bonds for a moderate risk profile.", "BALANCED"),
)

LATENCY_TARGET_P95_MS = {
    "INSTANT": 1.0,
    "FAST": 1.0,
    "BALANCED": 1.0,
}


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, round((len(ordered) - 1) * percentile))
    return ordered[index]


def evaluate_cases(cases: Iterable[TierCase] = CASES, iterations: int = 500) -> list[dict[str, float | int | str]]:
    grouped: dict[str, dict[str, object]] = {}
    for tier in ("INSTANT", "FAST", "BALANCED"):
        grouped[tier] = {
            "tier": tier.title(),
            "samples": 0,
            "correct": 0,
            "latencies_ms": [],
            "target_p95_ms": LATENCY_TARGET_P95_MS[tier],
        }

    for case in cases:
        row = grouped[case.expected_tier]
        row["samples"] = int(row["samples"]) + 1

        first_prediction = classify_tier(case.message)
        if first_prediction == case.expected_tier:
            row["correct"] = int(row["correct"]) + 1

        latencies = row["latencies_ms"]
        assert isinstance(latencies, list)
        for _ in range(iterations):
            started = time.perf_counter_ns()
            classify_tier(case.message)
            elapsed_ms = (time.perf_counter_ns() - started) / 1_000_000
            latencies.append(elapsed_ms)

    results: list[dict[str, float | int | str]] = []
    for tier in ("INSTANT", "FAST", "BALANCED"):
        row = grouped[tier]
        latencies = row["latencies_ms"]
        assert isinstance(latencies, list)
        samples = int(row["samples"])
        correct = int(row["correct"])
        accuracy = (correct / samples) * 100 if samples else 0.0
        p95 = _percentile(latencies, 0.95)
        target = float(row["target_p95_ms"])
        results.append(
            {
                "tier": str(row["tier"]),
                "samples": samples,
                "correct": correct,
                "accuracy_pct": accuracy,
                "median_ms": median(latencies) if latencies else 0.0,
                "p95_ms": p95,
                "target_p95_ms": target,
                "status": "Pass" if accuracy == 100.0 and p95 <= target else "Fail",
            }
        )
    return results


def format_markdown(results: list[dict[str, float | int | str]]) -> str:
    lines = [
        "| Mode | Test cases | Correct | Accuracy | Median routing latency | P95 routing latency | P95 target | Result |",
        "|---|---:|---:|---:|---:|---:|---:|---|",
    ]
    for row in results:
        lines.append(
            "| {tier} | {samples} | {correct} | {accuracy_pct:.1f}% | "
            "{median_ms:.4f} ms | {p95_ms:.4f} ms | <={target_p95_ms:.1f} ms | {status} |".format(
                **row
            )
        )
    return "\n".join(lines)


def format_plain(results: list[dict[str, float | int | str]]) -> str:
    rows = [
        (
            "Mode",
            "Cases",
            "Correct",
            "Accuracy",
            "Median latency",
            "P95 latency",
            "Target",
            "Result",
        )
    ]
    for row in results:
        rows.append(
            (
                str(row["tier"]),
                str(row["samples"]),
                str(row["correct"]),
                f"{row['accuracy_pct']:.1f}%",
                f"{row['median_ms']:.4f} ms",
                f"{row['p95_ms']:.4f} ms",
                f"<={row['target_p95_ms']:.1f} ms",
                str(row["status"]),
            )
        )

    widths = [max(len(row[index]) for row in rows) for index in range(len(rows[0]))]
    formatted_rows = [
        "  ".join(value.ljust(widths[index]) for index, value in enumerate(row)).rstrip()
        for row in rows
    ]
    separator = "  ".join("-" * width for width in widths).rstrip()

    return "\n".join(
        [
            "AI Chatbot Test Results",
            "Deterministic local routing test. Provider calls excluded.",
            "",
            formatted_rows[0],
            separator,
            *formatted_rows[1:],
        ]
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--iterations",
        type=int,
        default=500,
        help="Latency samples per test case. Default: 500.",
    )
    parser.add_argument(
        "--format",
        choices=("plain", "markdown"),
        default="plain",
        help="Output format. Default: plain.",
    )
    args = parser.parse_args()
    if args.iterations < 1:
        parser.error("--iterations must be at least 1")

    results = evaluate_cases(iterations=args.iterations)
    output = format_markdown(results) if args.format == "markdown" else format_plain(results)
    print(output)
    return 0 if all(row["status"] == "Pass" for row in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
