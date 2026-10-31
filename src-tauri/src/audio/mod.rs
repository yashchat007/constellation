//! Local Windows WASAPI loopback capture + FFT feature analysis.

pub mod analyzer;
pub mod diag;
pub mod features;
pub mod service;
pub mod types;

#[cfg(windows)]
mod capture;

#[cfg(not(windows))]
mod capture_stub;
