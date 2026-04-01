mod auth;
mod bridge;
mod config;
mod db;
mod error;
mod jsonl;
mod push;
mod session;
mod state;
mod upload;
mod ws;

use axum::{
    extract::{ws::WebSocketUpgrade, FromRef, Query, State},
    middleware as axum_mw,
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use clap::{Parser, Subcommand};
use config::AppConfig;
use db::DbPool;
use state::AppState;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tower_http::cors::{Any, CorsLayer};
use ws::hub::WsHub;

use bridge::registry::BridgeRegistry;

#[derive(Parser)]
#[command(name = "claude-web", about = "Claude Code Remote web server")]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Reset auth (delete account, next visit triggers re-setup)
    ResetAuth,
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

#[derive(serde::Deserialize)]
struct WsQuery {
    token: Option<String>,
}

async fn ws_handler(
    ws_upgrade: WebSocketUpgrade,
    State(state): State<AppState>,
    Query(query): Query<WsQuery>,
) -> Result<impl IntoResponse, error::AppError> {
    // WebSocket은 Authorization 헤더 대신 query param으로 토큰 검증
    let token = query.token.ok_or(error::AppError::Unauthorized)?;
    let secret = {
        let conn = state.db.lock().unwrap();
        conn.query_row(
            "SELECT value FROM config WHERE key = 'jwt_secret'",
            [],
            |r| r.get::<_, String>(0),
        )
        .map_err(|_| error::AppError::Unauthorized)?
    };
    auth::jwt::verify_token(&token, &secret).map_err(|_| error::AppError::Unauthorized)?;

    let state = Arc::new(state);
    Ok(ws_upgrade.on_upgrade(move |socket| ws::handler::handle_ws(socket, state)))
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    match cli.command {
        Some(Commands::ResetAuth) => {
            let config = AppConfig::from_env();
            let db = db::init_db(&config.db_path).unwrap();
            let conn = db.lock().unwrap();
            conn.execute("DELETE FROM user", []).unwrap();
            conn.execute("DELETE FROM config WHERE key = 'jwt_secret'", [])
                .unwrap();
            println!("Auth reset. Next web visit will prompt for account setup.");
            return;
        }
        None => {}
    }

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
        ws_client_count: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
    };

    // JSONL updates → 자동 session_id 매칭 + WsHub 브로드캐스트
    let ws_hub_clone = state.ws_hub.clone();
    let registry_clone = state.registry.clone();
    tokio::spawn(async move {
        while let Ok(update) = jsonl_rx.recv().await {
            // project_dir → cwd 역산 → 해당 cwd의 Bridge에 session_id 자동 설정
            if !update.session_id.is_empty() {
                if let Some(cwd) = jsonl::parser::project_dir_to_cwd(&update.project_dir) {
                    let bridges = registry_clone.list_active();
                    for bridge in &bridges {
                        if bridge.cwd == cwd && bridge.session_id.as_deref() != Some(&update.session_id) {
                            registry_clone.update_session(&bridge.id, update.session_id.clone());
                            tracing::info!("auto-matched session {} to bridge {} (cwd: {})", update.session_id, bridge.id, cwd);
                        }
                    }
                }
            }

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

    // 인증 필요한 라우트
    let protected = Router::new()
        .route("/api/push/vapid-key", get(push::routes::get_vapid_key))
        .route("/api/push/subscribe", post(push::routes::subscribe))
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
        .layer(axum_mw::from_fn_with_state(
            state.db.clone(),
            auth::middleware::require_auth,
        ));

    // 공개 라우트 (인증 불필요)
    let mut app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/ws", get(ws_handler)) // WS는 query param으로 자체 검증
        .route("/api/auth/status", get(auth::routes::check_status))
        .route("/api/auth/setup", post(auth::routes::setup))
        .route("/api/auth/login", post(auth::routes::login))
        // Bridge 내부 통신 (같은 Mac 내 localhost만 접근)
        .route(
            "/api/bridges/register",
            post(bridge::routes::register),
        )
        .route(
            "/api/bridges/update-session",
            post(bridge::routes::update_session),
        )
        .route("/api/bridges/stream", get(bridge::sse::bridge_stream))
        .merge(protected)
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
