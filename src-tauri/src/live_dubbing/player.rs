/// Real-time low-latency PCM audio player for live dubbing output.
/// Plays 24kHz/16kHz 16-bit LE mono PCM chunks via cpal output stream.
/// Adheres to Constitution Principle VIII (strictly <= 300 lines).

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use cpal::SampleFormat;

pub struct LiveAudioPlayer {
    buffer: Arc<Mutex<VecDeque<i16>>>,
    is_playing: Arc<AtomicBool>,
}

impl LiveAudioPlayer {
    pub fn new() -> Self {
        Self {
            buffer: Arc::new(Mutex::new(VecDeque::with_capacity(48000))),
            is_playing: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn start(&mut self) -> Result<(), String> {
        if self.is_playing.load(Ordering::SeqCst) {
            return Ok(());
        }

        let is_playing = self.is_playing.clone();
        is_playing.store(true, Ordering::SeqCst);
        let buffer = self.buffer.clone();

        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            let thread_playing = is_playing.clone();
            std::thread::spawn(move || {
                let host = cpal::default_host();
                let Some(device) = host.default_output_device() else {
                    eprintln!("Audio playback: No default output audio device found");
                    thread_playing.store(false, Ordering::SeqCst);
                    return;
                };

                let Ok(config) = device.default_output_config() else {
                    eprintln!("Audio playback: Failed to get default output config");
                    thread_playing.store(false, Ordering::SeqCst);
                    return;
                };

                let channels = config.channels() as usize;
                let sample_format = config.sample_format();

                let buffer_clone = buffer.clone();
                let err_fn = |err| eprintln!("Audio playback stream error: {}", err);

                let stream_result = match sample_format {
                    SampleFormat::F32 => device.build_output_stream(
                        &config.into(),
                        move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                            let mut buf = buffer_clone.lock().unwrap();
                            for frame in data.chunks_mut(channels) {
                                let sample_i16 = buf.pop_front().unwrap_or(0);
                                let sample_f32 = (sample_i16 as f32) / 32768.0;
                                for channel_sample in frame.iter_mut() {
                                    *channel_sample = sample_f32;
                                }
                            }
                        },
                        err_fn,
                        None,
                    ),
                    SampleFormat::I16 => device.build_output_stream(
                        &config.into(),
                        move |data: &mut [i16], _: &cpal::OutputCallbackInfo| {
                            let mut buf = buffer_clone.lock().unwrap();
                            for frame in data.chunks_mut(channels) {
                                let sample_i16 = buf.pop_front().unwrap_or(0);
                                for channel_sample in frame.iter_mut() {
                                    *channel_sample = sample_i16;
                                }
                            }
                        },
                        err_fn,
                        None,
                    ),
                    _ => {
                        eprintln!("Audio playback: Unsupported sample format {:?}", sample_format);
                        thread_playing.store(false, Ordering::SeqCst);
                        return;
                    }
                };

                if let Ok(stream) = stream_result {
                    if stream.play().is_ok() {
                        while thread_playing.load(Ordering::SeqCst) {
                            std::thread::sleep(std::time::Duration::from_millis(50));
                        }
                    }
                }
            });
        }

        Ok(())
    }

    /// Appends incoming PCM bytes (16-bit LE mono) into playback queue.
    pub fn push_audio_chunk(&self, pcm_bytes: &[u8]) {
        let mut samples = Vec::with_capacity(pcm_bytes.len() / 2);
        for chunk in pcm_bytes.chunks_exact(2) {
            let sample = i16::from_le_bytes([chunk[0], chunk[1]]);
            samples.push(sample);
        }

        if let Ok(mut buf) = self.buffer.lock() {
            if buf.len() > 48000 {
                buf.drain(..24000);
            }
            buf.extend(samples);
        }
    }

    pub fn has_queued_audio(&self) -> bool {
        if let Ok(buf) = self.buffer.lock() {
            !buf.is_empty()
        } else {
            false
        }
    }

    pub fn stop(&mut self) {
        self.is_playing.store(false, Ordering::SeqCst);
        if let Ok(mut buf) = self.buffer.lock() {
            buf.clear();
        }
    }
}

impl Default for LiveAudioPlayer {
    fn default() -> Self {
        Self::new()
    }
}
