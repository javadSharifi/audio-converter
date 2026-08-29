use std::collections::VecDeque;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::error::AppError;

/// Shared cancellation flag + handle to the running child process.
#[derive(Clone, Default)]
pub struct CancelToken {
    inner: Arc<Inner>,
}

#[derive(Default)]
struct Inner {
    cancelled: AtomicBool,
    child: Mutex<Option<std::process::Child>>,
}

impl CancelToken {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_cancelled(&self) -> bool {
        self.inner.cancelled.load(Ordering::SeqCst)
    }

    /// Request cancellation and kill any attached child immediately.
    /// Safe to call multiple times and when no child is running.
    pub fn cancel(&self) {
        self.inner.cancelled.store(true, Ordering::SeqCst);
        let mut guard = self.inner.child.lock().unwrap();
        if let Some(child) = guard.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    fn attach(&self, mut child: std::process::Child) {
        // Race window: cancel may have fired between spawn and attach.
        if self.is_cancelled() {
            let _ = child.kill();
            let _ = child.wait();
            return;
        }
        *self.inner.child.lock().unwrap() = Some(child);
    }
}

const STDERR_TAIL_LINES: usize = 80;

pub struct RunOutcome {
    pub success: bool,
    pub code: Option<i32>,
    /// Last N stderr lines for "technical details" display.
    pub stderr_tail: Vec<String>,
}

type LineCb = Box<dyn FnMut(&str) + Send>;

/// Specification for one external process run.
pub struct RunSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub on_stdout_line: Option<LineCb>,
    pub on_stderr_line: Option<LineCb>,
    pub cancel: CancelToken,
}

impl RunSpec {
    pub fn new(program: PathBuf, args: Vec<String>) -> Self {
        Self {
            program,
            args,
            on_stdout_line: None,
            on_stderr_line: None,
            cancel: CancelToken::new(),
        }
    }

    pub fn with_stdout_cb(mut self, cb: LineCb) -> Self {
        self.on_stdout_line = Some(cb);
        self
    }

    pub fn with_stderr_cb(mut self, cb: LineCb) -> Self {
        self.on_stderr_line = Some(cb);
        self
    }

    pub fn cancellable(mut self, token: CancelToken) -> Self {
        self.cancel = token;
        self
    }

    /// Run the process to completion:
    /// - both pipes pumped concurrently on dedicated threads (no deadlock),
    /// - cancellation kills the child promptly (`AppError::Cancelled`),
    /// - caller only sleeps in short poll intervals; safe inside an async task.
    pub fn run(self) -> Result<RunOutcome, AppError> {
        crate::log_info!(
            "ffmpeg start: {} {}",
            self.program.display(),
            summarize_args(&self.args)
        );

        let mut command = Command::new(&self.program);
        command
            .args(&self.args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }

        let mut spawned = command.spawn().map_err(|e| {
            AppError::FFmpeg(format!("Failed to launch {}: {e}", self.program.display()))
        })?;

        let stdout_pipe = spawned.stdout.take();
        let stderr_pipe = spawned.stderr.take();
        self.cancel.attach(spawned);

        let tail: Arc<Mutex<VecDeque<String>>> =
            Arc::new(Mutex::new(VecDeque::with_capacity(STDERR_TAIL_LINES)));

        // ---- stderr pump -------------------------------------------------
        let mut stderr_cb = self.on_stderr_line;
        let tail_clone = Arc::clone(&tail);
        let err_thread = std::thread::spawn(move || {
            let Some(pipe) = stderr_pipe else { return };
            let reader = BufReader::new(pipe);
            for line in reader.lines().map_while(Result::ok) {
                if let Some(cb) = stderr_cb.as_mut() {
                    cb(&line);
                }
                let mut t = tail_clone.lock().unwrap();
                if t.len() == STDERR_TAIL_LINES {
                    t.pop_front();
                }
                t.push_back(line);
            }
        });

        // ---- stdout pump -------------------------------------------------
        let mut stdout_cb = self.on_stdout_line;
        let out_thread = std::thread::spawn(move || {
            let Some(pipe) = stdout_pipe else { return };
            let reader = BufReader::new(pipe);
            for line in reader.lines().map_while(Result::ok) {
                if let Some(cb) = stdout_cb.as_mut() {
                    cb(&line);
                }
            }
        });

        // ---- poll loop ---------------------------------------------------
        let exit_status = loop {
            if self.cancel.is_cancelled() {
                let mut guard = self.cancel.inner.child.lock().unwrap();
                if let Some(c) = guard.as_mut() {
                    let _ = c.kill();
                    let _ = c.wait();
                }
                *guard = None;
                drop(guard);
                let _ = out_thread.join();
                let _ = err_thread.join();
                crate::log_warn!("ffmpeg run cancelled");
                return Err(AppError::Cancelled);
            }

            let done = {
                let mut guard = self.cancel.inner.child.lock().unwrap();
                match guard.as_mut() {
                    Some(c) => c.try_wait().ok().flatten(),
                    None => None,
                }
            };
            if let Some(status) = done {
                break status;
            }
            std::thread::sleep(Duration::from_millis(60));
        };

        let (code, final_tail) = {
            let mut guard = self.cancel.inner.child.lock().unwrap();
            *guard = None;
            let t: Vec<String> = tail.lock().unwrap().iter().cloned().collect();
            (exit_status.code(), t)
        };
        let _ = out_thread.join();
        let _ = err_thread.join();

        let success = code == Some(0);
        if success {
            crate::log_info!("ffmpeg finished ok");
        } else {
            crate::log_error!("ffmpeg exited with code {code:?}");
        }
        Ok(RunOutcome {
            success,
            code,
            stderr_tail: final_tail,
        })
    }
}

fn summarize_args(args: &[String]) -> String {
    args.iter().take(10).cloned().collect::<Vec<_>>().join(" ")
}
