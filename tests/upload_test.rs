use spire::upload::{ensure_temp_dir, sanitize_filename};
use std::path::Path;

#[test]
fn test_sanitize_filename_strips_path() {
    assert_eq!(sanitize_filename("../../../etc/passwd"), "passwd");
    assert_eq!(sanitize_filename("foo/bar/baz.txt"), "baz.txt");
    assert_eq!(sanitize_filename("normal.png"), "normal.png");
}

#[test]
fn test_sanitize_filename_replaces_null() {
    assert_eq!(sanitize_filename("file\0name.txt"), "file_name.txt");
}

#[test]
fn test_ensure_temp_dir_creates_directory() {
    ensure_temp_dir();
    assert!(Path::new(".temp").exists());
}
