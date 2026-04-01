mod auth;
mod config;
mod db;
mod error;

use axum::{
    routing::{get, post},
    Router,
};
use config::AppConfig;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let config = AppConfig::from_env();

    let db = db::init_db(&config.db_path).expect("failed to initialize database");

    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/api/auth/status", get(auth::routes::check_status))
        .route("/api/auth/setup", post(auth::routes::setup))
        .route("/api/auth/login", post(auth::routes::login))
        .with_state(db);

    let addr = format!("0.0.0.0:{}", config.port);
    tracing::info!("listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
