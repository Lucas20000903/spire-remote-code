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
use tower_http::cors::{Any, CorsLayer};
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

    // JSONL watcher: watch for transcript changes and broadcast to WS clients
    let (jsonl_watcher, mut jsonl_rx) = jsonl::watcher::JsonlWatcher::new();
    jsonl_watcher
        .watch(&config.claude_projects_dir)
        .await
        .unwrap();

    let static_dir = config.static_dir.clone();

    let state = AppState {
        db,
        registry,
        ws_hub,
        config,
        bridge_senders: Arc::new(RwLock::new(HashMap::new())),
    };

    // JSONL updates → WsHub: broadcast parsed entries to session subscribers
    let ws_hub_clone = state.ws_hub.clone();
    tokio::spawn(async move {
        while let Ok(update) = jsonl_rx.recv().await {
            let msg = serde_json::json!({
                "type": "jsonl_update",
                "session_id": update.session_id,
                "messages": update.entries,
            });
            ws_hub_clone
                .broadcast_to_session(
                    &update.session_id,
                    serde_json::to_string(&msg).unwrap(),
                )
                .await;
        }
    });

    // Bridge events → WsHub: broadcast registration/session changes to all clients
    let mut bridge_events = state.registry.subscribe_events();
    let ws_hub_clone2 = state.ws_hub.clone();
    tokio::spawn(async move {
        while let Ok(event) = bridge_events.recv().await {
            match event {
                bridge::registry::BridgeEvent::Registered(info) => {
                    let msg = serde_json::json!({
                        "type": "session_registered",
                        "session": {
                            "id": info.session_id,
                            "cwd": info.cwd,
                            "port": info.port,
                            "bridge_id": info.id,
                        }
                    });
                    ws_hub_clone2
                        .broadcast_all(serde_json::to_string(&msg).unwrap())
                        .await;
                }
                bridge::registry::BridgeEvent::Unregistered(id) => {
                    let msg = serde_json::json!({
                        "type": "session_unregistered",
                        "bridge_id": id,
                    });
                    ws_hub_clone2
                        .broadcast_all(serde_json::to_string(&msg).unwrap())
                        .await;
                }
                bridge::registry::BridgeEvent::SessionUpdated {
                    bridge_id,
                    session_id,
                } => {
                    let msg = serde_json::json!({
                        "type": "session_updated",
                        "bridge_id": bridge_id,
                        "session_id": session_id,
                    });
                    ws_hub_clone2
                        .broadcast_all(serde_json::to_string(&msg).unwrap())
                        .await;
                }
            }
        }
    });

    // CORS layer for development
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let mut app = Router::new()
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
        .layer(cors)
        .with_state(state);

    // Static file serving for built React PWA with SPA fallback
    if let Some(ref dir) = static_dir {
        app = app.fallback_service(
            tower_http::services::ServeDir::new(dir)
                .fallback(tower_http::services::ServeFile::new(dir.join("index.html"))),
        );
    }

    let addr = format!("0.0.0.0:{}", port);
    tracing::info!("listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
