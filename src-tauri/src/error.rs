use serde::Serialize;

#[derive(Debug)]
pub enum AppError {
    Io(String),
    FFmpeg(String),
    NoAudioTrack(String),
    CorruptedFile(String),
    InsufficientDiskSpace { needed: u64, available: u64 },
    InvalidInput(String),
    Cancelled,
    NotFound(String),
    Other(String),
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::Io(m) => write!(f, "File system error: {m}"),
            AppError::FFmpeg(m) => write!(f, "Processing failed: {m}"),
            AppError::NoAudioTrack(_) => write!(f, "This file has no audio track"),
            AppError::CorruptedFile(_) => write!(f, "Unable to read input file (corrupted or unsupported)"),
            AppError::InsufficientDiskSpace { needed, available } => write!(
                f,
                "Not enough disk space. Need about {:.1} MB, only {:.1} MB available.",
                *needed as f64 / 1_048_576.0,
                *available as f64 / 1_048_576.0
            ),
            AppError::InvalidInput(m) => write!(f, "Invalid input: {m}"),
            AppError::Cancelled => write!(f, "Cancelled"),
            AppError::NotFound(m) => write!(f, "Not found: {m}"),
            AppError::Other(m) => write!(f, "{m}"),
        }
    }
}

impl std::error::Error for AppError {}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Other(format!("Serialization error: {e}"))
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        #[derive(Serialize)]
        struct Repr {
            kind: String,
            message: String,
            technical: Option<String>,
        }
        let technical = match self {
            AppError::NoAudioTrack(t) | AppError::CorruptedFile(t) => Some(t.clone()),
            _ => None,
        };
        let repr = Repr {
            kind: format!("{self:?}").split('(').next().unwrap_or("Error").to_string(),
            message: self.to_string(),
            technical,
        };
        serde::Serialize::serialize(&repr, serializer)
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
