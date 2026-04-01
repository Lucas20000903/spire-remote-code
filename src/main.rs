mod auth;
mod bridge;
mod config;
mod db;
mod error;
mod jsonl;
mod session;
mod state;
mod ws;

use axum::{
    extract::{ws::WebSocketUpgrade, FromRef, State},
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use config::AppConfig;
use db::DbPool;
use state::AppState;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use ws::hub::WsHub;

use bridge::registry::BridgeRegistry;

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

async fn ws_handler(
    ws_upgrade: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let state = Arc::new(state);
    ws_upgrade.on_upgrade(move |socket| ws::handler::handle_ws(socket, state))
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let config = AppConfig::from_env();

    let db = db::init_db(&config.db_path).expect("failed to initialize database");
    let registry = BridgeRegistry::new();
    let ws_hub = WsHub::new();

    let port = config.port;

    let state = AppState {
        db,
        registry,
        ws_hub,
        config,
        bridge_senders: Arc::new(RwLock::new(HashMap::new())),
    };

    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/ws", get(ws_handler))
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
        .route(
            "/api/projects",
            get(|State(state): State<AppState>| async move {
                let roots: Vec<String> = vec!["/Users/lucas/workspace".into()];
                let projects = session::projects::list_projects(
                    &state.config.claude_projects_dir,
                    &roots,
                )
                .await;
                axum::Json(serde_json::json!({ "projects": projects }))
            }),
        )
        .with_state(state);

    let addr = format!("0.0.0.0:{}", port);
    tracing::info!("listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
