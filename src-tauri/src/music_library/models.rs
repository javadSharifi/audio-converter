use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrackInfo {
    pub id: String,
    pub uri: String,
    pub path: Option<String>,
    pub name: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration_secs: f64,
    #[specta(type = u32)]
    pub size_bytes: u64,
    #[specta(type = u32)]
    pub modified_timestamp_ms: u64,
    #[specta(type = u32)]
    pub created_timestamp_ms: u64,
    pub format: String,
    pub mime_type: String,
    pub cover_url: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum LibraryPermissionStatus {
    Granted,
    Denied,
    PermanentlyDenied,
    Restricted,
    NotRequired,
}
