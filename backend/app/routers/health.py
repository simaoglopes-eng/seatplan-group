"""GET /health: is the API up and can it reach the database?

`schema` is "ready", "empty" (no tables), "incomplete" (a table is missing)
or "needs_migration" (every table is there but a column of
seed/migrate.NEW_COLUMNS is not): the code is newer than the database, so
run python -m app.seed.migrate. Once a database was seen "ready" this
process remembers it and skips the column check (columns are only ever
added); any other answer is checked again on the next call.
"""

from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import inspect, text
from sqlalchemy.exc import SQLAlchemyError

from app import db
from app.config import APP_VERSION
from app.models import Base, utc_now
from app.seed.migrate import NEW_COLUMNS

router = APIRouter(tags=["health"])

# Databases (by URL, without the password) already seen with every column.
_READY: set[str] = set()


def _missing_columns(inspector: Any) -> bool:
    found: dict[str, set[str]] = {}
    for table, column, _ddl in NEW_COLUMNS:
        if table not in found:
            found[table] = {c["name"] for c in inspector.get_columns(table)}
        if column not in found[table]:
            return True
    return False


@router.get("/health")
def health(session: db.SessionDep) -> JSONResponse:
    database = "ok"
    schema = "unknown"
    try:
        # A fixed statement with no user input, so text() is safe here.
        session.execute(text("SELECT 1"))
        url = session.get_bind().url.render_as_string(hide_password=True)
        inspector = inspect(session.connection())
        present_tables = set() if url in _READY else set(inspector.get_table_names())
        expected_tables = set(Base.metadata.tables)
        if url in _READY:
            schema = "ready"
        elif expected_tables.issubset(present_tables):
            schema = "needs_migration" if _missing_columns(inspector) else "ready"
            if schema == "ready":
                _READY.add(url)
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
