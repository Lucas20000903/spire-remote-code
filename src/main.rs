mod auth;
mod bridge;
mod config;
mod db;
mod error;

use axum::{
    extract::FromRef,
    routing::{get, post},
    Router,
};
use config::AppConfig;
use db::DbPool;
use std::sync::Arc;

use bridge::registry::BridgeRegistry;

#[derive(Clone)]
pub struct AppState {
    pub db: DbPool,
    pub registry: Arc<BridgeRegistry>,
}

impl FromRef<AppState> for DbPool {
    fn from_ref(state: &AppState) -> Self {
        state.db.clone()
    }
}

impl FromRef<AppState> for Arc<BridgeRegistry> {
    fn from_ref(state: &AppState) -> Self {
        state.registry.clone()
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let config = AppConfig::from_env();

    let db = db::init_db(&config.db_path).expect("failed to initialize database");
    let registry = BridgeRegistry::new();

    let state = AppState { db, registry };

    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/api/auth/status", get(auth::routes::check_status))
        .route("/api/auth/setup", post(auth::routes::setup))
        .route("/api/auth/login", post(auth::routes::login))
        .route(
            "/api/bridges/register",
            post(bridge::routes::register),
        )
        .route(
            "/api/bridges/update-session",
            post(bridge::routes::update_session),
        )
        .route("/api/bridges/stream", get(bridge::sse::bridge_stream))
        .with_state(state);

    let addr = format!("0.0.0.0:{}", config.port);
    tracing::info!("listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
