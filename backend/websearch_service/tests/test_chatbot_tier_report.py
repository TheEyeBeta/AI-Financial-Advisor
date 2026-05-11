"""Report-oriented tests for chatbot Instant/Fast/Balanced routing."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


REPORT_SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "chatbot_tier_report.py"
SPEC = importlib.util.spec_from_file_location("chatbot_tier_report", REPORT_SCRIPT)
assert SPEC is not None
chatbot_tier_report = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = chatbot_tier_report
assert SPEC.loader is not None
SPEC.loader.exec_module(chatbot_tier_report)


def test_chatbot_tier_report_accuracy_is_report_ready():
    results = chatbot_tier_report.evaluate_cases(iterations=25)

    assert {row["tier"] for row in results} == {"Instant", "Fast", "Balanced"}
    assert all(row["accuracy_pct"] == 100.0 for row in results)
    assert all(row["correct"] == row["samples"] for row in results)


def test_chatbot_tier_report_latency_stays_under_routing_targets():
    results = chatbot_tier_report.evaluate_cases(iterations=25)

    for row in results:
        assert row["p95_ms"] <= row["target_p95_ms"], row
        assert row["status"] == "Pass"


def test_chatbot_tier_report_outputs_markdown_table():
    markdown = chatbot_tier_report.format_markdown(
        chatbot_tier_report.evaluate_cases(iterations=5)
    )

    assert "| Mode | Test cases | Correct | Accuracy |" in markdown
    assert "| Instant |" in markdown
    assert "| Fast |" in markdown
    assert "| Balanced |" in markdown


def test_chatbot_tier_report_outputs_plain_terminal_table():
    plain = chatbot_tier_report.format_plain(
        chatbot_tier_report.evaluate_cases(iterations=5)
    )

    assert "AI Chatbot Test Results" in plain
    assert "Mode      Cases" in plain
    assert "Instant" in plain
    assert "|" not in plain
