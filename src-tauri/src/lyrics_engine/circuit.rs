use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

struct CircuitState {
    failures: u32,
    open_until: Option<Instant>,
}

static CIRCUITS: Mutex<Option<HashMap<&'static str, CircuitState>>> = Mutex::new(None);

fn map() -> std::sync::MutexGuard<'static, Option<HashMap<&'static str, CircuitState>>> {
    CIRCUITS.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn provider_available(name: &'static str) -> bool {
    let mut g = map();
    if g.is_none() {
        *g = Some(HashMap::new());
    }
    let Some(states) = g.as_mut() else {
        return true;
    };
    let state = states.entry(name).or_insert(CircuitState {
        failures: 0,
        open_until: None,
    });
    if let Some(until) = state.open_until {
        if Instant::now() < until {
            return false;
        }
        state.open_until = None;
        state.failures = 0;
    }
    true
}

pub fn record_success(name: &'static str) {
    let mut g = map();
    if let Some(states) = g.as_mut() {
        states.remove(name);
    }
}

pub fn record_outage(name: &'static str) {
    let mut g = map();
    if g.is_none() {
        *g = Some(HashMap::new());
    }
    let Some(states) = g.as_mut() else {
        return;
    };
    let state = states.entry(name).or_insert(CircuitState {
        failures: 0,
        open_until: None,
    });
    state.failures = state.failures.saturating_add(1);
    if state.failures >= 2 {
        state.open_until = Some(Instant::now() + Duration::from_secs(120));
    }
}

#[cfg(test)]
pub fn reset_circuits_for_tests() {
    let mut g = map();
    *g = Some(HashMap::new());
}
