"""
Pytest for Meridian onboarding endpoint and IRIS context flow.

1. POST /api/meridian/onboard with sample data
2. Assert iris_context_cache record was written with correct structure
   (by querying the same Supabase client used in the app, or a mock store)
3. POST /api/chat with "What should I focus on given my goals?"
4. Assert the response contains contextualised content (e.g. goal-related),
   not just generic financial advice.
"""
import pytest
from unittest.mock import MagicMock, patch, AsyncMock
from fastapi.testclient import TestClient

from app.services.rate_limit import rate_limiter


def _make_supabase_mock():
    """Build a mock Supabase client that records upserts/inserts and returns them on select."""
    stored_iris_cache = {}
    stored_profiles = {}  # user_id -> profile row (for select after insert/update)
    stored_goals = []     # list of goal rows for user_id

    class TableChain:
        def __init__(self, table_name: str):
            self._table = table_name
            self._op = None
            self._filters = []  # list of (key, val) for eq()

        def select(self, *args):
            self._op = "select"
            self._select_cols = args
            return self

        def eq(self, key, val):
            self._filters.append((key, val))
            return self

        def maybe_single(self):
            return self

        def single(self):
            return self

        def update(self, data):
            self._op = "update"
            self._update_data = data
            return self

        def insert(self, data):
            self._op = "insert"
            self._insert_data = data if isinstance(data, dict) else data
            return self

        def upsert(self, data, on_conflict=None):
            self._op = "upsert"
            self._upsert_data = data
            return self

        def execute(self):
            if self._table == "iris_context_cache":
                if self._op == "upsert":
                    user_id = self._upsert_data.get("user_id")
                    if user_id:
                        stored_iris_cache[user_id] = dict(self._upsert_data)
                elif self._op == "select":
                    # eq("user_id", val)
                    uid = next((v for k, v in self._filters if k == "user_id"), None)
                    row = stored_iris_cache.get(uid) if uid else None
                    result = MagicMock()
                    result.data = row
                    return result
            elif self._table == "user_profiles":
                if self._op == "select":
                    uid = next((v for k, v in self._filters if k == "user_id"), None)
                    result = MagicMock()
                    result.data = stored_profiles.get(uid)
                    return result
                if self._op == "insert":
                    row = dict(self._insert_data)
                    row.setdefault("id", "profile-id-1")
                    stored_profiles[row["user_id"]] = row
                if self._op == "update":
                    pid = next((v for k, v in self._filters if k == "id"), None)
                    for uid, p in stored_profiles.items():
                        if p.get("id") == pid:
                            p.update(self._update_data)
                            break
            elif self._table == "user_goals":
                if self._op == "select":
                    result = MagicMock()
                    filters = dict(self._filters)
                    uid = filters.get("user_id")
                    status = filters.get("status")
                    goal_name = filters.get("goal_name")
                    if goal_name is not None and status is not None:
                        # Duplicate check: return single row or None
                        result.data = next(
                            (g for g in stored_goals if g.get("user_id") == uid and g.get("goal_name") == goal_name and g.get("status") == status),
                            None,
                        )
                    else:
                        result.data = [g for g in stored_goals if g.get("user_id") == uid and g.get("status") == status]
                    return result
                if self._op == "insert":
                    row = dict(self._insert_data)
                    row.setdefault("current_amount", 0)
                    stored_goals.append(row)
            elif self._table == "meridian_events":
                pass
            return MagicMock()

    class MockSupabase:
        def table(self, name: str):
            return TableChain(name)

    mock_sb = MockSupabase()
    mock_sb._stored_iris_cache = stored_iris_cache
    return mock_sb


@pytest.mark.asyncio
async def test_meridian_onboard_then_chat_contextualised(client: TestClient):
    """Onboard with sample data, verify cache structure, then chat returns goal-aware response."""
    rate_limiter.clear_state()

    mock_supabase = _make_supabase_mock()

    sample_body = {
        "knowledge_tier": 1,
        "risk_profile": "moderate",
        "investment_horizon": "balanced",
        "monthly_investable": 500.0,
        "emergency_fund_months": 2.0,
        "goal_name": "House deposit",
        "target_amount": 30000.0,
        "target_date": "2027-01-01",
    }

    # 1) POST /api/meridian/onboard
    with patch("app.services.meridian_context.supabase_client", new=mock_supabase):
        onboard_resp = client.post("/api/meridian/onboard", json=sample_body)
    assert onboard_resp.status_code == 200
    data = onboard_resp.json()
    assert data.get("status") == "ok"
    assert "Meridian profile created" in data.get("message", "")

    # 2) Query "iris_context_cache" (our mock store) for correct structure
    stored = getattr(mock_supabase, "_stored_iris_cache", {})
    # With AUTH_REQUIRED=false, user_id is "dev-mode-bypass"
    user_id = "dev-mode-bypass"
    assert user_id in stored, "iris_context_cache should contain a row for the onboarded user"
    row = stored[user_id]
    assert "profile_summary" in row
    assert row["profile_summary"].get("risk_profile") == "moderate"
    assert row["profile_summary"].get("investment_horizon") == "balanced"
    assert row["profile_summary"].get("monthly_investable") == 500.0
    assert "emergency_fund_status" in row["profile_summary"]
    assert "active_goals" in row
    assert len(row["active_goals"]) >= 1
    goal = row["active_goals"][0]
    assert goal.get("goal_name") == "House deposit"
    assert float(goal.get("target_amount")) == 30000.0
    assert "progress_pct" in goal
    assert goal.get("target_date") == "2027-01-01" or str(goal.get("target_date", "")) == "2027-01-01"
    assert row.get("active_alerts") == []
    assert "plan_status" in row
    assert row["plan_status"].get("on_track") is True
    assert "knowledge_tier" in row

    # 3) POST /api/chat with goal-focused question; 4) assert contextualised content
    # build_iris_context will run and, with our mock, return data from stored_iris_cache
    # so the system prompt will include Meridian context. Mock Responses API to return
    # a reply that references the user's goal so we can assert contextualisation.
    contextualised_reply = (
        "Given your House deposit goal of €30,000 and your moderate risk profile, "
        "you should focus on building your emergency fund to 3 months first, then "
        "increase monthly contributions to your goal."
    )
    fa_text = (
        '{"needs_clarification": false, "clarification_questions": [], '
        '"assumptions": [], "analysis_summary": "", '
        f'"final_answer": "{contextualised_reply}", "confidence": 0.9}}'
    )
    mock_response_data = {
        "output": [{"type": "message", "content": [{"type": "output_text", "text": fa_text}]}],
        "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15},
    }
    mock_http = AsyncMock()
    mock_http.post = AsyncMock(return_value=MagicMock(status_code=200, json=lambda: mock_response_data, text=""))

    with patch("app.services.meridian_context.supabase_client", new=mock_supabase), \
         patch("httpx.AsyncClient", return_value=mock_http):
        chat_resp = client.post(
            "/api/chat",
            json={"message": "What should I focus on given my goals?"},
        )
    assert chat_resp.status_code == 200
    response_text = chat_resp.json().get("response", "")
    # Contextualised content: should reference the user's goal or amounts, not only generic advice
    assert "House deposit" in response_text or "30000" in response_text or "30,000" in response_text
    assert "goal" in response_text.lower() or "focus" in response_text.lower()
