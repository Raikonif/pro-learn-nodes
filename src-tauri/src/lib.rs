// Tauri 2 application shell.
//
// Responsibilities:
//   * Dev: connect to the externally managed Uvicorn process on
//     http://127.0.0.1:8009 without spawning a duplicate backend.
//   * Production (release builds): spawn the bundled FastAPI sidecar binary
//     as a supervised process that listens on a Unix domain socket under
//     the app data directory. The `api_request` Tauri command then forwards
//     every renderer call to that socket, making the `unix` branch of
//     `frontend/src/shared/lib/api-client.ts` reachable end-to-end.
//
// All renderer ↔ backend traffic goes through `api_request` in production,
// except a streamed response (a conversation turn's server-sent events),
// which goes through `api_stream` and arrives in pieces over a `Channel`.
// In dev the same command targets the externally-managed uvicorn on the
// loopback HTTP port, so the frontend stays transport-agnostic.

mod data_location;
#[cfg(test)]
mod data_location_real;

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{Emitter, Manager, State};

use data_location::{Backend, DataStatus, Mover, PointerStore, StartOutcome, Starter};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpStream, UnixStream};

const SIDECAR_NAME: &str = "learn-nodes-backend";
// The project's default backend port (`scripts/dev-ports.mjs`), never 8000:
// that is where unrelated local services most often live, and a fallback
// that reaches one of them reports its answer as this backend's.
const HTTP_FALLBACK_URL: &str = "http://127.0.0.1:8009";
/// Filename of the Unix domain socket the production sidecar listens on.
/// Lives in the per-user app cache directory, not the data folder: a socket
/// path is limited to about 104 bytes, and a learner-chosen data folder can
/// be deeper than that.
const UNIX_SOCKET_FILENAME: &str = "backend.sock";
/// How long a starting sidecar may take to report its data, migrations included.
const READINESS_TIMEOUT: Duration = Duration::from_secs(60);

struct BackendState {
    /// When `Some`, dispatch every `api_request` call over this Unix
    /// socket. When `None`, dispatch over plain HTTP at `HTTP_FALLBACK_URL`
    /// (dev mode, or production when the sidecar failed to spawn).
    unix_socket: Mutex<Option<PathBuf>>,
    /// Retaining the handle lets the Tauri host terminate the supervised
    /// process when the main window closes or the application exits.
    child: Mutex<Option<CommandChild>>,
    /// Where the data is, how the last start went, and whether a move runs.
    data: Mutex<DataState>,
}

#[derive(Default)]
struct DataState {
    /// `None` in development, where the backend is run outside the shell.
    location: Option<PathBuf>,
    startup: Option<StartOutcome>,
    moving: bool,
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

    let socket = state
        .unix_socket
        .lock()
        .map_err(|_| "backend socket state is poisoned".to_string())?
        .clone();
    if let Some(socket) = socket {
        match forward_over_unix_socket(&socket, &method, &path, body).await {
            Ok(value) => return Ok(value),
            // The sidecar answered — with a refusal, but an answer. Retrying
            // elsewhere would replace the reason (a registration's
            // `{"stage": "launch", ...}`) with an unrelated connection error.
            Err(err) if is_backend_answer(&err) => return Err(err),
            Err(err) => {
                log::warn!(
                    "[learn-nodes] unix-socket dispatch failed ({err}); falling back to HTTP"
                );
            }
        }
    }

    forward_over_http(&format!("{HTTP_FALLBACK_URL}{path}"), &method, body).await
}

/// Whether an error is the backend's own non-2xx answer rather than a failure
/// to reach it. Only the latter justifies trying another transport.
fn is_backend_answer(error: &str) -> bool {
    error.starts_with("backend returned HTTP ")
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
    write_http_request(&mut stream, "HTTP/1.1", method, &path_part, host_port.as_str(), body).await?;
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
    write_http_request(&mut stream, "HTTP/1.1", method, path, "localhost", body).await?;
    let response = read_http_response(&mut stream).await?;
    extract_json_body(&response)
}

/// Forward a streamed response to the renderer as it arrives.
///
/// `api_request` reads a response to its end, which is right for JSON and
/// fatal for a conversation turn: nothing would render until the agent had
/// finished. This sends each piece of the body over `on_chunk` the moment it
/// is read, and resolves when the backend closes the stream.
#[tauri::command]
async fn api_stream(
    state: State<'_, BackendState>,
    path: String,
    init: ApiRequestInit,
    on_chunk: Channel<String>,
) -> Result<(), String> {
    let method = init
        .method
        .unwrap_or_else(|| "GET".to_string())
        .to_uppercase();
    let body = init.body.as_deref();
    let send = |text: String| on_chunk.send(text).map_err(|e| format!("send chunk: {e}"));

    let socket = state
        .unix_socket
        .lock()
        .map_err(|_| "backend socket state is poisoned".to_string())?
        .clone();
    if let Some(socket) = socket {
        // No HTTP fallback once connected: half a turn replayed over another
        // transport would send the learner's message twice.
        let stream = UnixStream::connect(&socket)
            .await
            .map_err(|e| format!("unix connect to {}: {e}", socket.display()))?;
        return stream_response(stream, &method, &path, "localhost", body, send).await;
    }

    let (host_port, _) = split_url(HTTP_FALLBACK_URL)?;
    let (host, port) = split_host_port(&host_port)?;
    let stream = TcpStream::connect((host.as_str(), port))
        .await
        .map_err(|e| format!("tcp connect to {host_port}: {e}"))?;
    stream_response(stream, &method, &path, &host_port, body, send).await
}

/// Request over `stream` and hand each decoded piece of the body to `send`.
///
/// HTTP/1.0 on purpose: the server then delimits the body by closing the
/// connection instead of chunk-encoding it, so every byte read after the head
/// is body and nothing needs de-chunking.
async fn stream_response<S, F>(
    mut stream: S,
    method: &str,
    path: &str,
    host_header: &str,
    body: Option<&str>,
    mut send: F,
) -> Result<(), String>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
    F: FnMut(String) -> Result<(), String>,
{
    write_http_request(&mut stream, "HTTP/1.0", method, path, host_header, body).await?;

    let mut buffer = [0u8; 8192];
    let mut received: Vec<u8> = Vec::new();
    let head_end = loop {
        let read = stream
            .read(&mut buffer)
            .await
            .map_err(|e| format!("read response head: {e}"))?;
        if read == 0 {
            return Err("connection closed before the response head".to_string());
        }
        received.extend_from_slice(&buffer[..read]);
        if let Some(position) = received.windows(4).position(|w| w == b"\r\n\r\n") {
            break position;
        }
    };
    let head = String::from_utf8_lossy(&received[..head_end]).to_string();
    let mut pending: Vec<u8> = received[head_end + 4..].to_vec();

    let status_code: u16 = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse().ok())
        .ok_or_else(|| format!("malformed HTTP response head: {head:?}"))?;
    if !(200..300).contains(&status_code) {
        stream
            .read_to_end(&mut pending)
            .await
            .map_err(|e| format!("read error body: {e}"))?;
        return Err(format!(
            "backend returned HTTP {status_code}: {}",
            String::from_utf8_lossy(&pending).trim()
        ));
    }

    loop {
        if let Some(text) = take_utf8_prefix(&mut pending) {
            send(text)?;
        }
        let read = stream
            .read(&mut buffer)
            .await
            .map_err(|e| format!("read response body: {e}"))?;
        if read == 0 {
            break;
        }
        pending.extend_from_slice(&buffer[..read]);
    }
    if !pending.is_empty() {
        send(String::from_utf8_lossy(&pending).to_string())?;
    }
    Ok(())
}

/// The longest decodable prefix of `pending`, leaving a character split
/// across two reads in place for the next one.
fn take_utf8_prefix(pending: &mut Vec<u8>) -> Option<String> {
    let valid = match std::str::from_utf8(pending) {
        Ok(_) => pending.len(),
        // `error_len() == None` is an incomplete sequence at the end: wait.
        Err(error) if error.error_len().is_none() => error.valid_up_to(),
        // Genuinely invalid bytes will never complete; do not stall on them.
        Err(_) => {
            let text = String::from_utf8_lossy(pending).to_string();
            pending.clear();
            return Some(text);
        }
    };
    if valid == 0 {
        return None;
    }
    let text = String::from_utf8(pending[..valid].to_vec()).ok()?;
    pending.drain(..valid);
    Some(text)
}

/// Poll `/ready` until the sidecar reports its data: usable, missing, or
/// damaged. "pending" and a socket not yet listening mean keep waiting.
async fn wait_for_data_status(socket_path: &Path, timeout: Duration) -> DataStatus {
    let deadline = tokio::time::Instant::now() + timeout;
    let mut last = String::from("no answer yet");
    while tokio::time::Instant::now() < deadline {
        match forward_over_unix_socket(socket_path, "GET", "/ready", None).await {
            Ok(body) => return ready_status(&body),
            Err(error) => {
                if let Some(status) = refusal_status(&error) {
                    return status;
                }
                last = error;
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    DataStatus::Unreachable(format!(
        "the backend did not report ready on unix://{} within {}s ({last})",
        socket_path.display(),
        timeout.as_secs()
    ))
}

/// A 200 from `/ready`. A sidecar that predates the data report is usable.
fn ready_status(body: &serde_json::Value) -> DataStatus {
    match body.pointer("/data/status").and_then(|s| s.as_str()) {
        None | Some("ok") => DataStatus::Ok,
        Some(other) => DataStatus::Damaged(format!("the backend reported {other}")),
    }
}

/// A 503 from `/ready` that names the data's state; `None` for "pending" or
/// anything that is not such an answer.
fn refusal_status(error: &str) -> Option<DataStatus> {
    let body = error.strip_prefix("backend returned HTTP 503: ")?;
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    let data = value.pointer("/detail/data")?;
    let detail = data
        .get("detail")
        .and_then(|d| d.as_str())
        .or_else(|| value.pointer("/detail/message").and_then(|m| m.as_str()))
        .unwrap_or("")
        .to_string();
    match data.get("status")?.as_str()? {
        "missing" => Some(DataStatus::Missing(detail)),
        "damaged" => Some(DataStatus::Damaged(detail)),
        _ => None,
    }
}

async fn write_http_request<W>(
    writer: &mut W,
    version: &str,
    method: &str,
    path: &str,
    host_header: &str,
    body: Option<&str>,
) -> Result<(), String>
where
    W: tokio::io::AsyncWrite + Unpin,
{
    let body_bytes = body.unwrap_or("").as_bytes();
    let content_type = if body.is_some() {
        "Content-Type: application/json\r\n"
    } else {
        ""
    };
    let request = format!(
        "{method} {path} {version}\r\nHost: {host_header}\r\nConnection: close\r\n{content_type}Content-Length: {}\r\n\r\n",
        body_bytes.len(),
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
        // The body is kept: a refusal like a registration's
        // `{"detail": {"stage", "message"}}` is what the learner needs to see.
        return Err(format!("backend returned HTTP {status_code}: {}", body.trim()));
    }
    // A 204 has no body, and is a success rather than invalid JSON.
    if body.trim().is_empty() {
        return Ok(serde_json::Value::Null);
    }
    // A response that is not JSON (the memory export is Markdown) is handed
    // back as a string rather than refused as malformed JSON.
    // Only an explicit non-JSON type is text; a missing type is tried as JSON.
    let declared_not_json = head.lines().any(|line| {
        let lower = line.to_ascii_lowercase();
        lower.starts_with("content-type:") && !lower.contains("json")
    });
    if declared_not_json {
        return Ok(serde_json::Value::String(body.to_string()));
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

/// Spawn the sidecar on `data_dir`. The data folder is never created here:
/// for the default folder the sidecar creates it, and for a chosen one
/// `--require-existing` forbids it.
fn spawn_production_sidecar<R: tauri::Runtime>(
    handle: &tauri::AppHandle<R>,
    data_dir: &Path,
    require_existing: bool,
) -> Result<(PathBuf, CommandChild), String> {
    let cache = handle
        .path()
        .app_cache_dir()
        .map_err(|e| format!("app cache dir: {e}"))?;
    std::fs::create_dir_all(&cache)
        .map_err(|e| format!("create app cache dir {}: {e}", cache.display()))?;
    let socket_path = cache.join(UNIX_SOCKET_FILENAME);
    // Drop a stale socket file from a previous run; uvicorn refuses to bind
    // to an existing path.
    let _ = std::fs::remove_file(&socket_path);

    let arguments = sidecar_arguments(&socket_path, data_dir, require_existing)?;

    let sidecar = handle
        .shell()
        .sidecar(SIDECAR_NAME)
        .map_err(|e| format!("sidecar lookup for {SIDECAR_NAME:?}: {e}"))?
        .args(arguments);

    let (_rx, child) = sidecar.spawn().map_err(|e| format!("sidecar spawn: {e}"))?;
    Ok((socket_path, child))
}

fn sidecar_arguments(
    socket_path: &Path,
    app_data: &Path,
    require_existing: bool,
) -> Result<Vec<String>, String> {
    let socket_arg = socket_path
        .to_str()
        .ok_or_else(|| format!("non-utf8 socket path {}", socket_path.display()))?;
    let data_arg = app_data
        .to_str()
        .ok_or_else(|| format!("non-utf8 app data path {}", app_data.display()))?;
    let mut arguments = vec![
        "--uds".to_string(),
        socket_arg.to_string(),
        "--data-dir".to_string(),
        data_arg.to_string(),
    ];
    if require_existing {
        arguments.push("--require-existing".to_string());
    }
    Ok(arguments)
}

/// The real backend for moving and restoring: the supervised sidecar.
struct SidecarBackend<R: tauri::Runtime> {
    handle: tauri::AppHandle<R>,
}

impl<R: tauri::Runtime> Backend for SidecarBackend<R> {
    fn stop(&mut self) {
        cleanup_backend(&self.handle.state::<BackendState>());
    }

    fn start(&mut self, dir: &Path, require_existing: bool) -> DataStatus {
        let state = self.handle.state::<BackendState>();
        cleanup_backend(&state);
        let (socket, child) = match spawn_production_sidecar(&self.handle, dir, require_existing) {
            Ok(spawned) => spawned,
            Err(error) => return DataStatus::Unreachable(error),
        };
        let status = tauri::async_runtime::block_on(wait_for_data_status(&socket, READINESS_TIMEOUT));
        if status.is_ok() {
            log::info!("[learn-nodes] sidecar ready on unix://{} for {}", socket.display(), dir.display());
            if let Ok(mut slot) = state.unix_socket.lock() {
                *slot = Some(socket);
            }
            if let Ok(mut slot) = state.child.lock() {
                *slot = Some(child);
            }
        } else {
            log::error!("[learn-nodes] data at {} is not usable: {}", dir.display(), status.describe());
            stop_sidecar(child);
            let _ = std::fs::remove_file(&socket);
        }
        status
    }
}

/// Where the pointer lives and the default data folder, for this install.
fn locations<R: tauri::Runtime>(handle: &tauri::AppHandle<R>) -> Result<(PathBuf, PathBuf), String> {
    let config = handle.path().app_config_dir().map_err(|e| format!("app config dir: {e}"))?;
    let default = handle.path().app_data_dir().map_err(|e| format!("app data dir: {e}"))?;
    Ok((config, default))
}

fn aside_suffix() -> String {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    seconds.to_string()
}

/// Finish or undo an interrupted move, then start on the configured folder,
/// restoring from a good copy if its data is not usable.
fn start_backend<R: tauri::Runtime>(handle: &tauri::AppHandle<R>, mut notices: Vec<String>) -> StartOutcome {
    let (config, default) = match locations(handle) {
        Ok(found) => found,
        Err(error) => {
            return StartOutcome::Failed { path: PathBuf::new(), problem: DataStatus::Unreachable(error), notices }
        }
    };
    let store = PointerStore::new(&config);
    if let Some(line) = (Mover { store: &store, default_dir: &default }).resume() {
        notices.push(line);
    }
    let mut backend = SidecarBackend { handle: handle.clone() };
    let outcome = Starter { store: &store, default_dir: &default, aside_suffix: aside_suffix() }.start(&mut backend, notices);
    let state = handle.state::<BackendState>();
    if let Ok(mut data) = state.data.lock() {
        data.location = Some(match &outcome {
            StartOutcome::Ready { path, .. } | StartOutcome::Failed { path, .. } => path.clone(),
        });
        data.startup = Some(outcome.clone());
    }
    outcome
}

// --- Data location commands -------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DataLocationInfo {
    available: bool,
    unavailable_reason: Option<String>,
    path: Option<PathBuf>,
    is_default: bool,
    contents: Option<data_location::Contents>,
    startup: Option<StartOutcome>,
    leftovers: Vec<String>,
    previous: Option<PathBuf>,
    moving: bool,
}

#[tauri::command]
fn data_location_info(app: tauri::AppHandle, state: State<'_, BackendState>) -> Result<DataLocationInfo, String> {
    let data = state.data.lock().map_err(|_| "data state is poisoned".to_string())?;
    let Some(path) = data.location.clone() else {
        return Ok(DataLocationInfo {
            available: false,
            unavailable_reason: Some("The development build runs its backend outside the app, so where its data is kept is chosen there.".into()),
            path: None,
            is_default: true,
            contents: None,
            startup: None,
            leftovers: vec![],
            previous: None,
            moving: false,
        });
    };
    let (config, default) = locations(&app)?;
    let pointer = PointerStore::new(&config).load().unwrap_or_default();
    let leftovers = pointer
        .move_record
        .as_ref()
        .filter(|record| record.state == data_location::MoveState::Done)
        .map(|record| record.leftovers.clone())
        .unwrap_or_default();
    Ok(DataLocationInfo {
        available: true,
        unavailable_reason: None,
        is_default: path == default,
        contents: Some(data_location::summarize(&path)),
        path: Some(path),
        startup: data.startup.clone(),
        leftovers,
        previous: pointer.move_record.filter(|r| !r.leftovers.is_empty()).map(|r| r.from),
        moving: data.moving,
    })
}

#[tauri::command]
fn data_location_check(app: tauri::AppHandle, state: State<'_, BackendState>, target: String) -> Result<data_location::TargetCheck, String> {
    let current = state
        .data
        .lock()
        .map_err(|_| "data state is poisoned".to_string())?
        .location
        .clone()
        .ok_or("Not available in the development build.")?;
    let _ = app;
    Ok(data_location::check_target(&current, Path::new(&target)))
}

#[tauri::command]
async fn data_location_move(app: tauri::AppHandle, target: String) -> Result<data_location::MoveOutcome, String> {
    {
        let state = app.state::<BackendState>();
        let mut data = state.data.lock().map_err(|_| "data state is poisoned".to_string())?;
        if data.location.is_none() {
            return Err("Not available in the development build.".into());
        }
        if data.moving {
            return Err("A move is already running.".into());
        }
        data.moving = true;
    }
    let handle = app.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let (config, default) = locations(&handle)?;
        let store = PointerStore::new(&config);
        let mut backend = SidecarBackend { handle: handle.clone() };
        let emitter = handle.clone();
        let outcome = Mover { store: &store, default_dir: &default }.run(&mut backend, Path::new(&target), &mut |progress| {
            let _ = emitter.emit("data-location-progress", progress);
        });
        Ok::<_, String>(outcome)
    })
    .await
    .map_err(|e| format!("move task: {e}"))?;
    let state = app.state::<BackendState>();
    if let Ok(mut data) = state.data.lock() {
        data.moving = false;
        if let Ok(data_location::MoveOutcome::Completed { path, .. }) = &outcome {
            data.location = Some(path.clone());
            data.startup = None;
        }
    }
    outcome
}

#[tauri::command]
async fn data_location_retry_removal(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (config, default) = locations(&app)?;
        Mover { store: &PointerStore::new(&config), default_dir: &default }.retry_removal()
    })
    .await
    .map_err(|e| format!("removal task: {e}"))?
}

#[tauri::command]
fn data_location_reveal(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(not(target_os = "macos"))]
    let mut command = std::process::Command::new("xdg-open");
    command.arg(&path).spawn().map(|_| ()).map_err(|e| format!("reveal {path}: {e}"))
}

#[tauri::command]
fn data_location_dismiss(state: State<'_, BackendState>) -> Result<(), String> {
    let mut data = state.data.lock().map_err(|_| "data state is poisoned".to_string())?;
    if let Some(StartOutcome::Ready { notices, .. }) = data.startup.as_mut() {
        notices.clear();
    }
    Ok(())
}

/// After a failed start: try again, point at another folder, or use the default.
#[tauri::command]
async fn data_startup_recover(app: tauri::AppHandle, action: String, folder: Option<String>) -> Result<StartOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (config, default) = locations(&app)?;
        let store = PointerStore::new(&config);
        let starter = Starter { store: &store, default_dir: &default, aside_suffix: aside_suffix() };
        match action.as_str() {
            "retry" => {}
            "folder" => starter.use_folder(Path::new(folder.as_deref().ok_or("No folder chosen.")?))?,
            "default" => starter.use_default()?,
            other => return Err(format!("unknown recovery action {other:?}")),
        }
        Ok(start_backend(&app, vec![]))
    })
    .await
    .map_err(|e| format!("recovery task: {e}"))?
}

fn cleanup_backend(state: &BackendState) {
    if let Ok(mut child) = state.child.lock() {
        if let Some(child) = child.take() {
            stop_sidecar(child);
        }
    } else {
        log::warn!("[learn-nodes] backend child state is poisoned");
    }

    if let Ok(mut socket) = state.unix_socket.lock() {
        if let Some(path) = socket.take() {
            if let Err(err) = std::fs::remove_file(&path) {
                if err.kind() != std::io::ErrorKind::NotFound {
                    log::warn!(
                        "[learn-nodes] failed to remove unix socket {}: {err}",
                        path.display()
                    );
                }
            }
        }
    } else {
        log::warn!("[learn-nodes] backend socket state is poisoned");
    }
}

const SIDECAR_STOP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// Whether `pid` has exited within `timeout`. `waitpid` both notices an exit
/// and reaps it, so an exited process that nobody collected (a zombie, which
/// `kill(pid, 0)` still reports alive) counts as gone; ECHILD means another
/// waiter already collected it.
#[cfg(unix)]
fn wait_for_exit(pid: libc::pid_t, timeout: std::time::Duration) -> bool {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        let mut status = 0;
        let reaped = unsafe { libc::waitpid(pid, &mut status, libc::WNOHANG) };
        if reaped == pid || (reaped == -1 && std::io::Error::last_os_error().raw_os_error() == Some(libc::ECHILD)) {
            return true;
        }
        if std::time::Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
}

fn stop_sidecar(child: CommandChild) {
    #[cfg(unix)]
    {
        // Tauri's CommandChild::kill uses SIGKILL. A PyInstaller one-file
        // executable has a bootloader parent that must receive a catchable
        // signal so it can forward shutdown to the extracted Python child.
        // Killing only the bootloader leaves the Uvicorn process orphaned.
        let pid = child.pid() as libc::pid_t;
        let result = unsafe { libc::kill(pid, libc::SIGTERM) };
        if result == 0 {
            // Wait for it to be gone: a move copies, and a restore replaces,
            // the database this process has open. The bootloader exits only
            // after its Python child does, and the sidecar bounds its own
            // graceful shutdown, so this is normally a few seconds at most.
            if wait_for_exit(pid, SIDECAR_STOP_TIMEOUT) {
                return;
            }
            log::warn!("[learn-nodes] sidecar pid {pid} did not exit within {}s; killing it", SIDECAR_STOP_TIMEOUT.as_secs());
            // The Python child first: killing only the bootloader would leave
            // it running, with the database open, while a move copies it.
            let _ = std::process::Command::new("/usr/bin/pkill")
                .args(["-KILL", "-P", &pid.to_string()])
                .status();
            if let Err(err) = child.kill() {
                log::warn!("[learn-nodes] failed to kill sidecar: {err}");
            }
            wait_for_exit(pid, std::time::Duration::from_secs(2));
            return;
        }

        log::warn!(
            "[learn-nodes] SIGTERM to sidecar pid {pid} failed: {}",
            std::io::Error::last_os_error()
        );
    }

    if let Err(err) = child.kill() {
        log::warn!("[learn-nodes] failed to stop sidecar: {err}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_log::Builder::default().build())
        .setup(|app| {
            app.manage(BackendState {
                unix_socket: Mutex::new(None),
                child: Mutex::new(None),
                data: Mutex::new(DataState::default()),
            });
            // In development the backend runs outside the shell; in a release
            // build the sidecar is started on the configured data folder, and
            // a folder whose data is not usable is restored or reported. A
            // failed start leaves `api_request` on its HTTP fallback and the
            // window shows the recovery screen.
            if !cfg!(debug_assertions) {
                match start_backend(&app.handle(), vec![]) {
                    StartOutcome::Ready { path, .. } => {
                        log::info!("[learn-nodes] data at {}", path.display())
                    }
                    StartOutcome::Failed { path, problem, .. } => log::error!(
                        "[learn-nodes] could not start on {}: {}",
                        path.display(),
                        problem.describe()
                    ),
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            api_request,
            api_stream,
            data_location_info,
            data_location_check,
            data_location_move,
            data_location_retry_removal,
            data_location_reveal,
            data_location_dismiss,
            data_startup_recover
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|handle, event| {
        let should_cleanup = matches!(event, tauri::RunEvent::Exit)
            || matches!(
                event,
                tauri::RunEvent::WindowEvent {
                    ref label,
                    event: tauri::WindowEvent::Destroyed,
                    ..
                } if label == "main"
            );

        if should_cleanup {
            cleanup_backend(&handle.state::<BackendState>());
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{
        cleanup_backend, extract_json_body, is_backend_answer, ready_status, refusal_status,
        sidecar_arguments, stream_response, take_utf8_prefix, BackendState, DataState,
    };
    use crate::data_location::DataStatus;
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn passes_socket_and_durable_app_data_to_the_sidecar() {
        let arguments = sidecar_arguments(
            Path::new("/tmp/learn-nodes/backend.sock"),
            Path::new("/tmp/learn-nodes"),
            false,
        )
        .expect("utf-8 paths");
        assert_eq!(
            arguments,
            [
                "--uds",
                "/tmp/learn-nodes/backend.sock",
                "--data-dir",
                "/tmp/learn-nodes",
            ]
        );
    }

    #[test]
    fn accepts_the_ready_response_through_the_sidecar_transport_parser() {
        let response = extract_json_body(
            "HTTP/1.1 200 OK\r\nContent-Length: 18\r\n\r\n{\"status\":\"ready\"}",
        )
        .expect("ready response parses");
        assert_eq!(response["status"], "ready");
    }

    #[test]
    fn cleanup_removes_the_supervised_socket_path() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let path: PathBuf = std::env::temp_dir().join(format!("learn-nodes-cleanup-{unique}.sock"));
        std::fs::write(&path, "stale socket marker").expect("create stale socket marker");
        let state = BackendState {
            unix_socket: Mutex::new(Some(path.clone())),
            child: Mutex::new(None),
            data: Mutex::new(DataState::default()),
        };

        cleanup_backend(&state);

        assert!(!path.exists());
    }

    #[test]
    fn an_empty_success_body_is_null_not_invalid_json() {
        let value = extract_json_body("HTTP/1.1 204 No Content\r\n\r\n").expect("204 is a success");
        assert!(value.is_null());
    }

    #[test]
    fn a_refusal_keeps_its_body() {
        let error = extract_json_body(
            "HTTP/1.1 422 Unprocessable\r\n\r\n{\"detail\":{\"stage\":\"launch\"}}",
        )
        .unwrap_err();
        assert!(error.contains("422") && error.contains("\"stage\":\"launch\""), "{error}");
    }

    #[test]
    fn a_character_split_across_reads_waits_for_its_second_half() {
        let bytes = "ñ".as_bytes();
        let mut pending = vec![b'a', bytes[0]];
        assert_eq!(take_utf8_prefix(&mut pending).as_deref(), Some("a"));
        assert_eq!(take_utf8_prefix(&mut pending), None);
        pending.push(bytes[1]);
        assert_eq!(take_utf8_prefix(&mut pending).as_deref(), Some("ñ"));
        assert!(pending.is_empty());
    }

    #[tokio::test]
    async fn a_streamed_body_is_forwarded_piece_by_piece() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let (client, mut server) = tokio::io::duplex(64);
        let backend = tokio::spawn(async move {
            let mut request = vec![0u8; 1024];
            let read = server.read(&mut request).await.unwrap();
            let head = String::from_utf8_lossy(&request[..read]).to_string();
            assert!(head.starts_with("POST /chat/turn HTTP/1.0\r\n"), "{head}");
            server
                .write_all(b"HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\n\r\nevent: text\n")
                .await
                .unwrap();
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            server.write_all(b"data: {}\n\n").await.unwrap();
        });

        let mut pieces = Vec::new();
        stream_response(client, "POST", "/chat/turn", "localhost", Some("{}"), |piece| {
            pieces.push(piece);
            Ok(())
        })
        .await
        .expect("stream completes");
        backend.await.unwrap();

        assert!(pieces.len() >= 2, "delivered as it arrived, not at the end: {pieces:?}");
        assert_eq!(pieces.concat(), "event: text\ndata: {}\n\n");
    }

    #[tokio::test]
    async fn a_refused_stream_reports_status_and_body() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let (client, mut server) = tokio::io::duplex(1024);
        tokio::spawn(async move {
            let mut request = vec![0u8; 1024];
            let _ = server.read(&mut request).await.unwrap();
            server
                .write_all(b"HTTP/1.1 404 Not Found\r\n\r\n{\"detail\":\"Thread not found\"}")
                .await
                .unwrap();
        });

        let error = stream_response(client, "POST", "/chat/turn", "localhost", None, |_| Ok(()))
            .await
            .unwrap_err();
        assert!(error.contains("404") && error.contains("Thread not found"), "{error}");
    }

    #[test]
    fn a_refusal_is_an_answer_and_a_dead_socket_is_not() {
        assert!(is_backend_answer("backend returned HTTP 422: {}"));
        assert!(!is_backend_answer("unix connect to /x/backend.sock: Connection refused"));
    }

    #[test]
    fn a_non_json_body_is_returned_as_text() {
        let value = extract_json_body(
            "HTTP/1.1 200 OK\r\ncontent-type: text/markdown; charset=utf-8\r\n\r\n# Memory\n- fact",
        )
        .expect("markdown is a success");
        assert_eq!(value, serde_json::Value::String("# Memory\n- fact".to_string()));
    }

    #[test]
    fn a_json_body_is_still_parsed() {
        let value = extract_json_body("HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n\r\n{\"a\":1}")
            .expect("json");
        assert_eq!(value["a"], 1);
    }

    #[test]
    fn a_chosen_folder_is_passed_as_required_to_exist() {
        let arguments = sidecar_arguments(Path::new("/c/backend.sock"), Path::new("/Volumes/D/learn"), true).unwrap();
        assert_eq!(arguments.last().map(String::as_str), Some("--require-existing"));
    }

    #[test]
    fn readiness_reads_the_data_status() {
        let ok = serde_json::json!({"status": "ready", "backend": "fastapi", "data": {"status": "ok", "detail": null}});
        assert_eq!(ready_status(&ok), DataStatus::Ok);
        assert_eq!(ready_status(&serde_json::json!({"status": "ready"})), DataStatus::Ok);
        let missing = r#"backend returned HTTP 503: {"detail":{"message":"no data","data":{"status":"missing","detail":"/Volumes/D/learn does not exist"}}}"#;
        assert_eq!(refusal_status(missing), Some(DataStatus::Missing("/Volumes/D/learn does not exist".into())));
        let damaged = r#"backend returned HTTP 503: {"detail":{"message":"quick_check failed","data":{"status":"damaged","detail":null}}}"#;
        assert_eq!(refusal_status(damaged), Some(DataStatus::Damaged("quick_check failed".into())));
        let pending = r#"backend returned HTTP 503: {"detail":{"message":"starting","data":{"status":"pending","detail":null}}}"#;
        assert_eq!(refusal_status(pending), None);
        assert_eq!(refusal_status("unix connect to /x: refused"), None);
    }
}
