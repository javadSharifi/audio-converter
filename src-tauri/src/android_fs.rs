#[cfg(target_os = "android")]
use std::path::Path;

/// Ensures that an input path is a readable local POSIX file path.
///
/// On Android:
/// - If the path is a `content://` or `file://` URI, or is not directly readable
///   due to Android Scoped Storage restrictions, this copies the data into the app's
///   internal cache directory (`cacheDir/staged_inputs/`) via JNI ContentResolver
///   and returns the local file path.
///
/// On other platforms (Desktop):
/// - Returns the input path directly as-is.
pub fn ensure_local_path(input_path: &str) -> String {
    #[cfg(target_os = "android")]
    {
        // 1. If it's already a readable POSIX file on disk, return it directly
        if !input_path.starts_with("content://") && !input_path.starts_with("file://") {
            if let Ok(file) = std::fs::File::open(input_path) {
                drop(file);
                return input_path.to_string();
            }
        }

        crate::log_info!("Android: Resolving input path / URI: {input_path}");
        match stage_uri_via_jni(input_path) {
            Ok(staged) if Path::new(&staged).exists() => {
                crate::log_info!("Android: Successfully staged '{input_path}' -> '{staged}'");
                staged
            }
            Ok(unresolved) => {
                crate::log_error!("Android: Resolved path does not exist on disk: {unresolved}");
                unresolved
            }
            Err(e) => {
                crate::log_error!("Android: Failed to stage URI via JNI '{input_path}': {e}");
                input_path.to_string()
            }
        }
    }

    #[cfg(not(target_os = "android"))]
    {
        input_path.to_string()
    }
}

#[cfg(target_os = "android")]
static JAVA_VM: std::sync::OnceLock<jni::JavaVM> = std::sync::OnceLock::new();

#[cfg(target_os = "android")]
pub fn set_java_vm(vm: jni::JavaVM) {
    let _ = JAVA_VM.set(vm);
}

#[cfg(target_os = "android")]
fn get_java_vm() -> Result<&'static jni::JavaVM, String> {
    JAVA_VM
        .get()
        .ok_or_else(|| "JavaVM not registered in Rust".to_string())
}

#[cfg(target_os = "android")]
fn stage_uri_via_jni(uri: &str) -> Result<String, String> {
    let vm = get_java_vm()?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("Failed to attach thread: {e}"))?;

    let class = env
        .find_class("com/audioconverter/app/MainActivity")
        .map_err(|e| format!("Failed to find MainActivity class: {e}"))?;

    let j_uri = env
        .new_string(uri)
        .map_err(|e| format!("Failed to create Java string: {e}"))?;

    let result = env
        .call_static_method(
            &class,
            "resolveUriToLocalPath",
            "(Ljava/lang/String;)Ljava/lang/String;",
            &[(&j_uri).into()],
        )
        .map_err(|e| format!("Failed to call resolveUriToLocalPath: {e}"))?;

    let j_obj = result.l().map_err(|e| format!("Expected object: {e}"))?;
    let j_str = jni::objects::JString::from(j_obj);
    let s: String = env
        .get_string(&j_str)
        .map_err(|e| format!("Failed to extract Rust string: {e}"))?
        .into();

    Ok(s)
}
