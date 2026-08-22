use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter as _};

use crate::error::AppError;
use crate::ffmpeg::run::CancelToken;
use crate::processing::pipeline::{self, Emitter};
use crate::types::{ConversionOptions, JobEvent, JobStatus};

/// Snapshot of one job, serialized to the frontend.
#[derive(Debug, Clone, serde::Serialize)]
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

struct QueueInner {
    app: AppHandle,
    jobs: Mutex<HashMap<String, JobRecord>>,
    order: Mutex<VecDeque<(String, PathBuf)>>,
    tokens: Mutex<HashMap<String, CancelToken>>,
    active_workers: AtomicUsize,
    shutting_down: AtomicBool,
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
                shutting_down: AtomicBool::new(false),
            }),
        }
    }

    /// Enqueue files and start `concurrency` workers. Returns job ids in
    /// the same order as `inputs`.
    pub fn enqueue(
        &self,
        inputs: Vec<String>,
        options: ConversionOptions,
        concurrency: u32,
    ) -> Vec<String> {
        let mut ids = Vec::with_capacity(inputs.len());
        {
            let mut jobs = self.inner.jobs.lock().unwrap();
            let mut order = self.inner.order.lock().unwrap();
            for path in inputs {
                let id = new_job_id();
                jobs.insert(
                    id.clone(),
                    JobRecord {
                        id: id.clone(),
                        source_path: path.clone(),
                        status: JobStatus::Waiting,
                        percent: None,
                        speed: None,
                        error: None,
                        technical: None,
                        warning: None,
                        outputs: vec![],
                    },
                );
                order.push_back((id.clone(), PathBuf::from(&path)));
                ids.push(id);
            }
        }

        // Register cancel token per job (shared by all workers of this batch).
        let batch_token = CancelToken::new();
        {
            let mut tokens = self.inner.tokens.lock().unwrap();
            for id in &ids {
                tokens.insert(id.clone(), batch_token.clone());
            }
        }

        let worker_count = concurrency
            .clamp(1, 32)
            .min((ids.len().max(1)) as u32) as usize;
        for _ in 0..worker_count {
            let inner = Arc::clone(&self.inner);
            let options = options.clone();
            let token = batch_token.clone();
            std::thread::spawn(move || worker_loop(inner, options, token));
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
        let tokens: Vec<CancelToken> = self.inner.tokens.lock().unwrap().values().cloned().collect();
        for t in tokens {
            t.cancel();
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
        self.emit(&JobEvent {
            job_id: rec.id.clone(),
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
            jobs.values().any(|r| matches!(r.status, JobStatus::Waiting | JobStatus::Processing))
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

fn worker_loop(inner: Arc<QueueInner>, options: ConversionOptions, batch_token: CancelToken) {
    inner.active_workers.fetch_add(1, Ordering::SeqCst);

    loop {
        if inner.shutting_down.load(Ordering::SeqCst) || batch_token.is_cancelled() {
            break;
        }
        let next = inner.order.lock().unwrap().pop_front();
        let Some((job_id, source)) = next else { break };

        // Queued-cancel fast path.
        if batch_token.is_cancelled() {
            if let Some(rec) = inner.update(&job_id, |r| r.status = JobStatus::Cancelled) {
                inner.emit_event_for(&rec);
            }
            continue;
        }

        // Resolve ffmpeg paths per job (honors settings override).
        let (ffmpeg, ffprobe) = resolve_binaries();

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
                inner2.update(&ev.job_id, |r| {
                    r.percent = ev.percent;
                    r.speed = ev.speed.clone();
                    if let Some(w) = &ev.warning {
                        r.warning = Some(w.clone());
                    }
                });
            })
        };

        let multiple_sources = {
            // Approximation at planning time; naming only depends on it when
            // CustomFolder mode is active.
            inner.order.lock().unwrap().len() + 1 > 1
        };

        let result = pipeline::run_job(
            &job_id,
            &source,
            &options,
            multiple_sources,
            &ffmpeg,
            &ffprobe,
            batch_token.clone(),
            &emitter,
        );

        match result {
            Ok(outcome) => {
                if let Some(rec) = inner.update(&job_id, |r| {
                    r.status = JobStatus::Completed;
                    r.percent = Some(100.0);
                    r.speed = None;
                    r.warning = outcome.warning.clone();
                    r.outputs = outcome
                        .outputs
                        .iter()
                        .map(|p| p.to_string_lossy().into_owned())
                        .collect();
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
    }

    if inner.active_workers.fetch_sub(1, Ordering::SeqCst) == 1 {
        // Last worker out: make sure frontend knows the queue settled.
        inner.notify_idle_if_needed();
    }
}

fn resolve_binaries() -> (PathBuf, PathBuf) {
    let override_path = crate::settings::Settings::load().ffmpeg_path_override;
    if let Some(p) = override_path {
        let pb = PathBuf::from(&p);
        if pb.exists() {
            return (pb.clone(), pb);
        }
    }
    (
        crate::ffmpeg::locate::ffmpeg_path().unwrap_or_else(|_| PathBuf::from("ffmpeg")),
        crate::ffmpeg::locate::locate("ffprobe").unwrap_or_else(|_| PathBuf::from("ffprobe")),
    )
}
