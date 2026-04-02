use axum::extract::Multipart;
use axum::Json;
use serde_json::{json, Value};
use std::path::PathBuf;

use crate::error::AppError;

const MAX_FILE_SIZE: usize = 50 * 1024 * 1024; // 50MB

fn temp_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".spire/temp")
}

/// Sanitize filename: strip path components, replace problematic chars
pub fn sanitize_filename(name: &str) -> String {
    let name = std::path::Path::new(name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file");
    name.replace(['/', '\\', '\0'], "_")
}

pub fn ensure_temp_dir() {
    let dir = temp_dir();
    if !dir.exists() {
        std::fs::create_dir_all(&dir).expect("failed to create .temp directory");
    }
}

pub async fn handle_upload(mut multipart: Multipart) -> Result<Json<Value>, AppError> {
    let field = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?
        .ok_or_else(|| AppError::BadRequest("No file provided".into()))?;

    let original_name = field
        .file_name()
        .unwrap_or("file")
        .to_string();
    let sanitized = sanitize_filename(&original_name);

    let data = field
        .bytes()
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?;

    if data.len() > MAX_FILE_SIZE {
        return Err(AppError::PayloadTooLarge);
    }

    let uuid = uuid::Uuid::new_v4();
    let filename = format!("{}-{}", uuid, sanitized);
    let path = temp_dir().join(&filename);

    tokio::fs::write(&path, &data)
        .await
        .map_err(|e| AppError::Internal(e.into()))?;

    let abs_path = path
        .canonicalize()
        .unwrap_or(path)
        .to_string_lossy()
        .to_string();

    Ok(Json(json!({
        "path": abs_path,
        "name": original_name,
    })))
}
