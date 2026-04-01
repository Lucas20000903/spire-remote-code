mod config;
mod error;

use axum::{routing::get, Router};
use config::AppConfig;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let config = AppConfig::from_env();

    let app = Router::new()
        .route("/health", get(|| async { "ok" }));

    let addr = format!("0.0.0.0:{}", config.port);
    tracing::info!("listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
