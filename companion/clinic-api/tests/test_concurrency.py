"""階段 5：真的並發。多個執行緒、各自一條資料庫連線，同時搶同一個診次。

瀏覽器版只有一條連線，請求是依序執行的，測不到這裡驗證的事：
不超賣、號碼不重複、計數欄位和實際資料一致。
"""

import threading
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any

import pytest
from redis import Redis
from sqlalchemy import text
from sqlalchemy.orm import Session as DbSession
from sqlalchemy.orm import sessionmaker

from clinic.config import Settings
from clinic.db import make_engine
from clinic.domain.errors import AlreadyBooked, BookingError, DailyLimitExceeded, InvalidStatus, SessionFull
from clinic.domain.models import Principal
from clinic.domain.rules import TPE
from clinic.repository.clinic_repo import ClinicRepository
from clinic.repository.session_cache import SessionListCache
from clinic.service.booking import BookingService, Idempotency
from tests.conftest import World

THREADS = 20
DESK = Principal(id=0, role="desk")

# 對帳：計數欄位與實際有效掛號數不一致的診次（應該沒有任何一列）
RECONCILE = """
SELECT s.id FROM sessions s
LEFT JOIN appointments a ON a.session_id = s.id AND a.status <> 'cancelled'
GROUP BY s.id, s.booked HAVING s.booked <> count(a.id)
"""


@pytest.fixture
def use_service(settings: Settings, redis: Redis, world: World) -> Iterator[Callable[[Callable], Any]]:
    """use_service(fn)：開一條新的連線、組一個 BookingService 交給 fn；業務錯誤回傳例外類別。"""
    engine = make_engine(settings.sqlalchemy_url, pool_size=THREADS + 2)  # 每個執行緒都拿得到自己的連線
    factory = sessionmaker(engine, expire_on_commit=False)

    def run(fn: Callable[[BookingService], Any]) -> Any:
        with factory() as db:
            try:
                return fn(BookingService(ClinicRepository(db), SessionListCache(redis, ttl=30)))
            except BookingError as exc:
                return type(exc)

    yield run
    engine.dispose()


def race(n: int, attempt: Callable[[int], Any]) -> list[Any]:
    """n 個執行緒在 barrier 前排好，同時放行。"""
    barrier = threading.Barrier(n)

    def task(i: int) -> Any:
        barrier.wait(timeout=10)
        return attempt(i)

    with ThreadPoolExecutor(max_workers=n) as pool:
        return list(pool.map(task, range(n)))


def test_last_seats_are_never_oversold(use_service: Callable, db: DbSession) -> None:
    capacity, already = 5, 2
    sid = db.execute(
        text("INSERT INTO sessions (doctor_id, session_date, period, capacity) "
             "VALUES (2, '2030-01-07', 'morning', :c) RETURNING id"), {"c": capacity},
    ).scalar_one()  # fmt: skip
    patients = db.execute(
        text("INSERT INTO patients (name) SELECT '虛構病患 ' || g FROM generate_series(1, :n) g RETURNING id"),
        {"n": THREADS + already},
    ).scalars().all()  # fmt: skip
    db.commit()
    for pid in patients[:already]:  # 先掛掉 2 個，剩最後 3 個名額
        use_service(lambda s, pid=pid: s.book(DESK, sid, pid))

    results = race(THREADS, lambda i: use_service(lambda s: s.book(DESK, sid, patients[already + i]).body["number"]))

    numbers = sorted(r for r in results if isinstance(r, int))
    assert numbers == [3, 4, 5]  # 剛好發出剩下的 3 個號，沒有重複
    assert results.count(SessionFull) == THREADS - 3  # 其他人都收到乾淨的「名額已滿」，不是資料庫錯誤
    row = db.execute(text("SELECT booked, next_no FROM sessions WHERE id = :id"), {"id": sid}).one()
    assert (row.booked, row.next_no) == (capacity, capacity + 1)
    stored = db.execute(text("SELECT number FROM appointments WHERE session_id = :id ORDER BY number"), {"id": sid})
    assert stored.scalars().all() == [1, 2, 3, 4, 5]
    assert db.execute(text(RECONCILE)).all() == []


def test_same_patient_racing_for_one_session_gets_one(use_service: Callable, db: DbSession, world: World) -> None:
    results = race(10, lambda i: use_service(lambda s: s.book(DESK, world.s_afternoon, 1).body["number"]))
    assert results.count(1) == 1 and results.count(AlreadyBooked) == 9  # 重複點擊：一筆成功，其餘 409
    assert db.execute(text("SELECT booked FROM sessions WHERE id = :id"), {"id": world.s_afternoon}).scalar_one() == 1
    assert db.execute(text(RECONCILE)).all() == []


def test_daily_limit_holds_under_concurrency(use_service: Callable, db: DbSession, world: World) -> None:
    """同一位病患同時掛同一天的 6 個診次：各自讀、各自寫會全部通過（write skew）；鎖病患列之後剛好 3 個成功。"""
    db.execute(text("""
        INSERT INTO sessions (doctor_id, session_date, period, capacity)
        SELECT d, '2030-01-08', p, 30 FROM generate_series(1, 2) d, unnest(ARRAY['morning', 'afternoon', 'evening']) p
    """))  # fmt: skip
    sids = list(db.execute(text("SELECT id FROM sessions WHERE session_date = '2030-01-08' ORDER BY id")).scalars())
    db.commit()

    results = race(len(sids), lambda i: use_service(lambda s: s.book(DESK, sids[i], 3).body["number"]))

    assert results.count(1) == 3 and results.count(DailyLimitExceeded) == 3
    booked = db.execute(text("SELECT sum(booked) FROM sessions WHERE session_date = '2030-01-08'")).scalar_one()
    assert booked == 3  # 被拒絕的那三次，取號的 UPDATE 都跟著交易撤銷
    assert db.execute(text(RECONCILE)).all() == []


def test_concurrent_cancel_decrements_once(use_service: Callable, db: DbSession, world: World) -> None:
    appointment_id = use_service(lambda s: s.book(DESK, world.s_small, 1)).body["id"]
    use_service(lambda s: s.book(DESK, world.s_small, 2))
    now = datetime.now(TPE)

    results = race(8, lambda i: use_service(lambda s: s.cancel(DESK, appointment_id, now).status))

    assert results.count("cancelled") == 1 and results.count(InvalidStatus) == 7
    assert db.execute(text("SELECT booked FROM sessions WHERE id = :id"), {"id": world.s_small}).scalar_one() == 1
    assert db.execute(text(RECONCILE)).all() == []


def test_concurrent_retries_with_the_same_key_book_once(use_service: Callable, db: DbSession, world: World) -> None:
    """同一個 Idempotency-Key 同時送 10 次（例如逾時後客戶端與 proxy 都重送）：只有一筆掛號，每次拿到同一個結果。"""
    desk = Principal(id=3, role="desk")  # world 的 desk1；冪等鍵記在 users.id 底下
    key = Idempotency("same-key", "fingerprint-of-the-same-body")

    def attempt(i: int) -> Any:
        return use_service(lambda svc: svc.book(desk, world.s_afternoon, 3, lambda a: {"id": a.id}, key))

    results = race(10, attempt)
    assert {r.body["id"] for r in results} == {1}
    assert sorted(r.replayed for r in results) == [False] + [True] * 9
    assert db.execute(text("SELECT count(*) FROM appointments")).scalar_one() == 1
    assert db.execute(text(RECONCILE)).all() == []
