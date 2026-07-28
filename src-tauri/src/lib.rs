use std::process::Command;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // In development: spawn FastAPI backend before the webview starts
    #[cfg(debug_assertions)]
    {
        let backend_dir = std::env::current_dir()
            .unwrap()
            .join("..")
            .join("backend");

        let child = Command::new("sh")
            .current_dir(&backend_dir)
            .args(["-c", "cd .. && uv run uvicorn main:app --port 8000 --reload"])
            .spawn();

        match child {
            Ok(_) => {
                println!("[learn-nodes] FastAPI backend started on http://localhost:8000");
            }
            Err(e) => {
                eprintln!("[learn-nodes] Failed to start FastAPI backend: {e}");
                eprintln!("[learn-nodes] Run 'cd backend && uv run uvicorn main:app --port 8000' manually");
            }
        }
    }

    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
