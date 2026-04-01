use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::{db::DbPool, error::AppError};

use super::jwt;

#[derive(Deserialize)]
pub struct SetupRequest {
    pub username: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct AuthResponse {
    pub token: String,
}

#[derive(Serialize)]
pub struct AuthStatus {
    pub initialized: bool,
}

pub async fn check_status(State(db): State<DbPool>) -> Json<AuthStatus> {
    let conn = db.lock().unwrap();
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM user", [], |r| r.get(0))
        .unwrap_or(0);
    Json(AuthStatus {
        initialized: count > 0,
    })
}

pub async fn setup(
    State(db): State<DbPool>,
    Json(req): Json<SetupRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    let conn = db.lock().unwrap();
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM user", [], |r| r.get(0))
        .unwrap_or(0);
    if count > 0 {
        return Err(AppError::BadRequest("Account already exists".into()));
    }
    let hash = bcrypt::hash(&req.password, 10).map_err(|e| AppError::Internal(e.into()))?;
    conn.execute(
        "INSERT INTO user (username, password_hash) VALUES (?1, ?2)",
        [&req.username, &hash],
    )
    .map_err(|e| AppError::Internal(e.into()))?;

    let secret = ensure_jwt_secret(&conn)?;
    let token = jwt::create_token(1, &req.username, &secret)?;
    Ok(Json(AuthResponse { token }))
}

pub async fn login(
    State(db): State<DbPool>,
    Json(req): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    let conn = db.lock().unwrap();
    let (id, hash): (i64, String) = conn
        .query_row(
            "SELECT id, password_hash FROM user WHERE username = ?1",
            [&req.username],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| AppError::Unauthorized)?;

    if !bcrypt::verify(&req.password, &hash).unwrap_or(false) {
        return Err(AppError::Unauthorized);
    }
    let secret = ensure_jwt_secret(&conn)?;
    let token = jwt::create_token(id, &req.username, &secret)?;
    Ok(Json(AuthResponse { token }))
}

fn ensure_jwt_secret(conn: &rusqlite::Connection) -> anyhow::Result<String> {
    match conn.query_row(
        "SELECT value FROM config WHERE key = 'jwt_secret'",
        [],
        |r| r.get::<_, String>(0),
    ) {
        Ok(s) => Ok(s),
        Err(_) => {
            let secret = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO config (key, value) VALUES ('jwt_secret', ?1)",
                [&secret],
            )?;
            Ok(secret)
        }
    }
}
