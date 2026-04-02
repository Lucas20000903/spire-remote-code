mod auth;
mod bridge;
mod cli;
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
#[command(name = "spire", about = "Spire — Remote web UI for Claude Code")]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,

    /// Server port (default: 3000, or $PORT env)
    #[arg(short, long)]
    port: Option<u16>,
}

#[derive(Subcommand)]
enum Commands {
    /// Reset auth (delete account, next visit triggers re-setup)
    ResetAuth,
    /// Launch Claude Code with Spire channel flags
    Cc,
    /// Interactive setup: register MCP server + configure preferences
    Setup,
    /// Restart the background server (LaunchAgent)
    Restart,
    /// Stop the background server
    Stop,
    /// Start the background server
    Start,
    /// Show whether the background server is running
    Status,
    /// Rebuild from source and restart the background server
    Rebuild,
    /// Start development server (cargo-watch + Vite HMR)
    Dev,
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
        Some(Commands::Cc) => {
            cli::launch_cc();
            return;
        }
        Some(Commands::Setup) => {
            cli::run_setup();
            return;
        }
        Some(Commands::Restart) => {
            cli::service_restart();
            return;
        }
        Some(Commands::Stop) => {
            cli::service_stop();
            return;
        }
        Some(Commands::Start) => {
            cli::service_start();
            return;
        }
        Some(Commands::Status) => {
            cli::service_status();
            return;
        }
        Some(Commands::Rebuild) => {
            cli::service_rebuild();
            return;
        }
        Some(Commands::Dev) => {
            cli::dev_server();
            return;
        }
        None => {}
    }

    // RUST_LOG 미설정이면 info로 기본값
    if std::env::var("RUST_LOG").is_err() {
        std::env::set_var("RUST_LOG", "info");
    }
    tracing_subscriber::fmt::init();
    let mut config = AppConfig::from_env();
    if let Some(port) = cli.port {
        config.port = port;
    }

    let db = db::init_db(&config.db_path).expect("failed to initialize database");
    let registry = BridgeRegistry::new(db.clone());
    let ws_hub = WsHub::new();

    let port = config.port;

    // JSONL watcher: watch for transcript changes and broadcast to WS clients
    let (jsonl_watcher, mut jsonl_rx) = jsonl::watcher::JsonlWatcher::new();
    jsonl_watcher
        .watch(&config.claude_projects_dir)
        .await
        .unwrap();

    let static_dir = config.static_dir.clone();

    upload::ensure_temp_dir();

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
            // 엔트리의 cwd 필드로 bridge 매칭 + session_id 자동 설정
            let entry_cwd = update.entries.first().and_then(|e| e.cwd.clone());
            let entry_ts = update.entries.last()
                .and_then(|e| chrono::DateTime::parse_from_rfc3339(&e.timestamp).ok())
                .map(|dt| dt.with_timezone(&chrono::Utc));

            if !update.session_id.is_empty() {
                let existing = registry_clone.find_by_session(&update.session_id);
                // 이미 이 session_id가 매칭된 bridge가 없는 경우에만 auto-match
                if existing.is_none() {
                    if let Some(ref cwd) = entry_cwd {
                        let bridges = registry_clone.list_active();
                        // session_id가 아직 None인 bridge 중 cwd 매칭 + 엔트리가 bridge 등록 이후인 것만
                        if let Some(bridge) = bridges.iter().find(|b| {
                            b.session_id.is_none()
                                && (b.cwd == *cwd || cwd.starts_with(&b.cwd) || b.cwd.starts_with(cwd.as_str()))
                                && entry_ts.map_or(true, |ts| ts >= b.registered_at)
                        }) {
                            registry_clone.update_session(&bridge.id, update.session_id.clone());
                            tracing::info!("auto-matched session {} to bridge {} (cwd: {})", update.session_id, bridge.id, cwd);
                        }
                    }
                }
            }

            // bridge_id 역조회: session_id로 찾기
            let bridge_id = registry_clone.find_by_session(&update.session_id)
                .map(|b| b.id.clone());

            let msg = serde_json::json!({
                "type": "jsonl_update",
                "session_id": update.session_id,
                "bridge_id": bridge_id,
                "messages": update.entries,
            });
            ws_hub_clone
                .broadcast_all(serde_json::to_string(&msg).unwrap())
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
        .route(
            "/api/upload",
            post(upload::handle_upload)
                .layer(axum::extract::DefaultBodyLimit::max(50 * 1024 * 1024)),
        )
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
        .route(
            "/api/debug/bridges",
            get(|State(state): State<AppState>| async move {
                let bridges: Vec<_> = state.registry.list_active().iter().map(|b| {
                    serde_json::json!({
                        "id": b.id,
                        "cwd": b.cwd,
                        "port": b.port,
                        "pid": b.pid,
                        "session_id": b.session_id,
                    })
                }).collect();
                axum::Json(serde_json::json!({ "bridges": bridges }))
            }),
        )
        .route(
            "/api/favorites",
            get(|State(state): State<AppState>| async move {
                let conn = state.db.lock().unwrap();
                let mut stmt = conn.prepare("SELECT cwd FROM favorite ORDER BY created_at").unwrap();
                let favs: Vec<String> = stmt.query_map([], |row| row.get(0)).unwrap().filter_map(|r| r.ok()).collect();
                axum::Json(serde_json::json!({ "favorites": favs }))
            })
            .post(|State(state): State<AppState>, axum::Json(body): axum::Json<serde_json::Value>| async move {
                let cwd = body["cwd"].as_str().unwrap_or("");
                if cwd.is_empty() {
                    return (axum::http::StatusCode::BAD_REQUEST, axum::Json(serde_json::json!({ "error": "cwd required" })));
                }
                let conn = state.db.lock().unwrap();
                conn.execute("INSERT OR IGNORE INTO favorite (cwd) VALUES (?1)", [cwd]).unwrap();
                (axum::http::StatusCode::OK, axum::Json(serde_json::json!({ "ok": true })))
            }),
        )
        .route(
            "/api/favorites/{cwd}",
            axum::routing::delete(|State(state): State<AppState>, axum::extract::Path(cwd): axum::extract::Path<String>| async move {
                let conn = state.db.lock().unwrap();
                conn.execute("DELETE FROM favorite WHERE cwd = ?1", [&cwd]).unwrap();
                axum::Json(serde_json::json!({ "ok": true }))
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
        .route(
            "/api/bridges/permission_request",
            post(bridge::routes::permission_request),
        )
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
    println!("\n  Spire v{}", env!("CARGO_PKG_VERSION"));
    println!("  Server: http://{}\n", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
