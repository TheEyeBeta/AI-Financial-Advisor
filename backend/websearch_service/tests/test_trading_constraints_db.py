"""Database-level tests for trading constraints and oversell triggers (#207).

These run against the migrated Postgres from ALEMBIC_DATABASE_URL (the CI
backend job migrates it to head before pytest). They are skipped when no
database is configured so the unit suite stays runnable standalone.
"""
from __future__ import annotations

import os
import threading
import uuid

import pytest

psycopg = pytest.importorskip("psycopg")

_RAW_URL = (os.getenv("ALEMBIC_DATABASE_URL") or "").strip()
DSN = _RAW_URL.replace("postgresql+psycopg://", "postgresql://")

pytestmark = pytest.mark.skipif(
    not DSN, reason="ALEMBIC_DATABASE_URL not set — requires a migrated Postgres"
)


@pytest.fixture(scope="module")
def db():
    conn = psycopg.connect(DSN, autocommit=True)
    yield conn
    conn.close()


@pytest.fixture()
def user_id(db):
    auth_id = str(uuid.uuid4())
    db.execute("INSERT INTO auth.users (id) VALUES (%s)", (auth_id,))
    row = db.execute(
        "SELECT id FROM core.users WHERE auth_id = %s", (auth_id,)
    ).fetchone()
    assert row, "handle_new_user trigger should have provisioned core.users"
    yield row[0]
    db.execute("DELETE FROM auth.users WHERE id = %s", (auth_id,))


def _insert_journal(conn, user_id, symbol, entry_type, quantity, price):
    conn.execute(
        "INSERT INTO trading.trade_journal (user_id, symbol, type, date, quantity, price) "
        "VALUES (%s, %s, %s, current_date, %s, %s)",
        (user_id, symbol, entry_type, quantity, price),
    )


class TestPositiveValueConstraints:
    @pytest.mark.parametrize("quantity,price", [(0, 100), (-5, 100), (5, 0), (5, -1)])
    def test_journal_rejects_non_positive_values(self, db, user_id, quantity, price):
        with pytest.raises(psycopg.errors.CheckViolation):
            _insert_journal(db, user_id, "CHK", "BUY", quantity, price)

    def test_open_positions_reject_non_positive(self, db, user_id):
        with pytest.raises(psycopg.errors.CheckViolation):
            db.execute(
                "INSERT INTO trading.open_positions (user_id, symbol, quantity, entry_price, type) "
                "VALUES (%s, 'CHK', 0, 100.00, 'LONG')",
                (user_id,),
            )
        with pytest.raises(psycopg.errors.CheckViolation):
            db.execute(
                "INSERT INTO trading.open_positions (user_id, symbol, quantity, entry_price, current_price, type) "
                "VALUES (%s, 'CHK', 5, 100.00, -1.00, 'LONG')",
                (user_id,),
            )

    def test_trades_reject_non_positive(self, db, user_id):
        with pytest.raises(psycopg.errors.CheckViolation):
            db.execute(
                "INSERT INTO trading.trades (user_id, symbol, type, action, quantity, entry_price, entry_date) "
                "VALUES (%s, 'CHK', 'LONG', 'OPENED', 5, 0.00, now())",
                (user_id,),
            )

    def test_portfolio_history_rejects_negative_value(self, db, user_id):
        with pytest.raises(psycopg.errors.CheckViolation):
            db.execute(
                "INSERT INTO trading.portfolio_history (user_id, date, value) "
                "VALUES (%s, current_date, -1.00)",
                (user_id,),
            )

    def test_valid_flows_still_work(self, db, user_id):
        _insert_journal(db, user_id, "OKAY", "BUY", 10, 100.00)
        _insert_journal(db, user_id, "OKAY", "SELL", 10, 110.00)


class TestOversellProtection:
    def test_sell_beyond_position_rejected(self, db, user_id):
        _insert_journal(db, user_id, "OSL", "BUY", 10, 100.00)
        with pytest.raises(psycopg.errors.CheckViolation):
            _insert_journal(db, user_id, "OSL", "SELL", 11, 105.00)
        # Partial closes down to exactly zero are fine.
        _insert_journal(db, user_id, "OSL", "SELL", 6, 105.00)
        _insert_journal(db, user_id, "OSL", "SELL", 4, 105.00)
        with pytest.raises(psycopg.errors.CheckViolation):
            _insert_journal(db, user_id, "OSL", "SELL", 1, 105.00)

    def test_paper_close_beyond_position_rejected(self, db, user_id):
        buy_id = db.execute(
            "INSERT INTO trading.paper_trades (user_id, symbol, buy_quantity, buy_price) "
            "VALUES (%s, 'OSL2', 10, 50.00) RETURNING id",
            (user_id,),
        ).fetchone()[0]
        db.execute(
            "INSERT INTO trading.paper_trade_closes (user_id, buy_trade_id, close_quantity, close_price) "
            "VALUES (%s, %s, 6, 55.00)",
            (user_id, buy_id),
        )
        with pytest.raises(psycopg.errors.CheckViolation):
            db.execute(
                "INSERT INTO trading.paper_trade_closes (user_id, buy_trade_id, close_quantity, close_price) "
                "VALUES (%s, %s, 5, 55.00)",
                (user_id, buy_id),
            )

    def test_paper_close_wrong_owner_rejected(self, db, user_id):
        other_auth = str(uuid.uuid4())
        db.execute("INSERT INTO auth.users (id) VALUES (%s)", (other_auth,))
        try:
            other_id = db.execute(
                "SELECT id FROM core.users WHERE auth_id = %s", (other_auth,)
            ).fetchone()[0]
            buy_id = db.execute(
                "INSERT INTO trading.paper_trades (user_id, symbol, buy_quantity, buy_price) "
                "VALUES (%s, 'OSL3', 10, 50.00) RETURNING id",
                (user_id,),
            ).fetchone()[0]
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                db.execute(
                    "INSERT INTO trading.paper_trade_closes (user_id, buy_trade_id, close_quantity, close_price) "
                    "VALUES (%s, %s, 1, 55.00)",
                    (other_id, buy_id),
                )
        finally:
            db.execute("DELETE FROM auth.users WHERE id = %s", (other_auth,))

    def test_concurrent_sells_cannot_both_pass(self, db, user_id):
        _insert_journal(db, user_id, "RACE2", "BUY", 10, 100.00)
        results: list[str] = []
        barrier = threading.Barrier(2)

        def sell():
            try:
                with psycopg.connect(DSN) as conn:
                    with conn.cursor() as cur:
                        barrier.wait()
                        cur.execute(
                            "INSERT INTO trading.trade_journal (user_id, symbol, type, date, quantity, price) "
                            "VALUES (%s, 'RACE2', 'SELL', current_date, 10, 105.00)",
                            (user_id,),
                        )
                    conn.commit()
                results.append("committed")
            except psycopg.errors.CheckViolation:
                results.append("rejected")

        threads = [threading.Thread(target=sell) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert sorted(results) == ["committed", "rejected"]
        remaining = db.execute(
            "SELECT COALESCE(SUM(CASE WHEN type='BUY' THEN quantity ELSE -quantity END), 0) "
            "FROM trading.trade_journal WHERE user_id = %s AND symbol = 'RACE2'",
            (user_id,),
        ).fetchone()[0]
        assert remaining == 0
