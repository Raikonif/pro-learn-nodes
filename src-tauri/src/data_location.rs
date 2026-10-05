// Where the application's data lives, and moving it (change
// `code-viewer-and-data-location`, design "The data folder is named by a
// pointer outside it" and "Moving copies, verifies, switches, and only then
// removes").
//
// Everything here is plain filesystem logic behind a `Backend` trait, so the
// move and the restore can be tested without a sidecar. `lib.rs` supplies the
// real backend (stop and spawn the sidecar, read `/ready`).
//
// On macOS `app_config_dir()` and `app_data_dir()` are the same folder, so the
// pointer file can sit inside the default data folder. It is never copied,
// never counted when deciding a folder is empty, and never removed with the
// previous folder's contents.

use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const POINTER_FILENAME: &str = "data-location.json";
pub const DATABASE_FILENAME: &str = "workspace.sqlite3";
const BACKUPS_DIRNAME: &str = "backups";
/// Names that never make a folder "not empty", are never copied, and never removed.
const IGNORED_NAMES: &[&str] = &[POINTER_FILENAME, ".DS_Store", "backend.sock"];
/// Room beyond the data's own size a target must have: 10%, and at least 50 MB.
const FREE_SPACE_MARGIN_RATIO: f64 = 0.10;
const FREE_SPACE_MARGIN_MIN: u64 = 50 * 1024 * 1024;

// --- The pointer ------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MoveState {
    Copying,
    Switched,
    Done,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MoveRecord {
    pub state: MoveState,
    pub from: PathBuf,
    pub to: PathBuf,
    #[serde(default)]
    pub leftovers: Vec<String>,
}

/// `data-location.json`. `path: None` is the default folder.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pointer {
    #[serde(default)]
    pub path: Option<PathBuf>,
    #[serde(default)]
    pub previous: Option<PathBuf>,
    #[serde(default, rename = "move")]
    pub move_record: Option<MoveRecord>,
}

pub struct PointerStore {
    file: PathBuf,
}

impl PointerStore {
    pub fn new(config_dir: &Path) -> Self {
        Self { file: config_dir.join(POINTER_FILENAME) }
    }

    #[cfg(test)]
    pub fn exists(&self) -> bool {
        self.file.exists()
    }

    /// The pointer, or the default one when there is no file. A file that
    /// cannot be parsed is an error: guessing would point at the wrong data.
    pub fn load(&self) -> Result<Pointer, String> {
        match fs::read_to_string(&self.file) {
            Ok(text) => serde_json::from_str(&text)
                .map_err(|e| format!("{} is not readable: {e}", self.file.display())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Pointer::default()),
            Err(e) => Err(format!("read {}: {e}", self.file.display())),
        }
    }

    /// Written whole, then renamed over the old one: a crash leaves the old
    /// pointer or the new one, never half of either.
    pub fn save(&self, pointer: &Pointer) -> Result<(), String> {
        if let Some(parent) = self.file.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
        }
        let text = serde_json::to_string_pretty(pointer).map_err(|e| e.to_string())?;
        let temporary = self.file.with_extension("json.tmp");
        fs::write(&temporary, text).map_err(|e| format!("write {}: {e}", temporary.display()))?;
        fs::rename(&temporary, &self.file).map_err(|e| format!("replace {}: {e}", self.file.display()))
    }
}

/// The data folder a pointer names.
pub fn data_dir(pointer: &Pointer, default: &Path) -> PathBuf {
    pointer.path.clone().unwrap_or_else(|| default.to_path_buf())
}

/// Whether the sidecar must refuse to create a missing folder: only for a
/// location the learner chose, never for the default on a first start.
pub fn require_existing(pointer: &Pointer) -> bool {
    pointer.path.is_some()
}

// --- What a folder holds -------------------------------------------------------

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Contents {
    pub database_bytes: u64,
    pub backups: u64,
    pub backup_bytes: u64,
    pub node_folders: u64,
    pub total_bytes: u64,
}

pub fn summarize(dir: &Path) -> Contents {
    let mut contents = Contents::default();
    if let Ok(meta) = fs::metadata(dir.join(DATABASE_FILENAME)) {
        contents.database_bytes = meta.len();
    }
    if let Ok(entries) = fs::read_dir(dir.join(BACKUPS_DIRNAME)) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                contents.backups += 1;
                contents.backup_bytes += meta.len();
            }
        }
    }
    if let Ok(entries) = fs::read_dir(dir.join("agent-workspaces")) {
        contents.node_folders = entries.flatten().count() as u64;
    }
    contents.total_bytes = walk(dir).map(|entries| entries.iter().map(|e| e.size).sum()).unwrap_or(0);
    contents
}

// --- Walking without following links --------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
enum Kind {
    Dir,
    File,
    Link(PathBuf),
}

#[derive(Debug, Clone)]
struct Entry {
    relative: PathBuf,
    kind: Kind,
    size: u64,
}

/// Every directory, regular file, and link under `root`, links never
/// followed. Sockets, pipes, and the ignored names are left out.
fn walk(root: &Path) -> Result<Vec<Entry>, String> {
    let mut out = Vec::new();
    walk_into(root, Path::new(""), &mut out)?;
    Ok(out)
}

fn walk_into(root: &Path, relative: &Path, out: &mut Vec<Entry>) -> Result<(), String> {
    let dir = root.join(relative);
    let mut entries: Vec<_> = fs::read_dir(&dir)
        .map_err(|e| format!("read {}: {e}", dir.display()))?
        .flatten()
        .collect();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let name = entry.file_name();
        if relative.as_os_str().is_empty() && IGNORED_NAMES.iter().any(|ignored| name == *ignored) {
            continue;
        }
        let child = relative.join(&name);
        let meta = fs::symlink_metadata(entry.path())
            .map_err(|e| format!("inspect {}: {e}", entry.path().display()))?;
        let file_type = meta.file_type();
        if file_type.is_symlink() {
            let target = fs::read_link(entry.path())
                .map_err(|e| format!("read link {}: {e}", entry.path().display()))?;
            out.push(Entry { relative: child, kind: Kind::Link(target), size: 0 });
        } else if file_type.is_dir() {
            out.push(Entry { relative: child.clone(), kind: Kind::Dir, size: 0 });
            walk_into(root, &child, out)?;
        } else if file_type.is_file() {
            out.push(Entry { relative: child, kind: Kind::File, size: meta.len() });
        }
    }
    Ok(())
}

// --- Checking a target ---------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetCheck {
    pub ok: bool,
    pub reason: Option<String>,
    pub warnings: Vec<String>,
    pub needed_bytes: u64,
}

/// `path` with `.` and `..` removed and the existing part's links resolved,
/// so two spellings of one folder compare equal even if it does not exist yet.
fn normalize(path: &Path) -> PathBuf {
    let mut existing = path.to_path_buf();
    let mut rest: Vec<std::ffi::OsString> = Vec::new();
    while !existing.exists() {
        match (existing.file_name(), existing.parent()) {
            (Some(name), Some(parent)) => {
                rest.push(name.to_os_string());
                existing = parent.to_path_buf();
            }
            _ => break,
        }
    }
    let mut resolved = fs::canonicalize(&existing).unwrap_or(existing);
    for name in rest.into_iter().rev() {
        resolved.push(name);
    }
    let mut clean = PathBuf::new();
    for component in resolved.components() {
        match component {
            Component::ParentDir => {
                clean.pop();
            }
            Component::CurDir => {}
            other => clean.push(other),
        }
    }
    clean
}

fn is_empty_for_moving(dir: &Path) -> Result<bool, String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("read {}: {e}", dir.display()))?;
    Ok(entries.flatten().all(|entry| IGNORED_NAMES.iter().any(|ignored| entry.file_name() == *ignored)))
}

fn nearest_existing(path: &Path) -> PathBuf {
    let mut candidate = path.to_path_buf();
    while !candidate.exists() {
        match candidate.parent() {
            Some(parent) => candidate = parent.to_path_buf(),
            None => break,
        }
    }
    candidate
}

#[cfg(unix)]
fn writable(path: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt;
    let Ok(c_path) = std::ffi::CString::new(path.as_os_str().as_bytes()) else { return false };
    unsafe { libc::access(c_path.as_ptr(), libc::W_OK) == 0 }
}

#[cfg(unix)]
fn free_bytes(path: &Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;
    let c_path = std::ffi::CString::new(path.as_os_str().as_bytes()).ok()?;
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(c_path.as_ptr(), &mut stat) } != 0 {
        return None;
    }
    Some(stat.f_bavail as u64 * stat.f_frsize as u64)
}

/// A folder that looks managed by a sync service, where a live SQLite
/// database can be corrupted by the service copying it mid-write.
pub fn looks_synced(path: &Path) -> bool {
    let text = path.to_string_lossy().to_lowercase();
    ["library/mobile documents", "library/cloudstorage", "icloud", "dropbox", "google drive", "onedrive"]
        .iter()
        .any(|marker| text.contains(marker))
}

pub fn check_target(current: &Path, target: &Path) -> TargetCheck {
    let needed = walk(current).map(|entries| entries.iter().map(|e| e.size).sum()).unwrap_or(0);
    let refuse = |reason: String| TargetCheck { ok: false, reason: Some(reason), warnings: vec![], needed_bytes: needed };

    if !target.is_absolute() {
        return refuse("Choose a full folder path.".into());
    }
    let (current_n, target_n) = (normalize(current), normalize(target));
    if current_n == target_n {
        return refuse("That is already where the data is kept.".into());
    }
    if target_n.starts_with(&current_n) {
        return refuse("The new folder cannot be inside the current data folder.".into());
    }
    if current_n.starts_with(&target_n) {
        return refuse("The new folder cannot contain the current data folder.".into());
    }
    if target.exists() {
        if !target.is_dir() {
            return refuse("That path is a file, not a folder.".into());
        }
        match is_empty_for_moving(target) {
            Ok(true) => {}
            Ok(false) => return refuse("The folder must be empty: the data is never merged into a folder that already holds files.".into()),
            Err(e) => return refuse(format!("The folder cannot be read: {e}")),
        }
    }
    let existing = nearest_existing(target);
    if !writable(&existing) {
        return refuse(format!("{} is not writable.", existing.display()));
    }
    let margin = ((needed as f64 * FREE_SPACE_MARGIN_RATIO) as u64).max(FREE_SPACE_MARGIN_MIN);
    if let Some(free) = free_bytes(&existing) {
        if free < needed + margin {
            return refuse(format!(
                "Not enough free space: the data needs {} plus room to spare, and the disk has {} free.",
                human_bytes(needed),
                human_bytes(free)
            ));
        }
    }
    let mut warnings = Vec::new();
    if looks_synced(target) {
        warnings.push("This folder looks synced by a cloud service. A sync that copies the database while the app writes it can damage it.".into());
    }
    TargetCheck { ok: true, reason: None, warnings, needed_bytes: needed }
}

pub fn human_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 { format!("{bytes} B") } else { format!("{value:.1} {}", UNITS[unit]) }
}

// --- Copy, manifest, verify ------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ManifestEntry {
    Dir,
    File { size: u64, sha256: String },
    Link(PathBuf),
}

pub type Manifest = BTreeMap<PathBuf, ManifestEntry>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub copied_bytes: u64,
    pub total_bytes: u64,
}

fn hash_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 16];
    loop {
        let read = file.read(&mut buffer).map_err(|e| format!("read {}: {e}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// The manifest of `root` as it stands.
pub fn manifest_of(root: &Path) -> Result<Manifest, String> {
    let mut manifest = Manifest::new();
    for entry in walk(root)? {
        let value = match entry.kind {
            Kind::Dir => ManifestEntry::Dir,
            Kind::Link(target) => ManifestEntry::Link(target),
            Kind::File => ManifestEntry::File { size: entry.size, sha256: hash_file(&root.join(&entry.relative))? },
        };
        manifest.insert(entry.relative, value);
    }
    Ok(manifest)
}

/// Copy everything under `from` into `to` (created if absent), links copied
/// as links and never followed, hashing each file as it is written.
pub fn copy_tree(from: &Path, to: &Path, progress: &mut dyn FnMut(Progress)) -> Result<Manifest, String> {
    let entries = walk(from)?;
    let total: u64 = entries.iter().map(|e| e.size).sum();
    let mut copied = 0u64;
    fs::create_dir_all(to).map_err(|e| format!("create {}: {e}", to.display()))?;
    progress(Progress { copied_bytes: 0, total_bytes: total });
    let mut manifest = Manifest::new();
    let mut buffer = vec![0u8; 1 << 16];
    for entry in entries {
        let source = from.join(&entry.relative);
        let destination = to.join(&entry.relative);
        match &entry.kind {
            Kind::Dir => {
                fs::create_dir_all(&destination).map_err(|e| format!("create {}: {e}", destination.display()))?;
                manifest.insert(entry.relative, ManifestEntry::Dir);
            }
            Kind::Link(target) => {
                #[cfg(unix)]
                std::os::unix::fs::symlink(target, &destination)
                    .map_err(|e| format!("link {}: {e}", destination.display()))?;
                manifest.insert(entry.relative.clone(), ManifestEntry::Link(target.clone()));
            }
            Kind::File => {
                let mut input = fs::File::open(&source).map_err(|e| format!("open {}: {e}", source.display()))?;
                let mut output =
                    fs::File::create(&destination).map_err(|e| format!("create {}: {e}", destination.display()))?;
                let mut hasher = Sha256::new();
                let mut size = 0u64;
                loop {
                    let read = input.read(&mut buffer).map_err(|e| format!("read {}: {e}", source.display()))?;
                    if read == 0 {
                        break;
                    }
                    hasher.update(&buffer[..read]);
                    output.write_all(&buffer[..read]).map_err(|e| format!("write {}: {e}", destination.display()))?;
                    size += read as u64;
                    copied += read as u64;
                    progress(Progress { copied_bytes: copied, total_bytes: total });
                }
                output.sync_all().map_err(|e| format!("flush {}: {e}", destination.display()))?;
                manifest.insert(entry.relative, ManifestEntry::File { size, sha256: format!("{:x}", hasher.finalize()) });
            }
        }
    }
    Ok(manifest)
}

/// Whether `root` holds exactly what `manifest` describes; the first
/// difference found, if not.
pub fn verify(root: &Path, manifest: &Manifest) -> Result<(), String> {
    let found = manifest_of(root)?;
    for (path, expected) in manifest {
        match found.get(path) {
            None => return Err(format!("{} is missing from the copy", path.display())),
            Some(actual) if actual != expected => {
                return Err(format!("{} differs from the original", path.display()))
            }
            _ => {}
        }
    }
    Ok(())
}

// --- Removing a folder's contents ----------------------------------------------------------------

/// Remove everything under `root` except the ignored names, never following
/// a link out of it: a link is removed as a link. Returns what could not be
/// removed, as paths relative to `root`.
pub fn remove_contents(root: &Path) -> Vec<String> {
    let mut leftovers = Vec::new();
    let Ok(entries) = walk(root) else {
        return if root.exists() { vec![".".into()] } else { vec![] };
    };
    // Deepest first, so a directory is empty by the time it is removed.
    for entry in entries.iter().rev() {
        let path = root.join(&entry.relative);
        let result = match entry.kind {
            Kind::Dir => fs::remove_dir(&path),
            Kind::File | Kind::Link(_) => fs::remove_file(&path),
        };
        if let Err(error) = result {
            // A directory left non-empty by a child that stayed is not a
            // separate failure; report only what itself could not go.
            let child_stayed = matches!(entry.kind, Kind::Dir)
                && leftovers.iter().any(|left: &String| Path::new(left).starts_with(&entry.relative));
            if !child_stayed {
                leftovers.push(format!("{} ({error})", entry.relative.display()));
            }
        }
    }
    leftovers.sort();
    leftovers
}

/// The relative path part of a leftover line.
#[cfg(test)]
pub fn leftover_path(line: &str) -> &str {
    line.split(" (").next().unwrap_or(line)
}

// --- The backend, abstracted ------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", content = "detail", rename_all = "lowercase")]
pub enum DataStatus {
    Ok,
    Missing(String),
    Damaged(String),
    Unreachable(String),
}

impl DataStatus {
    pub fn is_ok(&self) -> bool {
        matches!(self, DataStatus::Ok)
    }

    pub fn describe(&self) -> String {
        match self {
            DataStatus::Ok => "The data is usable.".into(),
            DataStatus::Missing(d) => format!("The data folder is missing: {d}"),
            DataStatus::Damaged(d) => format!("The data is damaged: {d}"),
            DataStatus::Unreachable(d) => format!("The backend did not start: {d}"),
        }
    }
}

pub trait Backend {
    fn stop(&mut self);
    /// Start on `dir` and report whether its data is usable.
    fn start(&mut self, dir: &Path, require_existing: bool) -> DataStatus;
}

// --- Moving ------------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "outcome", rename_all = "camelCase")]
pub enum MoveOutcome {
    #[serde(rename_all = "camelCase")]
    Completed { path: PathBuf, leftovers: Vec<String> },
    #[serde(rename_all = "camelCase")]
    Abandoned { reason: String },
}

pub struct Mover<'a> {
    pub store: &'a PointerStore,
    pub default_dir: &'a Path,
}

impl Mover<'_> {
    /// Move the data from the current folder to `to`: record, stop, copy,
    /// verify, switch, start, and only then remove the previous contents.
    /// Any failure before removal puts everything back as it was.
    pub fn run(&self, backend: &mut dyn Backend, to: &Path, progress: &mut dyn FnMut(Progress)) -> MoveOutcome {
        let original = match self.store.load() {
            Ok(pointer) => pointer,
            Err(reason) => return MoveOutcome::Abandoned { reason },
        };
        let from = data_dir(&original, self.default_dir);
        let check = check_target(&from, to);
        if !check.ok {
            return MoveOutcome::Abandoned { reason: check.reason.unwrap_or_default() };
        }
        let created_target = !to.exists();

        let mut recording = original.clone();
        recording.move_record = Some(MoveRecord { state: MoveState::Copying, from: from.clone(), to: to.to_path_buf(), leftovers: vec![] });
        if let Err(reason) = self.store.save(&recording) {
            return MoveOutcome::Abandoned { reason };
        }

        backend.stop();
        let copied = copy_tree(&from, to, progress).and_then(|manifest| verify(to, &manifest));
        if let Err(reason) = copied {
            return self.roll_back(backend, &original, &from, to, created_target, reason);
        }

        let switched = Pointer {
            path: Some(to.to_path_buf()),
            previous: Some(from.clone()),
            move_record: Some(MoveRecord { state: MoveState::Switched, from: from.clone(), to: to.to_path_buf(), leftovers: vec![] }),
        };
        if let Err(reason) = self.store.save(&switched) {
            return self.roll_back(backend, &original, &from, to, created_target, reason);
        }
        let status = backend.start(to, true);
        if !status.is_ok() {
            backend.stop();
            return self.roll_back(backend, &original, &from, to, created_target, status.describe());
        }

        self.finish(switched, &from, to)
    }

    fn finish(&self, mut pointer: Pointer, from: &Path, to: &Path) -> MoveOutcome {
        let leftovers = remove_contents(from);
        pointer.move_record = Some(MoveRecord { state: MoveState::Done, from: from.to_path_buf(), to: to.to_path_buf(), leftovers: leftovers.clone() });
        // The previous folder no longer holds the data; it stays named only
        // while something of it remains to report.
        if leftovers.is_empty() {
            pointer.previous = None;
        }
        let _ = self.store.save(&pointer);
        MoveOutcome::Completed { path: to.to_path_buf(), leftovers }
    }

    fn roll_back(
        &self,
        backend: &mut dyn Backend,
        original: &Pointer,
        from: &Path,
        to: &Path,
        created_target: bool,
        reason: String,
    ) -> MoveOutcome {
        let _ = self.store.save(&Pointer { move_record: None, ..original.clone() });
        remove_contents(to);
        if created_target {
            let _ = fs::remove_dir(to);
        }
        backend.start(from, require_existing(original));
        MoveOutcome::Abandoned { reason: format!("The data stayed where it was. {reason}") }
    }

    /// Retry removing what a completed move left in the previous folder.
    pub fn retry_removal(&self) -> Result<Vec<String>, String> {
        let mut pointer = self.store.load()?;
        let Some(record) = pointer.move_record.clone() else { return Ok(vec![]) };
        if record.state != MoveState::Done {
            return Ok(vec![]);
        }
        let leftovers = remove_contents(&record.from);
        if leftovers.is_empty() {
            pointer.previous = None;
            pointer.move_record = None;
        } else {
            pointer.move_record = Some(MoveRecord { leftovers: leftovers.clone(), ..record });
        }
        self.store.save(&pointer)?;
        Ok(leftovers)
    }

    /// Finish or undo a move the application stopped in the middle of.
    /// Returns a line for the learner when something was done.
    pub fn resume(&self) -> Option<String> {
        let mut pointer = self.store.load().ok()?;
        let record = pointer.move_record.clone()?;
        match record.state {
            MoveState::Copying => {
                remove_contents(&record.to);
                let _ = fs::remove_dir(&record.to);
                pointer.move_record = None;
                let _ = self.store.save(&pointer);
                Some(format!(
                    "A move to {} was interrupted before it finished; the data stayed in {}.",
                    record.to.display(),
                    record.from.display()
                ))
            }
            MoveState::Switched => {
                // Removal had not started, so the previous folder is whole:
                // the copy is checked against it again.
                let verified = manifest_of(&record.from).and_then(|manifest| verify(&record.to, &manifest));
                match verified {
                    Ok(()) => {
                        if let MoveOutcome::Completed { leftovers, .. } = self.finish(pointer, &record.from, &record.to) {
                            let mut line = format!("An interrupted move to {} was completed.", record.to.display());
                            if !leftovers.is_empty() {
                                line.push_str(" Some files could not be removed from the previous folder.");
                            }
                            return Some(line);
                        }
                        None
                    }
                    Err(reason) => {
                        remove_contents(&record.to);
                        let restored = Pointer {
                            path: if record.from == self.default_dir { None } else { Some(record.from.clone()) },
                            previous: None,
                            move_record: None,
                        };
                        let _ = self.store.save(&restored);
                        Some(format!(
                            "An interrupted move to {} could not be verified ({reason}); the data stayed in {}.",
                            record.to.display(),
                            record.from.display()
                        ))
                    }
                }
            }
            MoveState::Done => None,
        }
    }
}

// --- Restoring at start ----------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "outcome", rename_all = "camelCase")]
pub enum StartOutcome {
    #[serde(rename_all = "camelCase")]
    Ready { path: PathBuf, notices: Vec<String> },
    #[serde(rename_all = "camelCase")]
    Failed { path: PathBuf, problem: DataStatus, notices: Vec<String> },
}

/// A backup of the database, newest first by the timestamp in its name
/// (`workspace-20260822T015228Z.sqlite3`, written before each migration).
pub fn backups_newest_first(dir: &Path) -> Vec<(PathBuf, String)> {
    let mut found: Vec<(PathBuf, String)> = fs::read_dir(dir.join(BACKUPS_DIRNAME))
        .map(|entries| {
            entries
                .flatten()
                .filter_map(|entry| {
                    let name = entry.file_name().to_string_lossy().to_string();
                    let stamp = name.strip_prefix("workspace-")?.strip_suffix(".sqlite3")?.to_string();
                    Some((entry.path(), stamp))
                })
                .collect()
        })
        .unwrap_or_default();
    found.sort_by(|a, b| b.1.cmp(&a.1));
    found
}

/// `20260822T015228Z` as `2026-08-22 01:52 UTC`.
pub fn readable_stamp(stamp: &str) -> String {
    if stamp.len() >= 13 && stamp.is_ascii() {
        format!("{}-{}-{} {}:{} UTC", &stamp[0..4], &stamp[4..6], &stamp[6..8], &stamp[9..11], &stamp[11..13])
    } else {
        stamp.to_string()
    }
}

fn set_aside(path: &Path, suffix: &str) -> Option<PathBuf> {
    if !path.exists() {
        return None;
    }
    let aside = path.with_file_name(format!("{}.{suffix}", path.file_name()?.to_string_lossy()));
    fs::rename(path, &aside).ok()?;
    Some(aside)
}

pub struct Starter<'a> {
    pub store: &'a PointerStore,
    pub default_dir: &'a Path,
    /// A suffix for files set aside, unique per attempt (a timestamp in use).
    pub aside_suffix: String,
}

impl Starter<'_> {
    /// Start on the configured folder; when its data is not usable, restore
    /// from the previous location, else from the newest backup that the
    /// backend accepts. Integrity is judged by the backend itself: a
    /// candidate is put in place and the sidecar is started on it, and
    /// `/ready` says whether it is usable. Never creates an empty folder for
    /// a missing configured location.
    pub fn start(&self, backend: &mut dyn Backend, mut notices: Vec<String>) -> StartOutcome {
        let pointer = match self.store.load() {
            Ok(pointer) => pointer,
            Err(reason) => {
                return StartOutcome::Failed { path: self.default_dir.to_path_buf(), problem: DataStatus::Damaged(reason), notices }
            }
        };
        let dir = data_dir(&pointer, self.default_dir);
        let status = backend.start(&dir, require_existing(&pointer));
        if status.is_ok() {
            return StartOutcome::Ready { path: dir, notices };
        }
        backend.stop();

        // 1. The previous location, while it still holds the data.
        if let Some(previous) = pointer.previous.clone() {
            if previous.join(DATABASE_FILENAME).is_file() {
                let back = Pointer {
                    path: if previous == self.default_dir { None } else { Some(previous.clone()) },
                    previous: None,
                    move_record: None,
                };
                if self.store.save(&back).is_ok() {
                    if backend.start(&previous, require_existing(&back)).is_ok() {
                        notices.push(format!(
                            "{} Learn Nodes went back to the previous folder, {}, which still held your data.",
                            status.describe(),
                            previous.display()
                        ));
                        return StartOutcome::Ready { path: previous, notices };
                    }
                    backend.stop();
                    let _ = self.store.save(&pointer);
                }
            }
        }

        // 2. The newest backup the backend accepts — only for a folder that
        //    exists: a missing one has no backups to read.
        if matches!(status, DataStatus::Damaged(_)) && dir.is_dir() {
            let database = dir.join(DATABASE_FILENAME);
            let sidecars = ["-wal", "-shm"].map(|ext| dir.join(format!("{DATABASE_FILENAME}{ext}")));
            let damaged = set_aside(&database, &format!("damaged-{}", self.aside_suffix));
            let damaged_sidecars: Vec<_> = sidecars
                .iter()
                .map(|p| (p.clone(), set_aside(p, &format!("damaged-{}", self.aside_suffix))))
                .collect();
            for (backup, stamp) in backups_newest_first(&dir) {
                if fs::copy(&backup, &database).is_err() {
                    continue;
                }
                if backend.start(&dir, require_existing(&pointer)).is_ok() {
                    notices.push(format!(
                        "{} Learn Nodes restored the copy of your data taken on {}; anything changed after then may be missing. The damaged database was kept beside it.",
                        status.describe(),
                        readable_stamp(&stamp)
                    ));
                    return StartOutcome::Ready { path: dir, notices };
                }
                backend.stop();
                let _ = fs::remove_file(&database);
                for ext in ["-wal", "-shm"] {
                    let _ = fs::remove_file(dir.join(format!("{DATABASE_FILENAME}{ext}")));
                }
            }
            // Nothing better: put the damaged files back, so a retry finds
            // things as they were.
            if let Some(aside) = damaged {
                let _ = fs::rename(aside, &database);
            }
            for (original, aside) in damaged_sidecars {
                if let Some(aside) = aside {
                    let _ = fs::rename(aside, original);
                }
            }
        }

        StartOutcome::Failed { path: dir, problem: status, notices }
    }

    /// Point at a folder the learner picked after a failed start.
    pub fn use_folder(&self, folder: &Path) -> Result<(), String> {
        self.store.save(&Pointer { path: Some(folder.to_path_buf()), previous: None, move_record: None })
    }

    /// Start over on the default folder, created if absent.
    pub fn use_default(&self) -> Result<(), String> {
        self.store.save(&Pointer::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    fn tmp() -> tempfile::TempDir {
        tempfile::tempdir().expect("tempdir")
    }

    fn data_folder(root: &Path) -> PathBuf {
        let dir = root.join("data");
        fs::create_dir_all(dir.join("backups")).unwrap();
        fs::create_dir_all(dir.join("agent-workspaces/node-1/practice")).unwrap();
        fs::write(dir.join(DATABASE_FILENAME), b"sqlite bytes").unwrap();
        fs::write(dir.join("backups/workspace-20260822T015228Z.sqlite3"), b"old").unwrap();
        fs::write(dir.join("backups/workspace-20260901T101010Z.sqlite3"), b"newer").unwrap();
        fs::write(dir.join("agent-workspaces/node-1/notes.md"), b"hello").unwrap();
        dir
    }

    /// Answers `start` from a queue, records calls; `Ok` once the queue is empty.
    #[derive(Default)]
    struct FakeBackend {
        answers: VecDeque<DataStatus>,
        started: Vec<(PathBuf, bool)>,
        stops: usize,
    }

    impl Backend for FakeBackend {
        fn stop(&mut self) {
            self.stops += 1;
        }
        fn start(&mut self, dir: &Path, require_existing: bool) -> DataStatus {
            self.started.push((dir.to_path_buf(), require_existing));
            self.answers.pop_front().unwrap_or(DataStatus::Ok)
        }
    }

    // --- pointer ---

    #[test]
    fn no_pointer_file_is_the_default_folder_and_does_not_require_it_to_exist() {
        let root = tmp();
        let store = PointerStore::new(root.path());
        let pointer = store.load().unwrap();
        assert_eq!(data_dir(&pointer, Path::new("/default")), PathBuf::from("/default"));
        assert!(!require_existing(&pointer));
        assert!(!store.exists());
    }

    #[test]
    fn a_saved_pointer_round_trips_and_a_chosen_folder_must_exist() {
        let root = tmp();
        let store = PointerStore::new(root.path());
        let pointer = Pointer {
            path: Some("/Volumes/Data/learn".into()),
            previous: Some("/old".into()),
            move_record: Some(MoveRecord { state: MoveState::Switched, from: "/old".into(), to: "/Volumes/Data/learn".into(), leftovers: vec![] }),
        };
        store.save(&pointer).unwrap();
        assert_eq!(store.load().unwrap(), pointer);
        assert!(require_existing(&pointer));
        let text = fs::read_to_string(root.path().join(POINTER_FILENAME)).unwrap();
        assert!(text.contains("\"move\"") && text.contains("\"switched\""), "{text}");
    }

    #[test]
    fn an_unreadable_pointer_is_an_error_not_a_guess() {
        let root = tmp();
        fs::write(root.path().join(POINTER_FILENAME), "{ not json").unwrap();
        assert!(PointerStore::new(root.path()).load().is_err());
    }

    // --- target checks ---

    #[test]
    fn an_empty_or_absent_writable_folder_elsewhere_is_accepted() {
        let root = tmp();
        let current = data_folder(root.path());
        assert!(check_target(&current, &root.path().join("absent/new")).ok);
        let empty = root.path().join("empty");
        fs::create_dir(&empty).unwrap();
        fs::write(empty.join(".DS_Store"), b"").unwrap();
        let check = check_target(&current, &empty);
        assert!(check.ok, "{check:?}");
        assert!(check.needed_bytes > 0);
    }

    #[test]
    fn a_folder_with_files_nested_folders_and_relative_paths_are_refused() {
        let root = tmp();
        let current = data_folder(root.path());
        let full = root.path().join("full");
        fs::create_dir(&full).unwrap();
        fs::write(full.join("x.txt"), b"x").unwrap();
        let refusal = |target: &Path| check_target(&current, target).reason.unwrap_or_default();
        assert!(refusal(&full).contains("must be empty"));
        assert!(refusal(&current.join("inner")).contains("inside"));
        assert!(refusal(root.path()).contains("contain"));
        assert!(refusal(&current).contains("already"));
        assert!(refusal(Path::new("relative/dir")).contains("full folder path"));
        assert!(refusal(&current.join("..").join("data")).contains("already"));
    }

    #[test]
    fn a_read_only_parent_is_refused() {
        let root = tmp();
        let current = data_folder(root.path());
        let locked = root.path().join("locked");
        fs::create_dir(&locked).unwrap();
        let mut permissions = fs::metadata(&locked).unwrap().permissions();
        std::os::unix::fs::PermissionsExt::set_mode(&mut permissions, 0o555);
        fs::set_permissions(&locked, permissions).unwrap();
        let check = check_target(&current, &locked.join("new"));
        let mut restore = fs::metadata(&locked).unwrap().permissions();
        std::os::unix::fs::PermissionsExt::set_mode(&mut restore, 0o755);
        fs::set_permissions(&locked, restore).unwrap();
        assert!(!check.ok && check.reason.unwrap().contains("not writable"));
    }

    #[test]
    fn a_synced_folder_is_accepted_with_a_warning() {
        assert!(looks_synced(Path::new("/Users/a/Library/Mobile Documents/com~apple~CloudDocs/learn")));
        assert!(looks_synced(Path::new("/Users/a/Dropbox/learn")));
        assert!(!looks_synced(Path::new("/Volumes/External/learn")));
    }

    // --- copy, manifest, verify ---

    #[test]
    fn a_copy_is_identical_links_stay_links_and_the_pointer_is_not_copied() {
        let root = tmp();
        let from = data_folder(root.path());
        fs::write(from.join(POINTER_FILENAME), "{}").unwrap();
        let outside = root.path().join("outside");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("big.bin"), vec![7u8; 1000]).unwrap();
        std::os::unix::fs::symlink(&outside, from.join("agent-workspaces/node-1/escape")).unwrap();
        let to = root.path().join("to");
        let mut reports = Vec::new();

        let manifest = copy_tree(&from, &to, &mut |p| reports.push(p)).unwrap();

        verify(&to, &manifest).unwrap();
        assert_eq!(manifest, manifest_of(&from).unwrap());
        assert!(fs::symlink_metadata(to.join("agent-workspaces/node-1/escape")).unwrap().file_type().is_symlink());
        assert_eq!(fs::read_link(to.join("agent-workspaces/node-1/escape")).unwrap(), outside);
        assert!(!to.join(POINTER_FILENAME).exists());
        let last = reports.last().unwrap();
        assert_eq!(last.copied_bytes, last.total_bytes);
        assert_eq!(last.total_bytes, 12 + 3 + 5 + 5, "the link's target is not counted");
    }

    #[test]
    fn a_changed_or_missing_file_fails_verification() {
        let root = tmp();
        let from = data_folder(root.path());
        let to = root.path().join("to");
        let manifest = copy_tree(&from, &to, &mut |_| {}).unwrap();
        fs::write(to.join(DATABASE_FILENAME), b"sqlite byteZ").unwrap();
        assert!(verify(&to, &manifest).unwrap_err().contains("differs"));
        fs::remove_file(to.join("agent-workspaces/node-1/notes.md")).unwrap();
        fs::write(to.join(DATABASE_FILENAME), b"sqlite bytes").unwrap();
        assert!(verify(&to, &manifest).unwrap_err().contains("missing"));
    }

    // --- removal ---

    #[test]
    fn removal_empties_the_folder_removes_links_and_keeps_their_targets_and_the_pointer() {
        let root = tmp();
        let from = data_folder(root.path());
        fs::write(from.join(POINTER_FILENAME), "{}").unwrap();
        let outside = root.path().join("outside");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("precious.txt"), b"keep").unwrap();
        std::os::unix::fs::symlink(&outside, from.join("agent-workspaces/node-1/escape")).unwrap();

        assert_eq!(remove_contents(&from), Vec::<String>::new());

        let left: Vec<_> = fs::read_dir(&from).unwrap().flatten().map(|e| e.file_name()).collect();
        assert_eq!(left, vec![std::ffi::OsString::from(POINTER_FILENAME)]);
        assert_eq!(fs::read(outside.join("precious.txt")).unwrap(), b"keep");
    }

    #[test]
    fn what_cannot_be_removed_is_reported_once() {
        let root = tmp();
        let from = data_folder(root.path());
        let stuck = from.join("agent-workspaces/node-1");
        let mut permissions = fs::metadata(&stuck).unwrap().permissions();
        std::os::unix::fs::PermissionsExt::set_mode(&mut permissions, 0o555);
        fs::set_permissions(&stuck, permissions).unwrap();

        let leftovers = remove_contents(&from);

        let mut restore = fs::metadata(&stuck).unwrap().permissions();
        std::os::unix::fs::PermissionsExt::set_mode(&mut restore, 0o755);
        fs::set_permissions(&stuck, restore).unwrap();
        assert_eq!(leftovers.len(), 2, "the two files inside the locked folder: {leftovers:?}");
        assert!(leftovers.iter().all(|l| leftover_path(l).starts_with("agent-workspaces/node-1/")));
        assert!(!from.join(DATABASE_FILENAME).exists());
    }

    // --- the move ---

    fn mover_setup() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let root = tmp();
        let config = root.path().join("config");
        fs::create_dir(&config).unwrap();
        let from = data_folder(root.path());
        (root, config, from)
    }

    #[test]
    fn a_move_copies_switches_starts_on_the_new_folder_and_empties_the_old() {
        let (root, config, from) = mover_setup();
        let store = PointerStore::new(&config);
        let to = root.path().join("new-home");
        let mut backend = FakeBackend::default();
        let mover = Mover { store: &store, default_dir: &from };

        let outcome = mover.run(&mut backend, &to, &mut |_| {});

        assert_eq!(outcome, MoveOutcome::Completed { path: to.clone(), leftovers: vec![] });
        assert_eq!(backend.stops, 1);
        assert_eq!(backend.started, vec![(to.clone(), true)]);
        assert_eq!(fs::read(to.join("agent-workspaces/node-1/notes.md")).unwrap(), b"hello");
        assert!(!from.join(DATABASE_FILENAME).exists());
        let pointer = store.load().unwrap();
        assert_eq!(pointer.path, Some(to.clone()));
        assert_eq!(pointer.previous, None);
        assert_eq!(pointer.move_record.unwrap().state, MoveState::Done);
    }

    #[test]
    fn a_new_folder_the_backend_refuses_rolls_everything_back() {
        let (root, config, from) = mover_setup();
        let store = PointerStore::new(&config);
        let to = root.path().join("new-home");
        let mut backend = FakeBackend { answers: VecDeque::from([DataStatus::Damaged("quick_check failed".into())]), ..Default::default() };
        let mover = Mover { store: &store, default_dir: &from };

        let outcome = mover.run(&mut backend, &to, &mut |_| {});

        let MoveOutcome::Abandoned { reason } = outcome else { panic!("expected abandoned") };
        assert!(reason.contains("stayed where it was") && reason.contains("quick_check"), "{reason}");
        assert_eq!(backend.started, vec![(to.clone(), true), (from.clone(), false)]);
        assert!(!to.exists(), "the partial copy is removed");
        assert_eq!(fs::read(from.join(DATABASE_FILENAME)).unwrap(), b"sqlite bytes");
        assert_eq!(store.load().unwrap(), Pointer::default());
    }

    #[test]
    fn a_refused_target_changes_nothing_and_never_stops_the_backend() {
        let (root, config, from) = mover_setup();
        let store = PointerStore::new(&config);
        let full = root.path().join("full");
        fs::create_dir(&full).unwrap();
        fs::write(full.join("x"), b"x").unwrap();
        let mut backend = FakeBackend::default();

        let outcome = Mover { store: &store, default_dir: &from }.run(&mut backend, &full, &mut |_| {});

        assert!(matches!(outcome, MoveOutcome::Abandoned { .. }));
        assert_eq!(backend.stops, 0);
        assert!(!store.exists());
    }

    #[test]
    fn an_interrupted_copy_is_undone_at_the_next_start() {
        let (root, config, from) = mover_setup();
        let store = PointerStore::new(&config);
        let to = root.path().join("half");
        fs::create_dir(&to).unwrap();
        fs::write(to.join(DATABASE_FILENAME), b"sqli").unwrap();
        store
            .save(&Pointer { move_record: Some(MoveRecord { state: MoveState::Copying, from: from.clone(), to: to.clone(), leftovers: vec![] }), ..Default::default() })
            .unwrap();

        let line = Mover { store: &store, default_dir: &from }.resume().unwrap();

        assert!(line.contains("interrupted") && line.contains("stayed"), "{line}");
        assert!(!to.exists());
        assert_eq!(store.load().unwrap(), Pointer::default());
        assert!(from.join(DATABASE_FILENAME).exists());
    }

    #[test]
    fn an_interrupted_switch_is_verified_and_completed_at_the_next_start() {
        let (root, config, from) = mover_setup();
        let store = PointerStore::new(&config);
        let to = root.path().join("new-home");
        copy_tree(&from, &to, &mut |_| {}).unwrap();
        store
            .save(&Pointer {
                path: Some(to.clone()),
                previous: Some(from.clone()),
                move_record: Some(MoveRecord { state: MoveState::Switched, from: from.clone(), to: to.clone(), leftovers: vec![] }),
            })
            .unwrap();

        let line = Mover { store: &store, default_dir: &from }.resume().unwrap();

        assert!(line.contains("completed"), "{line}");
        assert!(!from.join(DATABASE_FILENAME).exists());
        assert_eq!(store.load().unwrap().path, Some(to));
    }

    #[test]
    fn retrying_removal_clears_the_leftovers_once_they_can_go() {
        let (root, config, from) = mover_setup();
        let store = PointerStore::new(&config);
        let to = root.path().join("new-home");
        store
            .save(&Pointer {
                path: Some(to.clone()),
                previous: Some(from.clone()),
                move_record: Some(MoveRecord { state: MoveState::Done, from: from.clone(), to, leftovers: vec!["x".into()] }),
            })
            .unwrap();

        let leftovers = Mover { store: &store, default_dir: &from }.retry_removal().unwrap();

        assert!(leftovers.is_empty());
        let pointer = store.load().unwrap();
        assert_eq!((pointer.previous, pointer.move_record), (None, None));
    }

    // --- restore at start ---

    fn starter<'a>(store: &'a PointerStore, default_dir: &'a Path) -> Starter<'a> {
        Starter { store, default_dir, aside_suffix: "test".into() }
    }

    #[test]
    fn usable_data_starts_with_no_notice() {
        let (_root, config, from) = mover_setup();
        let store = PointerStore::new(&config);
        let mut backend = FakeBackend::default();
        let outcome = starter(&store, &from).start(&mut backend, vec![]);
        assert_eq!(outcome, StartOutcome::Ready { path: from.clone(), notices: vec![] });
        assert_eq!(backend.started, vec![(from, false)]);
    }

    #[test]
    fn an_unreadable_new_folder_falls_back_to_the_previous_one() {
        let (root, config, from) = mover_setup();
        let store = PointerStore::new(&config);
        let chosen = root.path().join("unplugged");
        store.save(&Pointer { path: Some(chosen.clone()), previous: Some(from.clone()), move_record: None }).unwrap();
        let mut backend = FakeBackend { answers: VecDeque::from([DataStatus::Missing("not found".into())]), ..Default::default() };

        let outcome = starter(&store, &from).start(&mut backend, vec![]);

        let StartOutcome::Ready { path, notices } = outcome else { panic!("expected ready") };
        assert_eq!(path, from);
        assert!(notices[0].contains("previous folder"), "{notices:?}");
        assert_eq!(backend.started, vec![(chosen.clone(), true), (from.clone(), false)]);
        assert!(!chosen.exists(), "a missing folder is never created");
        assert_eq!(store.load().unwrap().path, None);
    }

    #[test]
    fn a_damaged_database_is_replaced_by_the_newest_backup_the_backend_accepts() {
        let (_root, config, from) = mover_setup();
        let store = PointerStore::new(&config);
        let mut backend = FakeBackend {
            answers: VecDeque::from([
                DataStatus::Damaged("quick_check failed".into()),
                DataStatus::Damaged("the newest backup is damaged too".into()),
                DataStatus::Ok,
            ]),
            ..Default::default()
        };

        let outcome = starter(&store, &from).start(&mut backend, vec![]);

        let StartOutcome::Ready { notices, .. } = outcome else { panic!("expected ready") };
        assert!(notices[0].contains("2026-08-22 01:52 UTC"), "the older backup was used: {notices:?}");
        assert_eq!(fs::read(from.join(DATABASE_FILENAME)).unwrap(), b"old");
        assert_eq!(fs::read(from.join(format!("{DATABASE_FILENAME}.damaged-test"))).unwrap(), b"sqlite bytes");
    }

    #[test]
    fn with_no_good_copy_the_start_fails_and_the_damaged_files_are_put_back() {
        let (_root, config, from) = mover_setup();
        let store = PointerStore::new(&config);
        let damaged = DataStatus::Damaged("no".into());
        let mut backend = FakeBackend { answers: VecDeque::from(vec![damaged.clone(); 3]), ..Default::default() };

        let outcome = starter(&store, &from).start(&mut backend, vec![]);

        assert_eq!(outcome, StartOutcome::Failed { path: from.clone(), problem: damaged, notices: vec![] });
        assert_eq!(fs::read(from.join(DATABASE_FILENAME)).unwrap(), b"sqlite bytes");
        assert!(!from.join(format!("{DATABASE_FILENAME}.damaged-test")).exists());
    }

    #[test]
    fn a_missing_folder_with_no_previous_fails_without_creating_anything() {
        let root = tmp();
        let config = root.path().join("config");
        let store = PointerStore::new(&config);
        let missing = root.path().join("drive/learn");
        store.save(&Pointer { path: Some(missing.clone()), ..Default::default() }).unwrap();
        let mut backend = FakeBackend { answers: VecDeque::from([DataStatus::Missing("gone".into())]), ..Default::default() };

        let outcome = starter(&store, root.path()).start(&mut backend, vec![]);

        assert!(matches!(outcome, StartOutcome::Failed { problem: DataStatus::Missing(_), .. }));
        assert!(!missing.exists());
        assert_eq!(backend.started.len(), 1);
    }

    #[test]
    fn backups_are_read_newest_first_and_dates_are_readable() {
        let root = tmp();
        let dir = data_folder(root.path());
        let stamps: Vec<_> = backups_newest_first(&dir).into_iter().map(|(_, s)| s).collect();
        assert_eq!(stamps, ["20260901T101010Z", "20260822T015228Z"]);
        assert_eq!(readable_stamp("20260901T101010Z"), "2026-09-01 10:10 UTC");
        assert_eq!(human_bytes(1536), "1.5 KB");
    }
}
