use std::fs::OpenOptions;
use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};

const ROTATE_THRESHOLD_BYTES: u64 = 5 * 1024 * 1024;

fn timestamp() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let days = secs / 86400;
    // Civil date from days (Howard Hinnant's algorithm)
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    let rem = secs % 86400;
    format!(
        "{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02}",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// Append a lifecycle log line to `<app_data>/logs/app.log` and console.
pub fn log(level: &str, msg: &str) {
    let line = format!("[{}] [{level}] {msg}", timestamp());
    eprintln!("{line}");
    if let Some(dir) = crate::settings::app_data_dir() {
        let logs = dir.join("logs");
        let _ = std::fs::create_dir_all(&logs);
        let log_file = logs.join("app.log");
        rotate_if_needed(&log_file);
        if let Ok(mut f) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_file)
        {
            let _ = writeln!(f, "{line}");
        }
    }
}

/// Keep the log from growing forever: when `app.log` passes the threshold,
/// it becomes `app.log.old` (previous rotation is overwritten).
fn rotate_if_needed(log_file: &std::path::Path) {
    let Ok(meta) = std::fs::metadata(log_file) else {
        return;
    };
    if meta.len() >= ROTATE_THRESHOLD_BYTES {
        let old = log_file.with_extension("log.old");
        let _ = std::fs::rename(log_file, old);
    }
}

#[macro_export]
macro_rules! log_info {
    ($($arg:tt)*) => { $crate::logger::log("INFO", &format!($($arg)*)) };
}

#[macro_export]
macro_rules! log_warn {
    ($($arg:tt)*) => { $crate::logger::log("WARN", &format!($($arg)*)) };
}

#[macro_export]
macro_rules! log_error {
    ($($arg:tt)*) => { $crate::logger::log("ERROR", &format!($($arg)*)) };
}
