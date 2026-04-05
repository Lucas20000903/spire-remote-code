use rusqlite::Connection;
use std::path::Path;
use std::sync::{Arc, Mutex};

pub type DbPool = Arc<Mutex<Connection>>;

pub fn init_db(path: &Path) -> anyhow::Result<DbPool> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS user (
            id INTEGER PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS push_subscription (
            id INTEGER PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES user(id),
            endpoint TEXT NOT NULL,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS favorite (
            id INTEGER PRIMARY KEY,
            cwd TEXT UNIQUE NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS session (
            id TEXT PRIMARY KEY,
            session_id TEXT,
            cwd TEXT NOT NULL,
            pid INTEGER NOT NULL,
            port INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            last_active TEXT NOT NULL DEFAULT (datetime('now')),
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_session_cwd ON session(cwd);
        CREATE INDEX IF NOT EXISTS idx_session_pid ON session(pid);
        CREATE TABLE IF NOT EXISTS session_visit (
            id INTEGER PRIMARY KEY,
            cwd TEXT NOT NULL,
            session_id TEXT,
            last_user_message TEXT NOT NULL DEFAULT '',
            visited_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_session_visit_cwd ON session_visit(cwd);
        CREATE INDEX IF NOT EXISTS idx_session_visit_visited ON session_visit(visited_at DESC);
        CREATE TABLE IF NOT EXISTS hook_status (
            session_id TEXT PRIMARY KEY,
            status TEXT NOT NULL DEFAULT 'unknown',
            tool_name TEXT NOT NULL DEFAULT '',
            last_prompt TEXT NOT NULL DEFAULT '',
            last_response TEXT NOT NULL DEFAULT '',
            error TEXT NOT NULL DEFAULT '',
            cwd TEXT NOT NULL DEFAULT '',
            tmux_session TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    ",
    )?;
    // 마이그레이션: hook_status에 tmux_session 컬럼 추가 (없으면)
    let _ = conn.execute(
        "ALTER TABLE hook_status ADD COLUMN tmux_session TEXT NOT NULL DEFAULT ''",
        [],
    );

    Ok(Arc::new(Mutex::new(conn)))
}

