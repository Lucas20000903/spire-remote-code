use notify::{Event, EventKind, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::broadcast;

use super::parser::{parse_entry, Content, ContentBlock, TranscriptEntry};

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
                Ok(entry) if entry.is_conversation() => entries.push(entry),
                _ => {} // skip non-conversation or malformed
            }
        }
        Ok((entries, current_offset))
    }

}

/// cwd에서 프로젝트 디렉토리 내 가장 최근 JSONL 파일 찾기
async fn find_latest_jsonl(projects_dir: &Path, cwd: &str) -> anyhow::Result<std::path::PathBuf> {
    let mangled = crate::jsonl::parser::cwd_to_project_dir(cwd);
    let project_dir = projects_dir.join(&mangled);

    if !project_dir.exists() {
        anyhow::bail!("project dir not found for cwd: {}", cwd);
    }

    let mut best: Option<(std::path::PathBuf, std::time::SystemTime)> = None;
    let mut read_dir = tokio::fs::read_dir(&project_dir).await?;
    while let Some(entry) = read_dir.next_entry().await? {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("jsonl")
            && !path.file_name().unwrap().to_str().unwrap().starts_with("agent-")
        {
            if let Ok(meta) = entry.metadata().await {
                if let Ok(modified) = meta.modified() {
                    if best.as_ref().map_or(true, |(_, t)| modified > *t) {
                        best = Some((path, modified));
                    }
                }
            }
        }
    }

    best.map(|(p, _)| p)
        .ok_or_else(|| anyhow::anyhow!("no JSONL files in {}", project_dir.display()))
}

/// session_id 또는 cwd로 JSONL 파일 찾기
async fn resolve_jsonl_path(
    projects_dir: &Path,
    session_id: &str,
    cwd: Option<&str>,
) -> anyhow::Result<std::path::PathBuf> {
    // 1. session_id로 직접 찾기
    if !session_id.is_empty() {
        let mut read_dir = tokio::fs::read_dir(projects_dir).await?;
        while let Some(entry) = read_dir.next_entry().await? {
            if entry.file_type().await?.is_dir() {
                let candidate = entry.path().join(format!("{}.jsonl", session_id));
                if candidate.exists() {
                    return Ok(candidate);
                }
            }
        }
    }

    // 2. cwd로 최신 JSONL 찾기
    if let Some(cwd) = cwd {
        return find_latest_jsonl(projects_dir, cwd).await;
    }

    anyhow::bail!("session not found: {}", session_id)
}

/// Load the last N messages for a session.
/// tool_use가 포함된 경우, 대응하는 tool_result도 함께 반환하여 페이지 경계 누락 방지.
pub async fn load_history(
    projects_dir: &Path,
    session_id: &str,
    limit: usize,
    before: Option<&str>,
    cwd: Option<&str>,
) -> anyhow::Result<Vec<TranscriptEntry>> {
    let path = resolve_jsonl_path(projects_dir, session_id, cwd).await?;

    let content = tokio::fs::read_to_string(&path).await?;
    let all_entries: Vec<TranscriptEntry> = content
        .lines()
        .filter_map(|line| parse_entry(line.trim()).ok())
        .filter(|e| e.is_conversation() && !e.is_sidechain)
        .collect();

    let mut entries = all_entries.clone();

    if let Some(before_uuid) = before {
        if let Some(pos) = entries.iter().position(|e| e.uuid == before_uuid) {
            entries.truncate(pos);
        }
    }

    // Last N entries
    let start = entries.len().saturating_sub(limit);
    let mut page = entries[start..].to_vec();

    // 페이지 내 tool_use의 대응 tool_result가 누락된 경우 보충
    let tool_use_ids: std::collections::HashSet<String> = page
        .iter()
        .filter_map(|e| e.message.as_ref())
        .flat_map(|m| match &m.content {
            Content::Blocks(blocks) => blocks
                .iter()
                .filter_map(|b| match b {
                    ContentBlock::ToolUse { id, .. } => Some(id.clone()),
                    _ => None,
                })
                .collect::<Vec<_>>(),
            _ => vec![],
        })
        .collect();

    if !tool_use_ids.is_empty() {
        let page_uuids: std::collections::HashSet<String> =
            page.iter().map(|e| e.uuid.clone()).collect();

        for entry in &all_entries {
            if page_uuids.contains(&entry.uuid) {
                continue;
            }
            if let Some(msg) = &entry.message {
                if let Content::Blocks(blocks) = &msg.content {
                    let has_matching_result = blocks.iter().any(|b| match b {
                        ContentBlock::ToolResult { tool_use_id, .. } => {
                            tool_use_ids.contains(tool_use_id)
                        }
                        _ => false,
                    });
                    if has_matching_result {
                        page.push(entry.clone());
                    }
                }
            }
        }

        // 시간순 재정렬
        page.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
    }

    Ok(page)
}
