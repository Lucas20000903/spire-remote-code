use std::path::PathBuf;
use tokio::process::Command;

fn load_skip_permissions() -> bool {
    let path = dirs::home_dir()
        .unwrap_or_default()
        .join(".spire/preferences.toml");
    let content = std::fs::read_to_string(&path).unwrap_or_default();
    content.lines().any(|l| l.trim().starts_with("skip_permissions") && l.contains("true"))
}

/// Create a new Claude Code session in a tmux window for the given working directory.
/// Reads user preferences for skip_permissions. Always uses expect to auto-confirm.
pub async fn create_session(cwd: &str) -> anyhow::Result<String> {
    let short_id = &uuid::Uuid::new_v4().to_string()[..8];
    let session_name = format!("spire-{}", short_id);

    let output = Command::new("tmux")
        .args(["new-session", "-d", "-s", &session_name, "-c", cwd])
        .output()
        .await?;

    if !output.status.success() {
        anyhow::bail!(
            "tmux new-session failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let mut claude_args = String::from("claude --dangerously-load-development-channels server:spire");
    if load_skip_permissions() {
        claude_args.push_str(" --dangerously-skip-permissions");
    }

    // expect로 "Enter to confirm" 자동 확인
    let expect_cmd = format!(
        "expect -c 'set timeout 30; spawn {}; expect \"Enter to confirm\"; send \"\\r\"; interact'",
        claude_args
    );
    let _ = Command::new("tmux")
        .args(["send-keys", "-t", &session_name, &expect_cmd, "Enter"])
        .output()
        .await?;

    Ok(session_name)
}

/// List all active tmux sessions whose names start with "claude-".
pub async fn list_sessions() -> anyhow::Result<Vec<String>> {
    let output = Command::new("tmux")
        .args(["list-sessions", "-F", "#{session_name}"])
        .output()
        .await?;

    let names = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|l| l.starts_with("claude-"))
        .map(String::from)
        .collect();

    Ok(names)
}
