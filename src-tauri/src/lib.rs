mod artwork_validate;
mod audio;
mod lyrics;
mod settings;
mod smtc;
mod transliterate;

use audio::service::audio_service;
use audio::types::{AudioCaptureStatus, AudioFeatureSnapshot};
use lyrics::{
    fetch_lyrics_for_track, get_lyrics_fetch_diagnostics, load_lrc_from_path,
    probe_lrclib_connectivity, LyricsFetchDiagnostics, LyricsResult, LrclibConnectivityProbe,
};
use settings::{load_settings, save_settings, AppSettings};
use smtc::{
    media_next, media_play_pause, media_previous, media_seek_ms, read_now_playing,
    start_smtc_service, NowPlaying,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

#[tauri::command]
fn get_now_playing() -> Result<NowPlaying, String> {
    read_now_playing().map_err(|e| e.to_string())
}

#[tauri::command]
fn media_toggle_play_pause() -> Result<(), String> {
    media_play_pause().map_err(|e| e.to_string())
}

#[tauri::command]
fn media_skip_next() -> Result<(), String> {
    media_next().map_err(|e| e.to_string())
}

#[tauri::command]
fn media_skip_previous() -> Result<(), String> {
    media_previous().map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
fn media_seek_position(position_ms: u64) -> Result<(), String> {
    media_seek_ms(position_ms).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
async fn fetch_lyrics(
    artist: String,
    title: String,
    duration_ms: Option<u64>,
    bypass_negative_cache: Option<bool>,
    request_id: Option<u64>,
    app: tauri::AppHandle,
) -> Result<LyricsResult, String> {
    let cache_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("lyrics");
    let bypass = bypass_negative_cache.unwrap_or(false);
    let request_id = request_id.unwrap_or(0);
    tauri::async_runtime::spawn_blocking(move || {
        fetch_lyrics_for_track(
            &cache_dir,
            &artist,
            &title,
            duration_ms,
            bypass,
            request_id,
        )
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
async fn probe_lrclib() -> Result<LrclibConnectivityProbe, String> {
    Ok(tauri::async_runtime::spawn_blocking(probe_lrclib_connectivity)
        .await
        .map_err(|e| e.to_string())?)
}

#[tauri::command]
fn load_lrc_file(path: String, app: tauri::AppHandle) -> Result<LyricsResult, String> {
    let cache_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("lyrics");
    load_lrc_from_path(&cache_dir, &path).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
fn get_lyrics_fetch_diagnostics_cmd() -> Option<LyricsFetchDiagnostics> {
    get_lyrics_fetch_diagnostics()
}

#[tauri::command(rename_all = "camelCase")]
fn get_settings(app: tauri::AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(&app)?;
    Ok(load_settings(&path))
}

#[tauri::command(rename_all = "camelCase")]
fn set_settings(app: tauri::AppHandle, settings: AppSettings) -> Result<(), String> {
    let path = settings_path(&app)?;
    save_settings(&path, &settings).map_err(|e| e.to_string())
}

fn settings_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|p| p.join("settings.json"))
        .map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
fn get_audio_capture_status() -> AudioCaptureStatus {
    audio_service().status()
}

#[tauri::command(rename_all = "camelCase")]
fn get_audio_features() -> AudioFeatureSnapshot {
    audio_service().latest_snapshot()
}

#[tauri::command(rename_all = "camelCase")]
fn start_audio_capture(app: tauri::AppHandle) -> Result<(), String> {
    audio_service().start(app)
}

#[tauri::command]
fn stop_audio_capture() {
    audio_service().stop();
}

#[tauri::command(rename_all = "camelCase")]
fn set_audio_analysis_tuning(sensitivity: f32, smoothing: f32) {
    audio_service().set_tuning(sensitivity, smoothing);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            start_smtc_service();

            let show_i = MenuItem::with_id(app, "show", "Show Constellation", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("Constellation")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        audio_service().stop();
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_now_playing,
            media_toggle_play_pause,
            media_skip_next,
            media_skip_previous,
            media_seek_position,
            fetch_lyrics,
            probe_lrclib,
            get_lyrics_fetch_diagnostics_cmd,
            load_lrc_file,
            get_settings,
            set_settings,
            get_audio_capture_status,
            get_audio_features,
            start_audio_capture,
            stop_audio_capture,
            set_audio_analysis_tuning,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
