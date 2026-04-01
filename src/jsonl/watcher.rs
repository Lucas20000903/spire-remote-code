use notify::{Event, EventKind, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::broadcast;

use super::parser::{parse_entry, TranscriptEntry};

#[derive(Clone, Debug)]
pub struct JsonlUpdate {
    pub session_id: String,
    pub entries: Vec<TranscriptEntry>,
}

pub struct JsonlWatcher {
    update_tx: broadcast::Sender<JsonlUpdate>,
    offsets: Arc<tokio::sync::Mutex<HashMap<PathBuf, u64>>>,
}

impl JsonlWatcher {
    pub fn new() -> (Self, broadcast::Receiver<JsonlUpdate>) {
        let (tx, rx) = broadcast::channel(256);
        (
            Self {
                update_tx: tx,
                offsets: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            },
            rx,
        )
    }

    pub async fn watch(&self, projects_dir: &Path) -> anyhow::Result<()> {
        let tx = self.update_tx.clone();
        let offsets = self.offsets.clone();
        let dir = projects_dir.to_path_buf();

        let (notify_tx, mut notify_rx) = tokio::sync::mpsc::channel::<PathBuf>(256);

        // File system watcher
        let mut watcher = notify::recommended_watcher(move |res: Result<Event, _>| {
            if let Ok(event) = res {
                if matches!(event.kind, EventKind::Modify(_) | EventKind::Create(_)) {
                    for path in event.paths {
                        if path.extension().and_then(|e| e.to_str()) == Some("jsonl")
                            && !path
                                .file_name()
                                .unwrap()
                                .to_str()
                                .unwrap()
                                .starts_with("agent-")
                        {
                            let _ = notify_tx.blocking_send(path);
                        }
                    }
                }
            }
        })?;
        watcher.watch(&dir, RecursiveMode::Recursive)?;

        // Process changed files
        tokio::spawn(async move {
            let _watcher = watcher; // keep alive
            while let Some(path) = notify_rx.recv().await {
                let mut offsets = offsets.lock().await;
                let offset = offsets.get(&path).copied().unwrap_or(0);
                match Self::read_new_lines(&path, offset).await {
                    Ok((entries, new_offset)) if !entries.is_empty() => {
                        offsets.insert(path, new_offset);
                        if let Some(session_id) = entries.first().map(|e| e.session_id.clone()) {
                            let _ = tx.send(JsonlUpdate {
                                session_id,
                                entries,
                            });
                        }
                    }
                    Ok((_, new_offset)) => {
                        offsets.insert(path, new_offset);
                    }
                    Err(e) => tracing::warn!("jsonl read error: {}", e),
                }
            }
        });

        Ok(())
    }

    async fn read_new_lines(
        path: &Path,
        offset: u64,
    ) -> anyhow::Result<(Vec<TranscriptEntry>, u64)> {
        use tokio::io::{AsyncBufReadExt, AsyncSeekExt, BufReader};
        let mut file = tokio::fs::File::open(path).await?;
        file.seek(std::io::SeekFrom::Start(offset)).await?;
        let mut reader = BufReader::new(file);
        let mut entries = Vec::new();
        let mut current_offset = offset;
        let mut line = String::new();
        loop {
            line.clear();
            let bytes = reader.read_line(&mut line).await?;
            if bytes == 0 {
                break;
            }
            current_offset += bytes as u64;
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            match parse_entry(trimmed) {
                Ok(entry) => entries.push(entry),
                Err(_) => {} // skip malformed
            }
        }
        Ok((entries, current_offset))
    }

    pub fn subscribe(&self) -> broadcast::Receiver<JsonlUpdate> {
        self.update_tx.subscribe()
    }
}

/// Load the last N messages for a session in reverse order
pub async fn load_history(
    projects_dir: &Path,
    session_id: &str,
    limit: usize,
    before: Option<&str>,
) -> anyhow::Result<Vec<TranscriptEntry>> {
    // Search all subdirectories under projects_dir for session_id.jsonl
    let mut found_path = None;
    let mut read_dir = tokio::fs::read_dir(projects_dir).await?;
    while let Some(entry) = read_dir.next_entry().await? {
        if entry.file_type().await?.is_dir() {
            let candidate = entry.path().join(format!("{}.jsonl", session_id));
            if candidate.exists() {
                found_path = Some(candidate);
                break;
            }
        }
    }
    let path =
        found_path.ok_or_else(|| anyhow::anyhow!("session not found: {}", session_id))?;

    let content = tokio::fs::read_to_string(&path).await?;
    let mut entries: Vec<TranscriptEntry> = content
        .lines()
        .filter_map(|line| parse_entry(line.trim()).ok())
        .filter(|e| !e.is_sidechain)
        .collect();

    if let Some(before_ts) = before {
        entries.retain(|e| e.timestamp.as_str() < before_ts);
    }

    // Last N entries
    let start = entries.len().saturating_sub(limit);
    Ok(entries[start..].to_vec())
}
