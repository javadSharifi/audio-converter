use serde::{Deserialize, Serialize};

use super::analyze::VolumeAnalysis;

/// The 5 official booster presets + manual mode.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum BoosterPreset {
    /// Automatic dynamic gain based on dynamic normalizer + limiter (Default).
    Smart,
    /// Balanced boost tuned for music (+6 dB default or safe headroom + limiter).
    Music,
    /// Speech-optimized boost with low-cut filter (highpass 80Hz) to remove rumble.
    Voice,
    /// Low-end emphasis (bass boost + dynaudnorm + limiter) for bass-heavy audio.
    Bass,
    /// Maximum amplification with strict limiter — surfaces quality warning in UI.
    Extreme,
    /// User-controlled slider (0% to 200%).
    Manual,
}

impl Default for BoosterPreset {
    fn default() -> Self {
        Self::Smart
    }
}

/// Standard alimiter filter string ensuring safe peaks across all presets.
pub const DEFAULT_LIMITER: &str = "alimiter=limit=0.95:attack=5:release=50:asc=1";
pub const STRICT_LIMITER: &str = "alimiter=limit=0.98:attack=2:release=20:asc=1";

/// Build the FFmpeg audio filter chain for a given preset.
///
/// NOTE: Every filter graph without exception ends with `alimiter` to guarantee
/// clean output without digital clipping.
pub fn build_preset_filter_chain(
    preset: BoosterPreset,
    manual_gain_percent: Option<f64>,
    analysis: Option<&VolumeAnalysis>,
) -> String {
    match preset {
        BoosterPreset::Smart => {
            // dynaudnorm dynamically normalizes quiet sections without crushing peaks.
            format!("dynaudnorm=f=150:g=15:m=10.0:r=0.9,{DEFAULT_LIMITER}")
        }
        BoosterPreset::Music => {
            let gain_db = if let Some(a) = analysis {
                (a.suggested_gain_db + 2.0).clamp(0.0, 9.0)
            } else {
                6.0
            };
            format!("volume={gain_db:.1}dB,{DEFAULT_LIMITER}")
        }
        BoosterPreset::Voice => {
            // highpass=80 eliminates microphone handling noise and low rumble;
            // dynaudnorm with g=21 boosts dialogue clarity.
            format!("highpass=f=80,dynaudnorm=f=200:g=21:m=10.0:r=0.9,{DEFAULT_LIMITER}")
        }
        BoosterPreset::Bass => {
            // bass=g=6:f=100 boosts low-frequencies with dynaudnorm and limiter protection.
            format!("bass=g=6:f=100,dynaudnorm=f=150:g=15:m=10.0:r=0.9,{DEFAULT_LIMITER}")
        }
        BoosterPreset::Extreme => {
            // Maximum loudness before heavy distortion + faster, stricter limiter.
            format!("volume=14dB,{STRICT_LIMITER}")
        }
        BoosterPreset::Manual => {
            // Percentage: 0% = 0.0 (mute), 100% = 1.0 (0dB), 200% = 2.0 (+6.02dB), clamp 0..200
            let pct = manual_gain_percent.unwrap_or(100.0).clamp(0.0, 200.0);
            let multiplier = pct / 100.0;
            format!("volume={multiplier:.3},{DEFAULT_LIMITER}")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_all_presets_include_alimiter() {
        let presets = [
            BoosterPreset::Smart,
            BoosterPreset::Music,
            BoosterPreset::Voice,
            BoosterPreset::Bass,
            BoosterPreset::Extreme,
            BoosterPreset::Manual,
        ];

        for p in presets {
            let chain = build_preset_filter_chain(p, Some(150.0), None);
            assert!(
                chain.contains("alimiter"),
                "Preset {p:?} must end with alimiter, got: {chain}"
            );
        }
    }

    #[test]
    fn test_manual_gain_math() {
        let chain_100 = build_preset_filter_chain(BoosterPreset::Manual, Some(100.0), None);
        assert!(chain_100.contains("volume=1.000"));

        let chain_200 = build_preset_filter_chain(BoosterPreset::Manual, Some(200.0), None);
        assert!(chain_200.contains("volume=2.000"));
    }

    #[test]
    fn test_voice_preset_has_highpass() {
        let chain = build_preset_filter_chain(BoosterPreset::Voice, None, None);
        assert!(chain.contains("highpass=f=80"));
    }

    #[test]
    fn test_bass_preset_has_bass_filter() {
        let chain = build_preset_filter_chain(BoosterPreset::Bass, None, None);
        assert!(chain.contains("bass=g=6:f=100"));
    }
}
