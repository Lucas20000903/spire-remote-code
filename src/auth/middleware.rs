use axum::{
    extract::{Request, State},
    http::header::AUTHORIZATION,
    middleware::Next,
    response::Response,
};

use crate::{db::DbPool, error::AppError};

use super::jwt;

pub async fn require_auth(
    State(db): State<DbPool>,
    mut req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let token = req
        .headers()
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or(AppError::Unauthorized)?;

    let secret = {
        let conn = db.lock().unwrap();
        conn.query_row(
            "SELECT value FROM config WHERE key = 'jwt_secret'",
            [],
            |r| r.get::<_, String>(0),
        )
        .map_err(|_| AppError::Unauthorized)?
    };

    let claims = jwt::verify_token(token, &secret).map_err(|_| AppError::Unauthorized)?;
    req.extensions_mut().insert(claims);
    Ok(next.run(req).await)
}
