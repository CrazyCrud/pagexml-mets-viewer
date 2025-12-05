from __future__ import annotations

import sqlite3
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

DB_PATH = Path("data/workspaces.db").resolve()
DB_PATH.parent.mkdir(parents=True, exist_ok=True)


@dataclass
class WorkspaceRow:
    id: str
    label: str
    created_at: str
    updated_at: str
    page_count: int
    has_mets: int

    def to_dict(self) -> Dict:
        return asdict(self)


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with _connect() as con:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS workspaces (
              id TEXT PRIMARY KEY,
              label TEXT,
              created_at TEXT DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
              page_count INTEGER DEFAULT 0,
              has_mets INTEGER DEFAULT 0
            )
            """
        )
        con.commit()


def record_workspace(ws_id: str, *, label: Optional[str] = None, page_count: Optional[int] = None,
                     has_mets: Optional[bool] = None, bump_updated: bool = True) -> None:
    """
    Insert or update a workspace row. Only provided fields are updated.
    """
    if not ws_id:
        return
    init_db()
    now = datetime.utcnow().isoformat()
    existing = get_workspace(ws_id)
    page_count_val = page_count if page_count is not None else (existing["page_count"] if existing else 0)
    if has_mets is True:
        has_mets_val = 1
    elif has_mets is False:
        has_mets_val = 0
    else:
        has_mets_val = existing["has_mets"] if existing else 0
    # Use a friendly default label if none provided and row does not exist yet.
    default_label = label or (existing["label"] if existing else f"Workspace {ws_id[:8]}")
    updated_at_val = now if bump_updated or not existing else existing["updated_at"]
    with _connect() as con:
        con.execute(
            """
            INSERT INTO workspaces (id, label, created_at, updated_at, page_count, has_mets)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              label       = COALESCE(excluded.label, workspaces.label),
              updated_at  = COALESCE(excluded.updated_at, workspaces.updated_at),
              page_count  = COALESCE(excluded.page_count, workspaces.page_count),
              has_mets    = COALESCE(excluded.has_mets, workspaces.has_mets)
            """,
            (
                ws_id,
                default_label,
                now,
                updated_at_val,
                page_count_val,
                has_mets_val,
            )
        )
        con.commit()


def list_workspaces() -> List[Dict]:
    init_db()
    with _connect() as con:
        rows = con.execute(
            """
            SELECT id, label, created_at, updated_at, page_count, has_mets
            FROM workspaces
            ORDER BY datetime(updated_at) DESC
            """
        ).fetchall()
    return [WorkspaceRow(**dict(r)).to_dict() for r in rows]


def get_workspace(ws_id: str) -> Optional[Dict]:
    init_db()
    with _connect() as con:
        row = con.execute(
            "SELECT id, label, created_at, updated_at, page_count, has_mets FROM workspaces WHERE id=?",
            (ws_id,)
        ).fetchone()
    return WorkspaceRow(**dict(row)).to_dict() if row else None


def remove_workspace(ws_id: str) -> None:
    init_db()
    with _connect() as con:
        con.execute("DELETE FROM workspaces WHERE id=?", (ws_id,))
        con.commit()


# Ensure the table exists on import
init_db()
