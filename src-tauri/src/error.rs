use serde::{Serialize, Serializer};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("Archive error: {0}")]
    Zip(#[from] zip::result::ZipError),

    #[error("XML parser error: {0}")]
    Xml(#[from] quick_xml::Error),

    #[error("Image processing error: {0}")]
    Image(#[from] image::ImageError),

    #[error("Serialization error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("EPUB container.xml missing or invalid")]
    MissingContainer,

    #[error("EPUB rootfile (OPF) not found")]
    MissingOpf,

    #[error("EPUB spine items missing or empty")]
    EmptySpine,

    #[error("Book with ID '{0}' not found")]
    BookNotFound(String),

    #[error("Chapter at index {0} not found for book '{1}'")]
    ChapterNotFound(usize, String),

    #[error("Security violation: path traversal detected '{0}'")]
    PathTraversal(String),

    #[error("Invalid URI format: '{0}'")]
    InvalidUri(String),

    #[error("Generic error: {0}")]
    Custom(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
