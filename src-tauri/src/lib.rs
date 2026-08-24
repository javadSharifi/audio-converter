mod commands;
pub mod disk;
pub mod error;
pub mod ffmpeg;
pub mod logger;
pub mod processing;
pub mod queue;
pub mod settings;
pub mod types;

use tauri::{Manager, RunEvent};

/// App entry point (called from main.rs).
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("audio-converter"));
            settings::init_app_data_dir(data_dir);
            app.manage(queue::QueueManager::new(app.handle().clone()));
            log_info!("app started");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::probe_files,
            commands::start_conversion,
            commands::cancel_job,
            commands::cancel_all_jobs,
            commands::clear_finished,
            commands::get_queue,
            commands::disk_free,
            commands::get_settings,
            commands::save_settings,
        ])
        .build(tauri::generate_context!())
        .expect("error while building audio converter")
        .run(|app_handle, event| {
            // Kill any in-flight ffmpeg children when the app quits;
            // otherwise they outlive the process as orphans.
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                use tauri::Manager as _;
                app_handle.state::<queue::QueueManager>().cancel_all();
            }
        });
}
