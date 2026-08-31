//! Android platform bridge.
//!
//! - Input staging: `content://` / `file://` URIs are copied ONCE into
//!   `cacheDir/staged_inputs/` and remembered (URI → staged path) so re-adding
//!   the same media never creates duplicate rows or duplicate cache copies.
//! - Output flow: conversions are written to `filesDir/converted`, then
//!   published into the shared `Music/AudioConverter` media collection via
//!   MediaStore — user-visible in any file manager, no storage permission.
//! - Staged-file lifecycle: files are deleted ONLY via `delete_staged_input`
//!   (explicit user action), ONLY inside the app's own staging dir.

/// Staged input path/URI → readable local POSIX path (no-op on desktop).
///
/// On failure the ORIGINAL input is returned so downstream probe/convert
/// errors surface naturally — a fabricated path is never invented.
pub fn ensure_local_path(input_path: &str) -> String {
    #[cfg(target_os = "android")]
    {
        // 1. Already a readable POSIX file on disk → use it directly.
        if !input_path.starts_with("content://") && !input_path.starts_with("file://") {
            if let Ok(file) = std::fs::File::open(input_path) {
                drop(file);
                return input_path.to_string();
            }
        }

        // 2. URI cache: the same URI always maps to the same staged file for
        //    the lifetime of the session (MainActivity wipes the staging dir
        //    on cold start, so a stale entry is detected by the exists() check
        //    and re-staged automatically).
        if let Some(hit) = uri_cache_get(input_path) {
            return hit;
        }

        crate::log_info!("Android: Resolving input path / URI: {input_path}");
        match stage_uri_via_jni(input_path) {
            // Kotlin reports failures as `STAGE_ERROR|<reason>` — log the real
            // reason and fall back to the original input (caller surfaces a
            // per-job error instead of crashing or inventing a path).
            Ok(staged) if staged.starts_with("STAGE_ERROR|") => {
                let reason = staged.trim_start_matches("STAGE_ERROR|");
                crate::log_error!("Android: staging failed for '{input_path}': {reason}");
                input_path.to_string()
            }
            Ok(staged) if std::path::Path::new(&staged).exists() => {
                crate::log_info!("Android: Successfully staged '{input_path}' -> '{staged}'");
                uri_cache_insert(input_path.to_string(), staged.clone());
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

/// Delete a staged input file — Android only, and ONLY files we staged
/// ourselves (looked up from the URI → staged-path cache). `file_path` may be
/// the original `content://` URI or a staged path; anything else (plain user
/// paths, `file://` URIs) is NEVER deleted, so user files can never be
/// matched by a substring accident.
#[allow(unused_variables)]
pub fn delete_staged_input(file_path: &str) {
    #[cfg(target_os = "android")]
    {
        // Rows on Android store the content URI, not the staged path.
        let target: String = if file_path.starts_with("content://") {
            match uri_cache_get(file_path) {
                Some(staged) => staged,
                None => return,
            }
        } else {
            return; // file:// or plain paths are never our staged copies
        };

        let Some(staging) = staging_dir() else {
            return;
        };
        let Ok(target_canon) = std::fs::canonicalize(&target) else {
            return;
        };
        let Ok(staging_canon) = std::fs::canonicalize(&staging) else {
            return;
        };
        if !target_canon.starts_with(&staging_canon) || !target_canon.is_file() {
            return;
        }
        match std::fs::remove_file(&target_canon) {
            Ok(()) => {
                crate::log_info!("Deleted staged input file: {file_path}");
                uri_cache_remove_target(&target);
            }
            Err(e) => crate::log_warn!("Failed to delete staged input {file_path}: {e}"),
        }
    }
}

/// Root directory for conversion outputs on Android (internal
/// `filesDir/converted`). After a job succeeds, `publish_outputs` moves each
/// file into the shared `Music/AudioConverter` collection via MediaStore —
/// user-visible in any file manager, no storage permission required.
#[cfg(target_os = "android")]
pub fn output_root() -> Option<std::path::PathBuf> {
    std::env::var("TAURI_ANDROID_FILES_DIR")
        .ok()
        .map(|base| std::path::PathBuf::from(base).join("converted"))
}

/// Publish finished outputs into the shared media store (Android).
/// Returns the user-facing locations; on any failure the original internal
/// paths are returned so the job still reports success with real files.
#[cfg(not(target_os = "android"))]
pub fn publish_outputs(paths: &[String]) -> Vec<String> {
    paths.to_vec()
}

#[cfg(target_os = "android")]
pub fn publish_outputs(paths: &[String]) -> Vec<String> {
    if paths.is_empty() {
        return paths.to_vec();
    }
    // Paths never contain newlines (control chars are stripped at staging),
    // so a newline join is a safe single-String bridge over JNI.
    let joined = paths.join("\n");
    match call_static_string(
        "publishOutputs",
        "(Ljava/lang/String;)Ljava/lang/String;",
        &joined,
    ) {
        Ok(s) if !s.is_empty() => s.split('\n').map(String::from).collect(),
        Ok(_) => {
            crate::log_warn!("publishOutputs returned nothing — keeping internal outputs");
            paths.to_vec()
        }
        Err(e) => {
            crate::log_error!("publish_outputs via JNI failed: {e}");
            paths.to_vec()
        }
    }
}

/// `cacheDir/staged_inputs` — where MainActivity stages URI inputs.
#[cfg(target_os = "android")]
fn staging_dir() -> Option<std::path::PathBuf> {
    std::env::var("TAURI_ANDROID_CACHE_DIR")
        .ok()
        .map(|base| std::path::PathBuf::from(base).join("staged_inputs"))
}

// ---------------------------------------------------------------------------
// URI → staged path session cache
// ---------------------------------------------------------------------------

#[cfg(target_os = "android")]
static URI_CACHE: std::sync::Mutex<Option<std::collections::HashMap<String, String>>> =
    std::sync::Mutex::new(None);

#[cfg(target_os = "android")]
fn uri_cache_get(uri: &str) -> Option<String> {
    let guard = URI_CACHE.lock().unwrap();
    let staged = guard.as_ref()?.get(uri)?.clone();
    // MainActivity wipes the staging dir on cold start; detect that.
    if std::path::Path::new(&staged).exists() {
        Some(staged)
    } else {
        None
    }
}

#[cfg(target_os = "android")]
fn uri_cache_insert(uri: String, staged: String) {
    let mut guard = URI_CACHE.lock().unwrap();
    guard
        .get_or_insert_with(std::collections::HashMap::new)
        .insert(uri, staged);
}

/// Drop every cache entry that points at `staged_path` (called after delete).
#[cfg(target_os = "android")]
fn uri_cache_remove_target(staged_path: &str) {
    let mut guard = URI_CACHE.lock().unwrap();
    if let Some(map) = guard.as_mut() {
        map.retain(|_, v| v != staged_path);
    }
}

// ---------------------------------------------------------------------------
// JNI bridge
// ---------------------------------------------------------------------------

#[cfg(target_os = "android")]
static JAVA_VM: std::sync::OnceLock<jni::JavaVM> = std::sync::OnceLock::new();

/// MainActivity class captured ONCE from a Java-invoked native method.
///
/// CRITICAL: JNI `FindClass` on an attached background (non-Java) thread uses
/// only the SYSTEM classloader, which cannot see app classes — calling it from
/// the tokio worker threads always fails with NoClassDefFoundError and leaves
/// a pending Java exception behind. The next JNI call on that pooled thread
/// then aborts the whole process (app crash). Caching the class as a GlobalRef
/// from `initNativePaths` (invoked BY MainActivity, so the caller's classloader
/// applies) removes both problems.
#[cfg(target_os = "android")]
static MAIN_ACTIVITY_CLASS: std::sync::OnceLock<jni::objects::GlobalRef> =
    std::sync::OnceLock::new();

#[cfg(target_os = "android")]
pub fn set_java_vm(vm: jni::JavaVM) {
    let _ = JAVA_VM.set(vm);
}

/// Cache the MainActivity class reference. MUST be called from a
/// Java-invoked native method (initNativePaths) — never from worker threads.
#[cfg(target_os = "android")]
pub fn cache_main_activity_class(env: &mut jni::JNIEnv) {
    if MAIN_ACTIVITY_CLASS.get().is_none() {
        if let Ok(class) = env.find_class("com/audioconverter/app/MainActivity") {
            if let Ok(global) = env.new_global_ref(&class) {
                let _ = MAIN_ACTIVITY_CLASS.set(global);
                crate::log_info!("Android JNI: MainActivity class cached");
            }
        }
    }
    // Never let a pending exception (e.g. a failed first lookup) survive.
    if env.exception_check().unwrap_or(false) {
        let _ = env.exception_clear();
    }
}

#[cfg(target_os = "android")]
fn get_java_vm() -> Result<&'static jni::JavaVM, String> {
    JAVA_VM
        .get()
        .ok_or_else(|| "JavaVM not registered in Rust".to_string())
}

#[cfg(target_os = "android")]
fn stage_uri_via_jni(uri: &str) -> Result<String, String> {
    call_static_string(
        "resolveUriToLocalPath",
        "(Ljava/lang/String;)Ljava/lang/String;",
        uri,
    )
}

/// Resolve the MainActivity class for a JNI call: prefer the GlobalRef cached
/// from the Java-invoked context (background threads cannot FindClass app
/// classes — system classloader only).
#[cfg(target_os = "android")]
fn main_activity_class<'a>(
    env: &mut jni::JNIEnv<'a>,
) -> Result<jni::objects::JClass<'a>, String> {
    if let Some(class) = MAIN_ACTIVITY_CLASS.get() {
        // Zero-cost JClass view over the cached GlobalRef's raw object.
        return Ok(unsafe { jni::objects::JClass::from_raw(class.as_obj().as_raw()) });
    }
    env.find_class("com/audioconverter/app/MainActivity")
        .map_err(|e| format!("Failed to find MainActivity class: {e}"))
}

/// Run `f` with a fresh JNIEnv and GUARANTEE no pending Java exception is left
/// on this (pooled) thread — a leftover exception aborts the whole app on the
/// thread's next JNI use.
#[cfg(target_os = "android")]
fn with_jni_env<T>(f: impl FnOnce(&mut jni::JNIEnv) -> Result<T, String>) -> Result<T, String> {
    let vm = get_java_vm()?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("Failed to attach thread: {e}"))?;
    let result = f(&mut env);
    if env.exception_check().unwrap_or(false) {
        let _ = env.exception_clear();
    }
    result
}

/// Call a `static String method(String)` on MainActivity.
#[cfg(target_os = "android")]
fn call_static_string(
    method: &str,
    signature: &str,
    arg: &str,
) -> Result<String, String> {
    with_jni_env(|env| {
        let j_arg = env
            .new_string(arg)
            .map_err(|e| format!("Failed to create Java string: {e}"))?;
        let cls = main_activity_class(env)?;
        let j_val = match env.call_static_method(&cls, method, signature, &[(&j_arg).into()]) {
            Ok(v) => v,
            Err(e) => {
                if env.exception_check().unwrap_or(false) {
                    let _ = env.exception_describe();
                    let _ = env.exception_clear();
                }
                return Err(format!("Failed to call {method}: {e}"));
            }
        };
        let j_obj = j_val.l().map_err(|e| format!("Expected object: {e}"))?;
        if j_obj.as_raw().is_null() {
            return Ok(String::new());
        }
        let j_str = jni::objects::JString::from(j_obj);
        let s: String = env
            .get_string(&j_str)
            .map_err(|e| format!("Failed to extract Rust string: {e}"))?
            .into();
        Ok(s)
    })
}

/// String bridge that never errors — empty string on failure (for stat).
#[cfg(target_os = "android")]
pub fn call_static_string_quiet(method: &str, arg: &str) -> String {
    match call_static_string(
        method,
        "(Ljava/lang/String;)Ljava/lang/String;",
        arg,
    ) {
        Ok(s) => s,
        Err(e) => {
            crate::log_error!("call_static_string_quiet({method}) failed: {e}");
            String::new()
        }
    }
}

/// Call a `static boolean method()` on MainActivity (fail-open on any error).
#[cfg(target_os = "android")]
pub fn call_static_bool(method: &str) -> bool {
    with_jni_env(|env| {
        let cls = main_activity_class(env)?;
        env.call_static_method(&cls, method, "()Z", &[])
            .map_err(|e| format!("Failed to call {method}: {e}"))?
            .z()
            .map_err(|e| format!("Expected bool: {e}"))
    })
    .unwrap_or(true)
}

/// Call a `static void method()` on MainActivity.
#[cfg(target_os = "android")]
pub fn call_static_void(method: &str) -> Result<(), String> {
    with_jni_env(|env| {
        let cls = main_activity_class(env)?;
        env.call_static_method(&cls, method, "()V", &[])
            .map_err(|e| format!("Failed to call {method}: {e}"))?;
        Ok(())
    })
}

#[cfg(target_os = "android")]
pub fn call_static_void_float(method: &str, val: f32) -> Result<(), String> {
    with_jni_env(|env| {
        let cls = main_activity_class(env)?;
        env.call_static_method(&cls, method, "(F)V", &[jni::objects::JValue::Float(val)])
            .map_err(|e| format!("Failed to call {method}: {e}"))?;
        Ok(())
    })
}

#[cfg(not(target_os = "android"))]
pub fn call_static_bool(_method: &str) -> bool {
    true
}

#[cfg(not(target_os = "android"))]
pub fn call_static_void(_method: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "android"))]
pub fn call_static_void_float(_method: &str, _val: f32) -> Result<(), String> {
    Ok(())
}
