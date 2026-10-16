"""数据库引擎与会话管理（SQLite + SQLAlchemy 2.x）。"""
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from . import config

# SQLite 多线程访问需要 check_same_thread=False
connect_args = {"check_same_thread": False} if config.DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(config.DATABASE_URL, connect_args=connect_args, echo=False)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def init_db() -> None:
    """建表。实际导入 models 后由 main.py 调用。"""
    from . import models  # noqa: F401  确保模型注册到 Base

    Base.metadata.create_all(bind=engine)
