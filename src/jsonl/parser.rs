use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptEntry {
    pub uuid: String,
    #[serde(rename = "parentUuid")]
    pub parent_uuid: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub timestamp: String,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub message: Message,
    #[serde(rename = "isSidechain", default)]
    pub is_sidechain: bool,
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: Content,
    pub usage: Option<Usage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Content {
    Text(String),
    Blocks(Vec<ContentBlock>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "thinking")]
    Thinking { thinking: String },
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    #[serde(rename = "tool_result")]
    ToolResult {
        tool_use_id: String,
        content: Option<serde_json::Value>,
        #[serde(default)]
        is_error: bool,
    },
    #[serde(rename = "image")]
    Image { source: serde_json::Value },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Usage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cache_creation_input_tokens: Option<u64>,
    pub cache_read_input_tokens: Option<u64>,
}

pub fn parse_entry(line: &str) -> anyhow::Result<TranscriptEntry> {
    let entry: TranscriptEntry = serde_json::from_str(line)?;
    Ok(entry)
}

pub fn cwd_to_project_dir(cwd: &str) -> String {
    format!("-{}", cwd.trim_start_matches('/').replace('/', "-"))
}

pub fn project_dir_to_cwd(dir_name: &str) -> Option<String> {
    if dir_name.starts_with('-') {
        let path = dir_name[1..].replace('-', "/");
        Some(format!("/{}", path))
    } else {
        None
    }
}
