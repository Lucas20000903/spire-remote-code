use std::path::Path;

use serde::Serialize;

use crate::jsonl::parser::project_dir_to_cwd;

#[derive(Serialize, Clone)]
pub struct ProjectInfo {
    pub path: String,
    pub name: String,
    pub has_sessions: bool,
    pub last_activity: Option<String>,
}

/// Scan for known projects from two sources:
/// 1. `~/.claude/projects/` directory entries (projects with existing Claude sessions)
/// 2. Git repositories found under each `git_scan_roots` directory
pub async fn list_projects(
    claude_projects_dir: &Path,
    git_scan_roots: &[String],
) -> Vec<ProjectInfo> {
    let mut projects = Vec::new();

    // 1. Scan ~/.claude/projects/
    if let Ok(mut entries) = tokio::fs::read_dir(claude_projects_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if entry
                .file_type()
                .await
                .map(|t| t.is_dir())
                .unwrap_or(false)
            {
                let dir_name = entry.file_name().to_string_lossy().to_string();
                if let Some(cwd) = project_dir_to_cwd(&dir_name) {
                    let name = cwd.rsplit('/').next().unwrap_or(&cwd).to_string();
                    let last_activity = get_last_modified(&entry.path()).await;
                    projects.push(ProjectInfo {
                        path: cwd,
                        name,
                        has_sessions: true,
                        last_activity,
                    });
                }
            }
        }
    }

    // 2. Discover git repositories under scan roots
    for root in git_scan_roots {
        if let Ok(mut entries) = tokio::fs::read_dir(root).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let git_dir = entry.path().join(".git");
                if git_dir.exists() {
                    let path = entry.path().to_string_lossy().to_string();
                    let name = entry.file_name().to_string_lossy().to_string();
                    if !projects.iter().any(|p| p.path == path) {
                        projects.push(ProjectInfo {
                            path,
                            name,
                            has_sessions: false,
                            last_activity: None,
                        });
                    }
                }
            }
        }
    }

    projects.sort_by(|a, b| b.last_activity.cmp(&a.last_activity));
    projects
}

async fn get_last_modified(dir: &Path) -> Option<String> {
    let mut latest = None;
    if let Ok(mut entries) = tokio::fs::read_dir(dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if let Ok(meta) = entry.metadata().await {
                if let Ok(modified) = meta.modified() {
                    latest =
                        Some(latest.map_or(modified, |l: std::time::SystemTime| l.max(modified)));
                }
            }
        }
    }
    latest.map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339())
}
