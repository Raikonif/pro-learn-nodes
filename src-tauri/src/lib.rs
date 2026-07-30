// Tauri 2 application shell.
//
// Responsibilities:
//   * Dev (`#[cfg(debug_assertions)]`): spawn `uvicorn` from `backend/` so the
//     `tauri dev` window has the FastAPI sidecar already running on
//     http://127.0.0.1:8000. Matches the long-standing dev workflow.
//   * Production (release builds): spawn the bundled FastAPI sidecar binary
//     as a supervised process that listens on a Unix domain socket under
//     the app data directory. The `api_request` Tauri command then forwards
//     every renderer call to that socket, making the `unix` branch of
//     `frontend/src/shared/lib/api-client.ts` reachable end-to-end.
//
// All renderer ↔ backend traffic goes through `api_request` in production.
// In dev the same command targets the externally-managed uvicorn on the
// loopback HTTP port, so the frontend stays transport-agnostic.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Deserialize;
use tauri::{Manager, State};
use tauri_plugin_shell::ShellExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpStream, UnixStream};
use tokio::sync::Mutex;

const SIDECAR_NAME: &str = "learn-nodes-backend";
const HTTP_FALLBACK_URL: &str = "http://127.0.0.1:8000";
/// Filename of the Unix domain socket the production sidecar listens on.
/// Lives in the per-user app data directory so it is cleaned up with the
/// app and never collides across users.
const UNIX_SOCKET_FILENAME: &str = "backend.sock";

struct BackendState {
    /// When `Some`, dispatch every `api_request` call over this Unix
    /// socket. When `None`, dispatch over plain HTTP at `HTTP_FALLBACK_URL`
    /// (dev mode, or production when the sidecar failed to spawn).
    unix_socket: Mutex<Option<PathBuf>>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiRequestInit {
    #[serde(default)]
    method: Option<String>,
    #[serde(default)]
    body: Option<String>,
}

#[tauri::command]
async fn api_request(
    state: State<'_, BackendState>,
    path: String,
    init: ApiRequestInit,
) -> Result<serde_json::Value, String> {
    let method = init
        .method
        .unwrap_or_else(|| "GET".to_string())
        .to_uppercase();
    let body = init.body.as_deref();

    let socket = state.unix_socket.lock().await.clone();
    if let Some(socket) = socket {
        match forward_over_unix_socket(&socket, &method, &path, body).await {
            Ok(value) => return Ok(value),
            Err(err) => {
                log::warn!(
                    "[learn-nodes] unix-socket dispatch failed ({err}); falling back to HTTP"
                );
            }
        }
    }

    forward_over_http(&format!("{HTTP_FALLBACK_URL}{path}"), &method, body).await
}

async fn forward_over_http(
    url: &str,
    method: &str,
    body: Option<&str>,
) -> Result<serde_json::Value, String> {
    let (host_port, path_part) = split_url(url)?;
    let (host, port) = split_host_port(&host_port)?;
    let mut stream = TcpStream::connect((host.as_str(), port))
        .await
        .map_err(|e| format!("tcp connect to {host_port}: {e}"))?;
    write_http_request(&mut stream, method, &path_part, host_port.as_str(), body).await?;
    let response = read_http_response(&mut stream).await?;
    extract_json_body(&response)
}

async fn forward_over_unix_socket(
    socket_path: &Path,
    method: &str,
    path: &str,
    body: Option<&str>,
) -> Result<serde_json::Value, String> {
    let mut stream = UnixStream::connect(socket_path)
        .await
        .map_err(|e| format!("unix connect to {}: {e}", socket_path.display()))?;
    write_http_request(&mut stream, method, path, "localhost", body).await?;
    let response = read_http_response(&mut stream).await?;
    extract_json_body(&response)
}

async fn write_http_request<W>(
    writer: &mut W,
    method: &str,
    path: &str,
    host_header: &str,
    body: Option<&str>,
) -> Result<(), String>
where
    W: tokio::io::AsyncWrite + Unpin,
{
    let body_bytes = body.unwrap_or("").as_bytes();
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: {host_header}\r\nConnection: close\r\nContent-Length: {}\r\n\r\n",
        body_bytes.len()
    );
    writer
        .write_all(request.as_bytes())
        .await
        .map_err(|e| format!("write request head: {e}"))?;
    if !body_bytes.is_empty() {
        writer
            .write_all(body_bytes)
            .await
            .map_err(|e| format!("write request body: {e}"))?;
    }
    writer
        .flush()
        .await
        .map_err(|e| format!("flush request: {e}"))?;
    Ok(())
}

async fn read_http_response<R>(reader: &mut R) -> Result<String, String>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut raw = Vec::new();
    reader
        .read_to_end(&mut raw)
        .await
        .map_err(|e| format!("read response: {e}"))?;
    String::from_utf8(raw).map_err(|e| format!("response not utf-8: {e}"))
}

fn extract_json_body(response: &str) -> Result<serde_json::Value, String> {
    let (head, body) = response
        .split_once("\r\n\r\n")
        .ok_or_else(|| "malformed HTTP response: missing header terminator".to_string())?;
    let status_line = head.lines().next().unwrap_or("");
    let mut parts = status_line.split_whitespace();
    let _version = parts.next();
    let status = parts
        .next()
        .ok_or_else(|| "malformed HTTP response: missing status".to_string())?;
    let status_code: u16 = status
        .parse()
        .map_err(|e| format!("invalid status code {status:?}: {e}"))?;
    if !(200..300).contains(&status_code) {
        return Err(format!("backend returned HTTP {status_code}"));
    }
    serde_json::from_str(body).map_err(|e| format!("invalid JSON body: {e}"))
}

fn split_url(url: &str) -> Result<(String, String), String> {
    let stripped = url
        .strip_prefix("http://")
        .ok_or_else(|| format!("unsupported scheme in url {url:?} (only http:// is supported)"))?;
    let (host_port, path_part) = match stripped.split_once('/') {
        Some((h, p)) => (h.to_string(), format!("/{p}")),
        None => (stripped.to_string(), "/".to_string()),
    };
    Ok((host_port, path_part))
}

fn split_host_port(host_port: &str) -> Result<(String, u16), String> {
    match host_port.rsplit_once(':') {
        Some((host, port)) => {
            let port: u16 = port
                .parse()
                .map_err(|e| format!("invalid port {port:?}: {e}"))?;
            Ok((host.to_string(), port))
        }
        None => Ok((host_port.to_string(), 80)),
    }
}

fn spawn_dev_uvicorn() {
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

fn spawn_production_sidecar<R: tauri::Runtime>(
    handle: &tauri::AppHandle<R>,
) -> Result<PathBuf, String> {
    let app_data = handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))?;
    std::fs::create_dir_all(&app_data)
        .map_err(|e| format!("create app data dir {}: {e}", app_data.display()))?;
    let socket_path = app_data.join(UNIX_SOCKET_FILENAME);
    // Drop a stale socket file from a previous run; uvicorn refuses to bind
    // to an existing path.
    let _ = std::fs::remove_file(&socket_path);

    let socket_arg = socket_path
        .to_str()
        .ok_or_else(|| format!("non-utf8 socket path {}", socket_path.display()))?;

    let sidecar = handle
        .shell()
        .sidecar(SIDECAR_NAME)
        .map_err(|e| format!("sidecar lookup for {SIDECAR_NAME:?}: {e}"))?
        .args(["--uds", socket_arg]);

    let (_rx, _child) = sidecar
        .spawn()
        .map_err(|e| format!("sidecar spawn: {e}"))?;
    Ok(socket_path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Dev only: keep the long-standing behavior of spawning uvicorn so
    // `tauri dev` is a single command. Production builds skip this; the
    // sidecar is spawned (and supervised) inside the Tauri `setup` hook.
    #[cfg(debug_assertions)]
    spawn_dev_uvicorn();

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .setup(|app| {
            let unix_socket = if cfg!(debug_assertions) {
                None
            } else {
                match spawn_production_sidecar(&app.handle()) {
                    Ok(path) => {
                        log::info!(
                            "[learn-nodes] sidecar spawned, listening on unix://{}",
                            path.display()
                        );
                        Some(path)
                    }
                    Err(err) => {
                        log::error!(
                            "[learn-nodes] failed to spawn sidecar ({err}); api_request will fall back to HTTP {HTTP_FALLBACK_URL}"
                        );
                        None
                    }
                }
            };

            app.manage(BackendState {
                unix_socket: Mutex::new(unix_socket),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![api_request])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}