"""GET /health: is the API up and can it reach the database?"""

from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import inspect, text
from sqlalchemy.exc import SQLAlchemyError

from app import db
from app.config import APP_VERSION
from app.models import Base, utc_now

router = APIRouter(tags=["health"])


@router.get("/health")
def health(session: db.SessionDep) -> JSONResponse:
    database = "ok"
    schema = "unknown"
    try:
        # A fixed statement with no user input, so text() is safe here.
        session.execute(text("SELECT 1"))
        present_tables = set(inspect(session.connection()).get_table_names())
        expected_tables = set(Base.metadata.tables)
        if expected_tables.issubset(present_tables):
            schema = "ready"
        elif not present_tables:
            schema = "empty"
        else:
            schema = "incomplete"
    except SQLAlchemyError:
        database = "error"
        schema = "unknown"
    ready = database == "ok" and schema == "ready"
    body: dict[str, Any] = {
        "status": "ok" if ready else "degraded",
        "database": database,
        "schema": schema,
        "version": APP_VERSION,
        "time": utc_now().isoformat(),
    }
    # 503 lets an uptime monitor catch both a broken connection and a missing schema.
    return JSONResponse(body, status_code=200 if ready else 503)
