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
        if let Ok(p) = std::env::var("PORT") {
            config.port = p.parse().unwrap_or(3000);
        }
        if let Ok(range) = std::env::var("BRIDGE_PORT_RANGE") {
            if let Some((min, max)) = range.split_once('-') {
                config.bridge_port_min = min.parse().unwrap_or(8800);
                config.bridge_port_max = max.parse().unwrap_or(8899);
            }
        }
        if let Ok(dir) = std::env::var("STATIC_DIR") {
            config.static_dir = Some(PathBuf::from(dir));
        }
        config
    }
}
