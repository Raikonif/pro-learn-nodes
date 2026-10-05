//! The data-location move and restore, run against the real built sidecar.
//!
//! Ignored by default: it needs the PyInstaller binary. Run with
//! `LEARN_NODES_SIDECAR_BIN=binaries/learn-nodes-backend-<triple> cargo test -- --ignored real_sidecar`.
//! The sidecar is started over TCP on a free port instead of the app's Unix
//! socket; everything else — the pointer, the copy, verification, removal,
//! restore — is the code the desktop app runs.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};
use std::{env, fs};

use crate::data_location::*;
use crate::{ready_status, refusal_status};

struct RealSidecar {
    binary: PathBuf,
    child: Option<Child>,
    port: u16,
}

impl RealSidecar {
    fn new(binary: PathBuf) -> Self {
        Self { binary, child: None, port: 0 }
    }

    fn request(&self, method: &str, path: &str, body: Option<&str>) -> Option<(u16, String)> {
        let mut stream = TcpStream::connect(("127.0.0.1", self.port)).ok()?;
        stream.set_read_timeout(Some(Duration::from_secs(10))).ok()?;
        let body = body.unwrap_or("");
        let request = format!(
            "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(request.as_bytes()).ok()?;
        let mut response = String::new();
        stream.read_to_string(&mut response).ok()?;
        let status: u16 = response.split_whitespace().nth(1)?.parse().ok()?;
        let payload = response.split_once("\r\n\r\n").map(|(_, b)| b.to_string()).unwrap_or_default();
        // Chunked bodies: keep the JSON line only.
        let payload = payload.lines().find(|l| l.starts_with('{') || l.starts_with('[')).unwrap_or("").to_string();
        Some((status, payload))
    }
}

impl Backend for RealSidecar {
    fn stop(&mut self) {
        // As the app does: a catchable signal the bootloader forwards to its
        // Python child, then wait for both to be gone.
        if let Some(mut child) = self.child.take() {
            unsafe { libc::kill(child.id() as libc::pid_t, libc::SIGTERM) };
            let deadline = Instant::now() + Duration::from_secs(15);
            while Instant::now() < deadline {
                if let Ok(Some(_)) = child.try_wait() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            panic!("the sidecar did not exit within 15s of SIGTERM");
        }
    }

    fn start(&mut self, dir: &Path, require_existing: bool) -> DataStatus {
        self.stop();
        self.port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let mut command = Command::new(&self.binary);
        command
            .args(["--host", "127.0.0.1", "--port", &self.port.to_string(), "--data-dir"])
            .arg(dir)
            .env("LEARN_NODES_CONTEXT_SERVER", "0")
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        if require_existing {
            command.arg("--require-existing");
        }
        self.child = Some(command.spawn().expect("start the sidecar"));
        let deadline = Instant::now() + Duration::from_secs(60);
        while Instant::now() < deadline {
            if let Some((status, body)) = self.request("GET", "/ready", None) {
                if status == 200 {
                    return ready_status(&serde_json::from_str(&body).unwrap_or_default());
                }
                if let Some(refused) = refusal_status(&format!("backend returned HTTP 503: {body}")) {
                    return refused;
                }
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        DataStatus::Unreachable("no answer within 60s".into())
    }
}

impl Drop for RealSidecar {
    fn drop(&mut self) {
        if self.port != 0 && self.child.is_some() {
            let _ = self.request("POST", "/auth/signout", Some("{}"));
        }
        self.stop();
    }
}

fn binary() -> PathBuf {
    let path = env::var("LEARN_NODES_SIDECAR_BIN").expect("set LEARN_NODES_SIDECAR_BIN to the built sidecar");
    fs::canonicalize(path).expect("sidecar binary")
}

fn node_titles(sidecar: &RealSidecar) -> Vec<String> {
    let (status, body) = sidecar.request("GET", "/workspace/bootstrap", None).expect("bootstrap");
    assert_eq!(status, 200, "{body}");
    let value: serde_json::Value = serde_json::from_str(&body).unwrap();
    value["graph"]["nodes"].as_array().unwrap().iter().map(|n| n["title"].as_str().unwrap().to_string()).collect()
}

#[test]
#[ignore]
fn real_sidecar_move_report_retry_and_restore() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config");
    let default_dir = root.path().join("default-data");
    let b = root.path().join("moved-once");
    let c = root.path().join("moved-twice");
    fs::create_dir_all(&config).unwrap();
    let store = PointerStore::new(&config);
    let mover = Mover { store: &store, default_dir: &default_dir };
    let mut sidecar = RealSidecar::new(binary());

    // Seed: an account with a session, and a file the agent wrote in it.
    assert!(sidecar.start(&default_dir, false).is_ok());
    let (status, _) = sidecar.request("POST", "/auth/local/signin", Some(r#"{"displayName":"Mover"}"#)).unwrap();
    assert_eq!(status, 200);
    let (status, body) = sidecar.request("POST", "/workspace/nodes", Some(r#"{"title":"Kept across moves"}"#)).unwrap();
    assert_eq!(status, 200, "{body}");
    let value: serde_json::Value = serde_json::from_str(&body).unwrap();
    let node = value["graph"]["nodes"].as_array().unwrap().last().unwrap()["id"].as_str().unwrap().to_string();
    let written = default_dir.join("agent-workspaces").join(&node).join("loops.py");
    fs::create_dir_all(written.parent().unwrap()).unwrap();
    fs::write(&written, "for i in range(3):\n    print(i)\n").unwrap();

    // 1. Move, and continue there: the session and the file came along; the old folder is emptied.
    let outcome = mover.run(&mut sidecar, &b, &mut |_| {});
    assert!(matches!(&outcome, MoveOutcome::Completed { leftovers, .. } if leftovers.is_empty()), "{outcome:?}");
    assert_eq!(node_titles(&sidecar), vec!["Kept across moves"]);
    assert!(b.join("agent-workspaces").join(&node).join("loops.py").is_file());
    assert!(!default_dir.join("workspace.sqlite3").exists());

    // 2. Something in the previous folder that cannot be removed is reported, then retried.
    let locked = b.join("locked");
    fs::create_dir_all(&locked).unwrap();
    fs::write(locked.join("stuck.txt"), "x").unwrap();
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o500)).unwrap();
    let outcome = mover.run(&mut sidecar, &c, &mut |_| {});
    let MoveOutcome::Completed { leftovers, .. } = &outcome else { panic!("{outcome:?}") };
    assert!(leftovers.iter().any(|l| l.contains("stuck.txt")), "{leftovers:?}");
    assert_eq!(node_titles(&sidecar), vec!["Kept across moves"]);
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o700)).unwrap();
    assert_eq!(mover.retry_removal().unwrap(), Vec::<String>::new());
    assert!(!locked.exists());

    // 3. The folder disappears (an unplugged drive): reported, and no empty folder is made.
    sidecar.stop();
    let unplugged = root.path().join("unplugged");
    fs::rename(&c, &unplugged).unwrap();
    let starter = Starter { store: &store, default_dir: &default_dir, aside_suffix: "test".into() };
    let started = starter.start(&mut sidecar, vec![]);
    assert!(matches!(&started, StartOutcome::Failed { problem: DataStatus::Missing(_), .. }), "{started:?}");
    assert!(!c.exists(), "a missing folder must not be recreated empty");
    fs::rename(&unplugged, &c).unwrap();

    // 4. A damaged database is restored from the newest backup, and the session is back.
    sidecar.stop();
    fs::write(c.join("workspace.sqlite3"), b"not a database at all".repeat(64)).unwrap();
    for ext in ["-wal", "-shm"] {
        let _ = fs::remove_file(c.join(format!("workspace.sqlite3{ext}")));
    }
    let started = starter.start(&mut sidecar, vec![]);
    let StartOutcome::Ready { notices, .. } = &started else { panic!("{started:?}") };
    assert!(notices.iter().any(|n| n.contains("restored the copy")), "{notices:?}");
    let (status, _) = sidecar.request("POST", "/auth/local/signin", Some(r#"{"displayName":"Mover"}"#)).unwrap();
    assert_eq!(status, 200);
    sidecar.stop();
}
