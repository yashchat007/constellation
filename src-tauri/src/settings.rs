use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub lyric_offset_ms: i64,
    pub text_size: f64,
    pub accent_color: String,
    pub auto_tint: bool,
    #[serde(default = "default_theme_transition_ms")]
    pub theme_transition_ms: u64,
    pub always_on_top: bool,
    pub show_constellation: bool,
    pub expanded_panel: bool,
    #[serde(default = "default_lyrics_view_mode")]
    pub lyrics_view_mode: String,
    #[serde(default)]
    pub audio_reactive_enabled: bool,
    #[serde(default)]
    pub audio_capture_enabled: bool,
    #[serde(default = "default_one_f")]
    pub audio_sensitivity: f64,
    #[serde(default = "default_one_f")]
    pub audio_motion_intensity: f64,
    #[serde(default = "default_one_f")]
    pub audio_particle_intensity: f64,
    #[serde(default = "default_audio_smoothing")]
    pub audio_smoothing: f64,
    #[serde(default = "default_true")]
    pub auto_mood_adaptation: bool,
    #[serde(default)]
    pub manual_mood_override: Option<String>,
}

fn default_lyrics_view_mode() -> String {
    "constellation".to_string()
}

fn default_theme_transition_ms() -> u64 {
    1750
}

fn default_one_f() -> f64 {
    1.0
}

fn default_audio_smoothing() -> f64 {
    0.22
}

fn default_true() -> bool {
    true
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            lyric_offset_ms: 0,
            text_size: 1.32,
            accent_color: "#E8C547".to_string(),
            auto_tint: true,
            theme_transition_ms: 1750,
            always_on_top: false,
            show_constellation: true,
            expanded_panel: true,
            lyrics_view_mode: default_lyrics_view_mode(),
            audio_reactive_enabled: true,
            audio_capture_enabled: true,
            audio_sensitivity: 1.0,
            audio_motion_intensity: 1.0,
            audio_particle_intensity: 1.0,
            audio_smoothing: default_audio_smoothing(),
            auto_mood_adaptation: true,
            manual_mood_override: None,
        }
    }
}

/// Legacy on-disk shape (v1) — merged into current defaults without wiping new fields.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyAppSettings {
    lyric_offset_ms: Option<i64>,
    text_size: Option<f64>,
    accent_color: Option<String>,
    auto_tint: Option<bool>,
    theme_transition_ms: Option<u64>,
    always_on_top: Option<bool>,
    show_constellation: Option<bool>,
    expanded_panel: Option<bool>,
    lyrics_view_mode: Option<String>,
}

pub fn load_settings(path: &std::path::Path) -> AppSettings {
    let mut settings = AppSettings::default();
    let Ok(data) = std::fs::read_to_string(path) else {
        return settings;
    };
    if let Ok(parsed) = serde_json::from_str::<AppSettings>(&data) {
        return parsed;
    }
    if let Ok(legacy) = serde_json::from_str::<LegacyAppSettings>(&data) {
        if let Some(v) = legacy.lyric_offset_ms {
            settings.lyric_offset_ms = v;
        }
        if let Some(v) = legacy.text_size {
            settings.text_size = v;
        }
        if let Some(v) = legacy.accent_color {
            settings.accent_color = v;
        }
        if let Some(v) = legacy.auto_tint {
            settings.auto_tint = v;
        }
        if let Some(v) = legacy.theme_transition_ms {
            settings.theme_transition_ms = v;
        }
        if let Some(v) = legacy.always_on_top {
            settings.always_on_top = v;
        }
        if let Some(v) = legacy.show_constellation {
            settings.show_constellation = v;
        }
        if let Some(v) = legacy.expanded_panel {
            settings.expanded_panel = v;
        }
        if let Some(v) = legacy.lyrics_view_mode {
            settings.lyrics_view_mode = v;
        }
    }
    settings
}

pub fn save_settings(path: &std::path::Path, settings: &AppSettings) -> Result<(), std::io::Error> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let data = serde_json::to_string_pretty(settings).unwrap_or_default();
    std::fs::write(path, data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_include_audio_fields() {
        let s = AppSettings::default();
        assert!(s.audio_reactive_enabled);
        assert!(s.audio_capture_enabled);
        assert_eq!(s.theme_transition_ms, 1750);
    }

    #[test]
    fn save_and_load_roundtrip() {
        let dir = std::env::temp_dir().join(format!(
            "constellation-settings-roundtrip-{}",
            std::process::id()
        ));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("settings.json");
        let original = AppSettings {
            lyric_offset_ms: 120,
            text_size: 1.4,
            always_on_top: true,
            show_constellation: false,
            expanded_panel: false,
            lyrics_view_mode: "traditional".to_string(),
            ..AppSettings::default()
        };
        save_settings(&path, &original).unwrap();
        let loaded = load_settings(&path);
        assert_eq!(loaded.lyric_offset_ms, 120);
        assert!((loaded.text_size - 1.4).abs() < 0.001);
        assert!(loaded.always_on_top);
        assert!(!loaded.show_constellation);
        assert_eq!(loaded.lyrics_view_mode, "traditional");
        assert!(loaded.audio_reactive_enabled);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn migrates_legacy_settings_file() {
        let dir = std::env::temp_dir().join(format!(
            "constellation-settings-test-{}",
            std::process::id()
        ));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("settings.json");
        std::fs::write(
            &path,
            "{\"lyricOffsetMs\":500,\"textSize\":1.2,\"accentColor\":\"#aabbcc\",\"autoTint\":false}",
        )
        .unwrap();
        let loaded = load_settings(&path);
        assert_eq!(loaded.lyric_offset_ms, 500);
        assert!((loaded.text_size - 1.2).abs() < 0.001);
        assert_eq!(loaded.accent_color, "#aabbcc");
        assert!(!loaded.auto_tint);
        assert!(loaded.audio_reactive_enabled);
        let _ = std::fs::remove_dir_all(dir);
    }
}
