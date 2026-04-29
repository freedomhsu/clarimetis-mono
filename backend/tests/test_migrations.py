"""Verify that all *.sql migration files can be applied in sorted order
against a fresh in-memory SQLite database.

This catches two classes of bug:
  1. Out-of-order migrations (e.g. a table referenced before it is created).
  2. SQL syntax errors that would blow up on startup.

SQLite is intentionally used here — it is always available, needs no server,
and exercises the ordering logic without requiring a real Postgres instance.
PostgreSQL-specific syntax (pgvector, HNSW index, asyncpg) is skipped via
the skip patterns below.
"""

import pathlib
import re
import sqlite3


def _get_migration_files() -> list[pathlib.Path]:
    migrations_dir = pathlib.Path(__file__).parent.parent / "migrations"
    return sorted(migrations_dir.glob("*.sql"))


def _is_skippable(stmt: str) -> bool:
    """Return True for statements that use Postgres-only syntax that cannot be
    translated to SQLite even with type substitution (e.g. PL/pgSQL functions,
    HNSW indexes, triggers).  Types like TIMESTAMPTZ, JSONB, and vector columns
    are handled by substitution, not skipping.
    """
    pg_only = re.compile(
        r"CREATE\s+EXTENSION"
        r"|USING\s+hnsw"                 # HNSW index method
        r"|vector_cosine_ops"            # vector operator class
        r"|LANGUAGE\s+plpgsql"           # PL/pgSQL function body
        r"|CREATE\s+OR\s+REPLACE\s+FUNCTION"
        r"|RETURNS\s+TRIGGER"
        r"|EXECUTE\s+FUNCTION"
        r"|DROP\s+TRIGGER"
        r"|CREATE\s+TRIGGER"
        r"|ADD\s+CONSTRAINT"             # ALTER TABLE ADD CONSTRAINT not supported in SQLite
        r"|VALIDATE\s+CONSTRAINT",       # ALTER TABLE VALIDATE CONSTRAINT (Postgres-only)
        re.IGNORECASE,
    )
    return bool(pg_only.search(stmt))


def test_migrations_apply_in_order():
    """Migrations sorted lexicographically should apply without FK/table errors."""
    files = _get_migration_files()
    assert files, "No migration files found"

    # Confirm 001_init.sql is first
    assert files[0].name.startswith("001_"), (
        f"First migration should be 001_init.sql, got {files[0].name}. "
        "Ensure init.sql is renamed to 001_init.sql."
    )

    conn = sqlite3.connect(":memory:")
    conn.execute("PRAGMA foreign_keys = ON")

    for sql_path in files:
        sql = sql_path.read_text()
        lines = [ln for ln in sql.splitlines() if not ln.strip().startswith("--")]
        sql_clean = "\n".join(lines)
        # Strip dollar-quoted function bodies before splitting on ; so that
        # PL/pgSQL function bodies (which contain their own semicolons) don't
        # produce orphaned statement fragments like "RETURN NEW".
        sql_clean = re.sub(r"\$\$.*?\$\$", "''", sql_clean, flags=re.DOTALL)
        statements = [s.strip() for s in sql_clean.split(";") if s.strip()]
        for stmt in statements:
            if _is_skippable(stmt):
                continue
            # Normalise Postgres-specific types to SQLite equivalents for parsing
            stmt = re.sub(r"\bTIMESTAMPTZ\b", "TEXT", stmt, flags=re.IGNORECASE)
            stmt = re.sub(r"\bJSONB\b", "TEXT", stmt, flags=re.IGNORECASE)
            stmt = re.sub(r"\bUUID\b", "TEXT", stmt, flags=re.IGNORECASE)
            stmt = re.sub(r"DEFAULT gen_random_uuid\(\)", "DEFAULT (lower(hex(randomblob(16))))", stmt, flags=re.IGNORECASE)
            stmt = re.sub(r"\bFLOAT\b", "REAL", stmt, flags=re.IGNORECASE)
            # NOW() and NOW() with cast are not valid in SQLite
            stmt = re.sub(r"\bNOW\(\)", "CURRENT_TIMESTAMP", stmt, flags=re.IGNORECASE)
            # pgvector column type: vector(768) → TEXT
            stmt = re.sub(r"\bvector\(\d+\)", "TEXT", stmt, flags=re.IGNORECASE)
            # SQLite does not support IF NOT EXISTS / IF EXISTS on ALTER TABLE
            stmt = re.sub(r"ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b", "ADD COLUMN", stmt, flags=re.IGNORECASE)
            stmt = re.sub(r"DROP\s+COLUMN\s+IF\s+EXISTS\b", "DROP COLUMN", stmt, flags=re.IGNORECASE)
            try:
                conn.execute(stmt)
            except sqlite3.OperationalError as exc:
                # Skip known SQLite unsupported DDL (triggers referencing NEW, etc.)
                msg = str(exc).lower()
                if any(k in msg for k in ("already exists", "no such module")):
                    continue
                raise AssertionError(
                    f"Migration {sql_path.name} failed:\n  stmt: {stmt[:120]}\n  error: {exc}"
                ) from exc

    conn.close()


def test_migration_file_ordering():
    """All migration files must start with a numeric prefix so sorting is deterministic."""
    files = _get_migration_files()
    for f in files:
        assert re.match(r"^\d+_", f.name), (
            f"Migration file '{f.name}' must start with a numeric prefix "
            "(e.g. 001_init.sql) so lexicographic sorting is correct."
        )


def _build_migrated_db() -> sqlite3.Connection:
    """Return an in-memory SQLite connection with all migrations applied.

    Shared helper used by schema assertion tests below.
    """
    files = _get_migration_files()
    conn = sqlite3.connect(":memory:")
    conn.execute("PRAGMA foreign_keys = ON")
    for sql_path in files:
        sql = sql_path.read_text()
        lines = [ln for ln in sql.splitlines() if not ln.strip().startswith("--")]
        sql_clean = re.sub(r"\$\$.*?\$\$", "''", "\n".join(lines), flags=re.DOTALL)
        statements = [s.strip() for s in sql_clean.split(";") if s.strip()]
        for stmt in statements:
            if _is_skippable(stmt):
                continue
            stmt = re.sub(r"\bTIMESTAMPTZ\b", "TEXT", stmt, flags=re.IGNORECASE)
            stmt = re.sub(r"\bJSONB\b", "TEXT", stmt, flags=re.IGNORECASE)
            stmt = re.sub(r"\bUUID\b", "TEXT", stmt, flags=re.IGNORECASE)
            stmt = re.sub(r"DEFAULT gen_random_uuid\(\)", "DEFAULT (lower(hex(randomblob(16))))", stmt, flags=re.IGNORECASE)
            stmt = re.sub(r"\bFLOAT\b", "REAL", stmt, flags=re.IGNORECASE)
            stmt = re.sub(r"\bNOW\(\)", "CURRENT_TIMESTAMP", stmt, flags=re.IGNORECASE)
            stmt = re.sub(r"\bvector\(\d+\)", "TEXT", stmt, flags=re.IGNORECASE)
            stmt = re.sub(r"ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b", "ADD COLUMN", stmt, flags=re.IGNORECASE)
            stmt = re.sub(r"DROP\s+COLUMN\s+IF\s+EXISTS\b", "DROP COLUMN", stmt, flags=re.IGNORECASE)
            try:
                conn.execute(stmt)
            except sqlite3.OperationalError as exc:
                msg = str(exc).lower()
                if any(k in msg for k in ("already exists", "no such module")):
                    continue
                raise
    return conn


# Canonical schema: table → required columns.
# Extend this dict whenever a migration adds a column that is load-path critical
# (i.e. queried by SQLAlchemy ORM on every request).
_REQUIRED_COLUMNS: dict[str, list[str]] = {
    "users": [
        "id", "clerk_user_id", "email", "full_name",
        "stripe_customer_id", "stripe_subscription_id", "subscription_tier",
        "created_at", "updated_at",
    ],
    "chat_sessions": ["id", "user_id", "title", "summary", "created_at", "updated_at"],
    "messages": [
        "id", "session_id", "role", "content", "media_urls",
        "crisis_flagged", "sentiment_score", "embedding", "created_at",
    ],
    "user_profiles": [
        "id", "user_id", "core_values", "long_term_goals",
        "recurring_patterns", "telemetry", "updated_at",
    ],
    "knowledge_docs": ["id", "title", "content", "category", "embedding", "created_at"],
    "score_snapshots": [
        "id", "user_id", "confidence_score", "anxiety_score",
        "self_esteem_score", "stress_load", "social_gratitude_index",
        "data_reliability", "created_at",
    ],
}


def test_schema_columns_exist_after_migration():
    """Every column referenced by the ORM must be present after migrations run.

    This is the test that catches ALTER TABLE ADD COLUMN statements that were
    silently rolled back due to a transaction failure earlier in the same file
    (e.g. a trigger referencing a function not yet created).
    """
    conn = _build_migrated_db()
    for table, columns in _REQUIRED_COLUMNS.items():
        # PRAGMA table_info returns one row per column; empty = table missing.
        rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
        assert rows, f"Table '{table}' is missing after migrations"
        existing = {row[1] for row in rows}  # row[1] = column name
        for col in columns:
            assert col in existing, (
                f"Column '{table}.{col}' is missing after migrations. "
                "A migration ALTER TABLE statement may have been silently rolled back."
            )
    conn.close()
