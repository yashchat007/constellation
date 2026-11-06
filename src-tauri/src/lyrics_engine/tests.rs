use crate::lyrics_engine::circuit::{provider_available, record_outage, reset_circuits_for_tests};
use crate::lyrics_engine::ttml::ttml_to_lines;

#[test]
fn ttml_parses_word_spans() {
    let ttml = r#"<p><span begin="12.5s" end="13.0s">Hello</span> <span begin="13.0s" end="13.5s">world</span></p>"#;
    let lines = ttml_to_lines(ttml).expect("parse");
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0].words.len(), 2);
    assert_eq!(lines[0].words[0].start_ms, 12_500);
    assert_eq!(lines[0].words[1].text, "world");
}

#[test]
fn circuit_opens_after_repeated_outages() {
    reset_circuits_for_tests();
    assert!(provider_available("lrcmux"));
    record_outage("lrcmux");
    assert!(provider_available("lrcmux"));
    record_outage("lrcmux");
    assert!(!provider_available("lrcmux"));
    reset_circuits_for_tests();
}
