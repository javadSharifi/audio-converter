use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter as _};

use crate::error::AppError;
use crate::ffmpeg::run::CancelToken;
use crate::processing::naming;
use crate::processing::pipeline::{self, Emitter};
use crate::types::{ConversionOptions, JobEvent, JobStatus, TrimSpec};

/// Snapshot of one job, serialized to the frontend.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct JobRecord {
    pub id: String,
    pub source_path: String,
    pub status: JobStatus,
    pub percent: Option<f64>,
    pub speed: Option<String>,
    pub error: Option<String>,
    pub technical: Option<String>,
    pub warning: Option<String>,
    pub outputs: Vec<String>,
}

/// One unit of pending work. Carries its OWN options snapshot so that a
/// worker spawned for a previous batch can never process a newer item with
/// stale settings (the old-worker race).
struct QueuedJob {
    id: String,
    source: PathBuf,
    trim: Option<TrimSpec>,
    multiple_sources: bool,
    options: ConversionOptions,
}

struct QueueInner {
    app: AppHandle,
    jobs: Mutex<HashMap<String, JobRecord>>,
    /// FIFO of pending work.
    order: Mutex<VecDeque<QueuedJob>>,
    tokens: Mutex<HashMap<String, CancelToken>>,
    active_workers: AtomicUsize,
}

impl QueueInner {
    fn emit(&self, ev: &JobEvent) {
        let _ = self.app.emit("job-event", ev);
    }

    fn update(&self, id: &str, mutate: impl FnOnce(&mut JobRecord)) -> Option<JobRecord> {
        let mut guard = self.jobs.lock().unwrap();
        let rec = guard.get_mut(id)?;
        mutate(rec);
        Some(rec.clone())
    }
}

pub struct QueueManager {
    inner: Arc<QueueInner>,
}

impl QueueManager {
    pub fn new(app: AppHandle) -> Self {
        Self {
            inner: Arc::new(QueueInner {
                app,
                jobs: Mutex::new(HashMap::new()),
                order: Mutex::new(VecDeque::new()),
                tokens: Mutex::new(HashMap::new()),
                active_workers: AtomicUsize::new(0),
            }),
        }
    }

    /// Enqueue files and start `concurrency` workers. Returns job ids in
    /// the same order as `inputs`. Each item carries an optional per-file
    /// trim window; `None` means "process whole file".
    pub fn enqueue(
        &self,
        items: Vec<TrimSpec>,
        options: ConversionOptions,
        concurrency: u32,
    ) -> Vec<String> {
        // Cancel any lingering in-flight tasks from prior batch. Children are
        // killed synchronously here, so no old temp file can still be written
        // when we sweep below.
        self.cancel_all();
        crate::processing::naming::clear_reserved_paths();

        let is_multi = items.len() > 1;

        // Sweep orphaned `.part` temp files (from crashed/killed runs) in the
        // output directories of the incoming batch.
        let mut sweep_dirs: Vec<PathBuf> = items
            .iter()
            .map(|item| {
                naming::output_directory(Path::new(&item.path), &options, is_multi)
            })
            .collect();
        sweep_dirs.sort();
        sweep_dirs.dedup();
        naming::sweep_orphan_temps(&sweep_dirs);

        let mut ids = Vec::with_capacity(items.len());
        let mut fresh_records = Vec::with_capacity(items.len());
        {
            let mut jobs = self.inner.jobs.lock().unwrap();
            let mut order = self.inner.order.lock().unwrap();
            let mut tokens = self.inner.tokens.lock().unwrap();

            // Clear old jobs, order queue, and tokens completely for the fresh batch
            jobs.clear();
            order.clear();
            tokens.clear();

            for item in items {
                let id = new_job_id();
                let source = PathBuf::from(&item.path);
                // Whole-file job (both bounds blank): no seek flags anywhere.
                let trim = if item.start_time_secs.is_some() || item.end_time_secs.is_some() {
                    Some(item)
                } else {
                    None
                };
                let rec = JobRecord {
                    id: id.clone(),
                    source_path: source.to_string_lossy().into_owned(),
                    status: JobStatus::Waiting,
                    percent: None,
                    speed: None,
                    error: None,
                    technical: None,
                    warning: None,
                    outputs: vec![],
                };
                jobs.insert(id.clone(), rec.clone());
                tokens.insert(id.clone(), CancelToken::new());
                fresh_records.push(rec);
                order.push_back(QueuedJob {
                    id: id.clone(),
                    source,
                    trim,
                    multiple_sources: is_multi,
                    options: options.clone(),
                });
                ids.push(id);
            }
        }

        // Announce every queued job immediately so the UI list shows the
        // whole batch from the start, not only files once a worker picks them.
        for rec in &fresh_records {
            self.inner.emit_event_for(rec);
        }

        let worker_count = concurrency.clamp(1, 32).min((ids.len().max(1)) as u32) as usize;
        for _ in 0..worker_count {
            let inner = Arc::clone(&self.inner);
            std::thread::spawn(move || worker_loop(inner));
        }
        ids
    }

    /// Cancel a single job (queued or in-flight).
    pub fn cancel(&self, job_id: &str) {
        if let Some(tok) = self.inner.tokens.lock().unwrap().get(job_id) {
            tok.cancel();
        }
        if let Some(rec) = self.inner.update(job_id, |r| {
            if matches!(r.status, JobStatus::Waiting) {
                r.status = JobStatus::Cancelled;
            }
        }) {
            self.inner.emit_event_for(&rec);
        }
    }

    /// Cancel every known job.
    pub fn cancel_all(&self) {
        let tokens: Vec<CancelToken> = self
            .inner
            .tokens
            .lock()
            .unwrap()
            .values()
            .cloned()
            .collect();
        for t in tokens {
            t.cancel();
        }
        // Clear pending FIFO queue
        self.inner.order.lock().unwrap().clear();

        // Update all waiting and processing records to Cancelled
        let updated: Vec<JobRecord> = {
            let mut jobs = self.inner.jobs.lock().unwrap();
            let mut recs = Vec::new();
            for rec in jobs.values_mut() {
                if matches!(rec.status, JobStatus::Waiting | JobStatus::Processing) {
                    rec.status = JobStatus::Cancelled;
                    rec.speed = None;
                    recs.push(rec.clone());
                }
            }
            recs
        };
        for rec in updated {
            self.inner.emit_event_for(&rec);
        }
    }

    /// Drop finished/failed/cancelled records from the list.
    pub fn clear_finished(&self) {
        let mut jobs = self.inner.jobs.lock().unwrap();
        jobs.retain(|_, r| matches!(r.status, JobStatus::Waiting | JobStatus::Processing));
    }

    pub fn snapshot(&self) -> Vec<JobRecord> {
        let guard = self.inner.jobs.lock().unwrap();
        let mut all: Vec<JobRecord> = guard.values().cloned().collect();
        all.sort_by(|a, b| a.id.cmp(&b.id));
        all
    }

    /// True when no job is Waiting or Processing.
    pub fn is_idle(&self) -> bool {
        self.inner
            .jobs
            .lock()
            .unwrap()
            .values()
            .all(|r| !matches!(r.status, JobStatus::Waiting | JobStatus::Processing))
    }
}

impl QueueInner {
    fn emit_event_for(&self, rec: &JobRecord) {
        // Processing events tick ~4x/s per job; only lifecycle transitions
        // are worth a log line (keeps app.log small and IO off the hot path).
        if !matches!(rec.status, JobStatus::Processing) {
            crate::log_info!(
                "emit_event: id={} status={:?} percent={:?}",
                rec.id,
                rec.status,
                rec.percent
            );
        }
        self.emit(&JobEvent {
            id: rec.id.clone(),
            source_path: rec.source_path.clone(),
            status: rec.status.clone(),
            percent: rec.percent,
            speed: rec.speed.clone(),
            error: rec.error.clone(),
            technical: rec.technical.clone(),
            warning: rec.warning.clone(),
            outputs: rec.outputs.clone(),
        });
        self.notify_idle_if_needed();
    }

    fn notify_idle_if_needed(&self) {
        let busy = {
            let jobs = self.jobs.lock().unwrap();
            jobs.values()
                .any(|r| matches!(r.status, JobStatus::Waiting | JobStatus::Processing))
        };
        if !busy {
            let _ = self.app.emit("queue-idle", true);
        }
    }
}

fn new_job_id() -> String {
    use std::sync::atomic::AtomicU64;
    use std::time::{SystemTime, UNIX_EPOCH};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let n = SEQ.fetch_add(1, Ordering::SeqCst);
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("job-{ts}-{n}")
}

fn worker_loop(inner: Arc<QueueInner>) {
    inner.active_workers.fetch_add(1, Ordering::SeqCst);

    loop {
        let next = inner.order.lock().unwrap().pop_front();
        let Some(job) = next else { break };
        let QueuedJob {
            id: job_id,
            source,
            trim,
            multiple_sources,
            options,
        } = job;

        // Per-job token: cancel(job_id) kills only this file.
        let Some(token) = inner.tokens.lock().unwrap().get(&job_id).cloned() else {
            crate::log_warn!("missing token for job {job_id}, skipping");
            continue;
        };
        if token.is_cancelled() {
            if let Some(rec) = inner.update(&job_id, |r| r.status = JobStatus::Cancelled) {
                inner.emit_event_for(&rec);
            }
            continue;
        }

        // Resolve ffmpeg paths per job (honors settings override). A missing
        // bundled binary is surfaced as a job failure — never a silent
        // fallback to whatever `ffmpeg` happens to be on PATH.
        let (ffmpeg, ffprobe) = match resolve_binaries() {
            Ok(pair) => pair,
            Err(e) => {
                crate::log_error!("binaries missing: {e}");
                if let Some(rec) = inner.update(&job_id, |r| {
                    r.status = JobStatus::Failed;
                    r.error = Some(e.to_string());
                    r.technical = Some(
                        "Bundled ffmpeg/ffprobe binaries could not be located next to the executable. Reinstall the application."
                            .into(),
                    );
                    r.percent = None;
                    r.speed = None;
                }) {
                    inner.emit_event_for(&rec);
                }
                continue;
            }
        };

        if let Some(rec) = inner.update(&job_id, |r| {
            r.status = JobStatus::Processing;
            r.percent = Some(0.0);
        }) {
            inner.emit_event_for(&rec);
        }
        crate::log_info!("processing started: {}", source.display());

        let emitter: Emitter = {
            let inner2 = Arc::clone(&inner);
            Arc::new(move |ev: JobEvent| {
                let captured = ev.clone();
                inner2.emit(&captured);
                inner2.update(&ev.id, |r| {
                    r.percent = ev.percent;
                    r.speed = ev.speed.clone();
                    if let Some(w) = &ev.warning {
                        r.warning = Some(w.clone());
                    }
                });
            })
        };

        let result = pipeline::run_job(
            &job_id,
            &source,
            &options,
            trim.as_ref(),
            multiple_sources,
            &ffmpeg,
            &ffprobe,
            token.clone(),
            &emitter,
        );

        match result {
            Ok(outcome) => {
                // Android: publish finished outputs into the shared
                // Music/AudioConverter collection (desktop no-op).
                let outputs = crate::android_fs::publish_outputs(
                    &outcome
                        .outputs
                        .iter()
                        .map(|p| p.to_string_lossy().into_owned())
                        .collect::<Vec<String>>(),
                );
                if let Some(rec) = inner.update(&job_id, |r| {
                    r.status = JobStatus::Completed;
                    r.percent = Some(100.0);
                    r.speed = None;
                    r.warning = outcome.warning.clone();
                    r.outputs = outputs;
                }) {
                    inner.emit_event_for(&rec);
                }
                crate::log_info!("processing completed: {}", source.display());
            }
            Err(AppError::Cancelled) => {
                if let Some(rec) = inner.update(&job_id, |r| r.status = JobStatus::Cancelled) {
                    inner.emit_event_for(&rec);
                }
                crate::log_warn!("processing cancelled: {}", source.display());
            }
            Err(e) => {
                let technical = match &e {
                    AppError::FFmpeg(_) => Some(e.to_string()),
                    AppError::CorruptedFile(t) => Some(t.clone()),
                    AppError::NoAudioTrack(t) => Some(t.clone()),
                    _ => None,
                };
                if let Some(rec) = inner.update(&job_id, |r| {
                    r.status = JobStatus::Failed;
                    r.error = Some(e.to_string());
                    r.technical = technical.clone();
                    r.percent = None;
                    r.speed = None;
                }) {
                    inner.emit_event_for(&rec);
                }
                crate::log_error!("processing failed: {} — {e}", source.display());
            }
        }

        // NOTE: staged Android input files are intentionally NOT deleted
        // here — the UI row (trim editor, waveform, re-conversion) keeps
        // referencing them. Deletion happens explicitly via the
        // `delete_staged_input` command when the user removes the file, and
        // on cold start via MainActivity's staging-dir cleanup.
    }

    if inner.active_workers.fetch_sub(1, Ordering::SeqCst) == 1 {
        // Last worker out: make sure frontend knows the queue settled.
        inner.notify_idle_if_needed();
    }
}

fn resolve_binaries() -> Result<(PathBuf, PathBuf), AppError> {
    let override_path = crate::settings::Settings::load().ffmpeg_path_override;
    if let Some(p) = override_path {
        let pb = PathBuf::from(&p);
        if pb.exists() {
            // The override points at ffmpeg; derive ffprobe from its sibling
            // instead of reusing the same binary for both roles.
            let ffprobe = probe_sibling(&pb).unwrap_or_else(|| pb.clone());
            return Ok((pb, ffprobe));
        }
        crate::log_warn!("settings ffmpeg_path_override does not exist: {p}");
    }
    let ffmpeg = crate::ffmpeg::locate::ffmpeg_path()?;
    let ffprobe = crate::ffmpeg::locate::locate("ffprobe")?;
    Ok((ffmpeg, ffprobe))
}

/// Given `…/ffmpeg[.exe]`, return `…/ffprobe[.exe]` when it exists.
fn probe_sibling(ffmpeg: &Path) -> Option<PathBuf> {
    let dir = ffmpeg.parent()?;
    let file_name = ffmpeg.file_name()?.to_string_lossy().into_owned();
    let probe_name = if file_name.eq_ignore_ascii_case("ffmpeg.exe") {
        "ffprobe.exe"
    } else if file_name.eq_ignore_ascii_case("ffmpeg") {
        "ffprobe"
    } else {
        return None;
    };
    let candidate = dir.join(probe_name);
    candidate.exists().then_some(candidate)
}
