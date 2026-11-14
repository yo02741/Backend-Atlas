"""Alembic 環境：連線字串只從環境變數 DATABASE_URL 來。"""

import os
from logging.config import fileConfig

from sqlalchemy import create_engine

from alembic import context
from clinic.config import to_sqlalchemy_url
from clinic.repository.tables import Base

if context.config.config_file_name:
    fileConfig(context.config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def run_migrations() -> None:
    url = to_sqlalchemy_url(os.environ["DATABASE_URL"])
    if context.is_offline_mode():  # alembic upgrade head --sql：只印出 SQL
        context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
        with context.begin_transaction():
            context.run_migrations()
        return
    engine = create_engine(url)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():  # PostgreSQL 的 DDL 在交易裡：一個版本失敗就整個撤銷
            context.run_migrations()
    engine.dispose()


run_migrations()
