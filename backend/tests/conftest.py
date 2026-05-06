"""Shared pytest fixtures for backend integration tests."""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from fastapi.testclient import TestClient

from app.core.config import settings as app_settings
from app.db.session import get_db
from app.main import app


@pytest.fixture(scope="session")
def engine():
    return create_engine(app_settings.database_url, pool_pre_ping=True)


@pytest.fixture
def db(engine):
    """DB session wrapped in a rolled-back transaction — leaves no data behind."""
    connection = engine.connect()
    transaction = connection.begin()
    session = Session(connection)
    yield session
    session.close()
    transaction.rollback()
    connection.close()


@pytest.fixture
def client(db):
    """TestClient with get_db overridden to the isolated test session."""
    def _override():
        yield db

    app.dependency_overrides[get_db] = _override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
