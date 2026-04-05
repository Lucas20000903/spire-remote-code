use tokio::process::Command;

fn load_skip_permissions() -> bool {
    let path = dirs::home_dir()
        .unwrap_or_default()
        .join(".spire/preferences.toml");
    let content = std::fs::read_to_string(&path).unwrap_or_default();
    content.lines().any(|l| l.trim().starts_with("skip_permissions") && l.contains("true"))
}

/// Create a new Claude Code session in a tmux window for the given working directory.
pub async fn create_session(cwd: &str) -> anyhow::Result<String> {
    let short_id = &uuid::Uuid::new_v4().to_string()[..8];
    let session_name = format!("spire-{}", short_id);

    // tmux 세션 생성 (cwd 지정)
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

    // Claude Code 명령어 구성
    let mut claude_args = vec![
        "claude".to_string(),
        "--dangerously-load-development-channels".to_string(),
        "server:spire".to_string(),
    ];
    if load_skip_permissions() {
        claude_args.push("--dangerously-skip-permissions".to_string());
    }

    let claude_cmd = claude_args.join(" ");

    // 직접 send-keys로 명령어 실행 (expect 불필요)
    let _ = Command::new("tmux")
        .args(["send-keys", "-t", &session_name, &claude_cmd, "Enter"])
        .output()
        .await?;

    // 2초 후 Enter 한번 더 (채널 확인 프롬프트 자동 승인)
    tokio::spawn({
        let name = session_name.clone();
        async move {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            let _ = Command::new("tmux")
                .args(["send-keys", "-t", &name, "", "Enter"])
                .output()
                .await;
        }
    });

    Ok(session_name)
}
