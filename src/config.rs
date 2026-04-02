use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub port: u16,
    pub db_path: PathBuf,
    pub claude_projects_dir: PathBuf,
    pub bridge_port_min: u16,
    pub bridge_port_max: u16,
    pub static_dir: Option<PathBuf>,
}

impl Default for AppConfig {
    fn default() -> Self {
        let home = dirs::home_dir().expect("home dir");
        Self {
            port: 3000,
            db_path: home.join(".spire/data.db"),
            claude_projects_dir: home.join(".claude/projects"),
            bridge_port_min: 8800,
            bridge_port_max: 8899,
            static_dir: None,
        }
    }
}

impl AppConfig {
    pub fn from_env() -> Self {
        let mut config = Self::default();
        // preferences.toml → 환경변수 순으로 덮어쓰기 (CLI -p 플래그는 main.rs에서 처리)
        if let Some(prefs_port) = Self::read_prefs_port() {
            config.port = prefs_port;
        }
        if let Ok(p) = std::env::var("PORT") {
            config.port = p.parse().unwrap_or(config.port);
        }
        if let Ok(range) = std::env::var("BRIDGE_PORT_RANGE") {
            if let Some((min, max)) = range.split_once('-') {
                config.bridge_port_min = min.parse().unwrap_or(8800);
                config.bridge_port_max = max.parse().unwrap_or(8899);
            }
        }
        if let Ok(dir) = std::env::var("STATIC_DIR") {
            config.static_dir = Some(PathBuf::from(dir));
        } else {
            // Auto-detect: check ./web/dist relative to cwd or executable
            let candidates = [
                std::env::current_dir().ok().map(|p| p.join("web/dist")),
                std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.join("web/dist"))),
            ];
            for candidate in candidates.into_iter().flatten() {
                if candidate.join("index.html").exists() {
                    config.static_dir = Some(candidate);
                    break;
                }
            }
        }
        config
    }

    fn read_prefs_port() -> Option<u16> {
        let path = dirs::home_dir()?.join(".spire/preferences.toml");
        let content = std::fs::read_to_string(path).ok()?;
        for line in content.lines() {
            if line.trim().starts_with("port") {
                return line.split('=').nth(1)?.trim().parse().ok();
            }
        }
        None
    }
}
