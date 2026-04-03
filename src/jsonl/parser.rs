use serde::{Deserialize, Serialize};

fn deserialize_nullable_string<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Option::<String>::deserialize(deserializer)?.unwrap_or_default())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptEntry {
    #[serde(default, deserialize_with = "deserialize_nullable_string")]
    pub uuid: String,
    #[serde(rename = "parentUuid", default, deserialize_with = "deserialize_nullable_string")]
    pub parent_uuid: String,
    #[serde(rename = "sessionId", default, deserialize_with = "deserialize_nullable_string")]
    pub session_id: String,
    #[serde(default)]
    pub timestamp: String,
    #[serde(rename = "type")]
    pub entry_type: String,
    #[serde(default)]
    pub message: Option<Message>,
    #[serde(rename = "isSidechain", default)]
    pub is_sidechain: bool,
    pub cwd: Option<String>,
    #[serde(rename = "toolUseResult", default)]
    pub tool_use_result: Option<ToolUseResult>,
    #[serde(rename = "sourceToolAssistantUUID", default)]
    pub source_tool_assistant_uuid: Option<String>,
}

impl TranscriptEntry {
    /// user/assistant 대화 엔트리인지 확인
    pub fn is_conversation(&self) -> bool {
        matches!(self.entry_type.as_str(), "user" | "assistant") && self.message.is_some()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: Content,
    pub usage: Option<Usage>,
    #[serde(default)]
    pub stop_reason: Option<String>,
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
    Thinking {
        thinking: String,
        #[serde(default)]
        signature: Option<String>,
    },
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
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Usage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cache_creation_input_tokens: Option<u64>,
    pub cache_read_input_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolUseResult {
    #[serde(default)]
    pub interrupted: bool,
}

pub fn parse_entry(line: &str) -> anyhow::Result<TranscriptEntry> {
    let entry: TranscriptEntry = serde_json::from_str(line)?;
    Ok(entry)
}

#[allow(dead_code)]
pub fn cwd_to_project_dir(cwd: &str) -> String {
    format!("-{}", cwd.trim_start_matches('/').replace('/', "-"))
}

/// Decode a project dir name back to a cwd path.
/// Since `-` is used for both `/` and literal `-`, we try all possible splits
/// and return the first one that exists on disk.
pub fn project_dir_to_cwd(dir_name: &str) -> Option<String> {
    if !dir_name.starts_with('-') {
        return None;
    }
    let parts: Vec<&str> = dir_name[1..].split('-').collect();
    if let Some(path) = resolve_path_parts(&parts, 0, String::new()) {
        Some(format!("/{}", path))
    } else {
        // Fallback: simple replace (for paths that don't exist on disk)
        let path = dir_name[1..].replace('-', "/");
        Some(format!("/{}", path))
    }
}

fn resolve_path_parts(parts: &[&str], idx: usize, current: String) -> Option<String> {
    if idx >= parts.len() {
        let path = format!("/{}", current);
        return if std::path::Path::new(&path).exists() {
            Some(current)
        } else {
            None
        };
    }

    // Try joining with next parts using `-` (literal hyphen)
    let mut accumulated = parts[idx].to_string();
    for end in idx + 1..=parts.len() {
        let candidate = if current.is_empty() {
            accumulated.clone()
        } else {
            format!("{}/{}", current, accumulated)
        };

        if end == parts.len() {
            // Last segment — check if full path exists
            let path = format!("/{}", candidate);
            if std::path::Path::new(&path).exists() {
                return Some(candidate);
            }
        } else {
            // More segments remain — check if this is a valid directory prefix
            let path = format!("/{}", candidate);
            if std::path::Path::new(&path).is_dir() {
                if let Some(result) = resolve_path_parts(parts, end, candidate) {
                    return Some(result);
                }
            }
        }

        if end < parts.len() {
            accumulated = format!("{}-{}", accumulated, parts[end]);
        }
    }
    None
}
