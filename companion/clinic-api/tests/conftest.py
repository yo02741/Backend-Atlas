"""共用 fixture。碰資料庫的測試用真的 PostgreSQL 與 Redis（連線從環境變數來），每個測試前清空。"""

import os
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import date, datetime, timedelta

import pytest
from alembic.config import Config
from fastapi import FastAPI
from fastapi.testclient import TestClient
from redis import Redis
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session as DbSession

from alembic import command
from clinic.app import create_app
from clinic.config import Settings
from clinic.db import make_engine
from clinic.domain.rules import TPE
from clinic.repository.tables import DoctorRow, PatientRow, SessionRow, UserRow
from clinic.service.auth import hash_password

TEST_PASSWORD = "test-only-" + os.urandom(6).hex()  # 每次執行隨機產生，不寫死
TEST_PASSWORD_HASH = hash_password(TEST_PASSWORD)  # Argon2 刻意算得慢：整輪測試只算一次


@pytest.fixture(scope="session")
def settings() -> Settings:
    url = os.environ.get("DATABASE_URL", "")
    if not url.rsplit("/", 1)[-1].split("?")[0].endswith("_test"):
        pytest.fail("這些測試會清空資料表：DATABASE_URL 的資料庫名稱必須以 _test 結尾（例如 clinic_test）")
    return Settings(
        database_url=url,
        jwt_secret="test-only-secret-" + os.urandom(16).hex(),
        redis_url=os.environ.get("REDIS_URL", "redis://localhost:6379/15"),
    )


@pytest.fixture(scope="session")
def engine(settings: Settings) -> Iterator[Engine]:
    command.upgrade(Config("alembic.ini"), "head")  # schema 由 migration 建立，和正式環境同一條路
    engine = make_engine(settings.sqlalchemy_url)
    yield engine
    engine.dispose()


@pytest.fixture
def redis(settings: Settings) -> Iterator[Redis]:
    client = Redis.from_url(settings.redis_url, decode_responses=True)
    client.flushdb()
    yield client
    client.close()


@pytest.fixture
def db(engine: Engine, redis: Redis) -> Iterator[DbSession]:
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE appointments, users, sessions, doctors, patients RESTART IDENTITY CASCADE"))
    with DbSession(engine, expire_on_commit=False) as session:
        yield session


@dataclass
class World:
    """每個測試自己的一組資料：醫師 1、2；病患 1–3；診次見下方。"""

    day: date  # 一週後：還能取消
    today: date  # 今天的診次：取消期限已過
    s_small: int  # 醫師 1、上午、名額 2
    s_afternoon: int  # 醫師 1、下午
    s_evening: int  # 醫師 1、晚上
    s_other_doctor: int  # 醫師 2、上午
    s_today: int  # 醫師 2、今天晚上


@pytest.fixture
def world(db: DbSession) -> World:
    db.add_all([DoctorRow(name="林醫師", dept="家醫科"), DoctorRow(name="張醫師", dept="小兒科")])
    db.add_all([PatientRow(name=n) for n in ("王小明", "陳小華", "李大同")])
    db.flush()
    today = datetime.now(TPE).date()
    day = today + timedelta(days=7)
    sessions = [
        SessionRow(doctor_id=1, session_date=day, period="morning", capacity=2),
        SessionRow(doctor_id=1, session_date=day, period="afternoon", capacity=30),
        SessionRow(doctor_id=1, session_date=day, period="evening", capacity=30),
        SessionRow(doctor_id=2, session_date=day, period="morning", capacity=30),
        SessionRow(doctor_id=2, session_date=today, period="evening", capacity=30),
    ]
    db.add_all(sessions)
    pw = TEST_PASSWORD_HASH
    db.add_all(
        [
            UserRow(username="patient1", password_hash=pw, role="patient", patient_id=1),
            UserRow(username="patient2", password_hash=pw, role="patient", patient_id=2),
            UserRow(username="desk1", password_hash=pw, role="desk"),
            UserRow(username="doctor1", password_hash=pw, role="doctor", doctor_id=1),
            UserRow(username="doctor2", password_hash=pw, role="doctor", doctor_id=2),
        ]
    )
    db.commit()
    return World(day, today, *(s.id for s in sessions))


@pytest.fixture
def app(settings: Settings, db: DbSession) -> FastAPI:
    return create_app(settings)


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client


@pytest.fixture
def auth(client: TestClient, world: World) -> Callable[[str], dict[str, str]]:
    """auth("patient1") → 帶 Bearer token 的標頭。"""

    def login(username: str) -> dict[str, str]:
        r = client.post("/auth/login", json={"username": username, "password": TEST_PASSWORD})
        assert r.status_code == 200, r.text
        return {"Authorization": f"Bearer {r.json()['access_token']}"}

    return login
