"""資料庫連線：engine 與 session factory 在啟動時建立一次。"""

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session, sessionmaker


def make_engine(url: str, pool_size: int = 5) -> Engine:
    # pool_pre_ping：資料庫重啟後，連線池裡的舊連線會先被偵測並換掉
    return create_engine(
        url, pool_size=pool_size, max_overflow=5, pool_pre_ping=True, connect_args={"connect_timeout": 3}
    )


def make_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(engine, expire_on_commit=False)


def ping(engine: Engine) -> None:
    """/ready 用：對資料庫跑 SELECT 1。連不上或逾時就丟例外。"""
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
