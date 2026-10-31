//! Local Devanagari → readable Roman Hindi (transliteration, not translation).

const DEVANAGARI_START: u32 = 0x0900;
const DEVANAGARI_END: u32 = 0x097F;

pub fn contains_devanagari(input: &str) -> bool {
    input.chars().any(is_devanagari)
}

pub fn is_mostly_roman(input: &str) -> bool {
    let mut letters = 0u32;
    let mut devanagari = 0u32;
    for c in input.chars() {
        if c.is_ascii_alphabetic() {
            letters += 1;
        } else if is_devanagari(c) {
            devanagari += 1;
        }
    }
    devanagari == 0 || letters > devanagari * 2
}

fn is_devanagari(c: char) -> bool {
    let u = c as u32;
    (DEVANAGARI_START..=DEVANAGARI_END).contains(&u)
}

fn consonant_base(c: char) -> Option<&'static str> {
    match c {
        'क' => Some("k"),
        'ख' => Some("kh"),
        'ग' => Some("g"),
        'घ' => Some("gh"),
        'ङ' => Some("ng"),
        'च' => Some("ch"),
        'छ' => Some("chh"),
        'ज' => Some("j"),
        'झ' => Some("jh"),
        'ञ' => Some("ny"),
        'ट' => Some("t"),
        'ठ' => Some("th"),
        'ड' => Some("d"),
        'ढ' => Some("dh"),
        'ण' => Some("n"),
        'त' => Some("t"),
        'थ' => Some("th"),
        'द' => Some("d"),
        'ध' => Some("dh"),
        'न' => Some("n"),
        'प' => Some("p"),
        'फ' => Some("ph"),
        'ब' => Some("b"),
        'भ' => Some("bh"),
        'म' => Some("m"),
        'य' => Some("y"),
        'र' => Some("r"),
        'ल' => Some("l"),
        'व' => Some("v"),
        'श' => Some("sh"),
        'ष' => Some("sh"),
        'स' => Some("s"),
        'ह' => Some("h"),
        'क़' => Some("q"),
        'ख़' => Some("kh"),
        'ग़' => Some("gh"),
        'ज़' => Some("z"),
        'ड़' => Some("d"),
        'ढ़' => Some("dh"),
        'फ़' => Some("f"),
        'य़' => Some("y"),
        _ => None,
    }
}

fn independent_vowel(c: char) -> Option<&'static str> {
    match c {
        'अ' => Some("a"),
        'आ' => Some("aa"),
        'इ' => Some("i"),
        'ई' => Some("i"),
        'उ' => Some("u"),
        'ऊ' => Some("u"),
        'ऋ' => Some("ri"),
        'ए' => Some("e"),
        'ऐ' => Some("ai"),
        'ओ' => Some("o"),
        'औ' => Some("au"),
        _ => None,
    }
}

fn matra_vowel(c: char) -> Option<&'static str> {
    match c {
        'ा' => Some("aa"),
        'ि' => Some("i"),
        'ी' => Some("i"),
        'ु' => Some("u"),
        'ू' => Some("u"),
        'ृ' => Some("ri"),
        'े' => Some("e"),
        'ै' => Some("ai"),
        'ो' => Some("o"),
        'ौ' => Some("au"),
        _ => None,
    }
}

fn ends_with_vowel_sound(base: &str) -> bool {
    base.ends_with("aa")
        || base.ends_with("ee")
        || base.ends_with("oo")
        || base.ends_with("ai")
        || base.ends_with("au")
        || base.ends_with("ri")
        || base.ends_with('a')
        || base.ends_with('i')
        || base.ends_with('u')
        || base.ends_with('e')
        || base.ends_with('o')
}

fn read_syllable(chars: &mut std::iter::Peekable<std::str::Chars<'_>>) -> String {
    let Some(c) = chars.next() else {
        return String::new();
    };

    if c == 'ं' {
        return "m".to_string();
    }
    if c == 'ँ' {
        return "n".to_string();
    }
    if c == 'ः' {
        return "h".to_string();
    }
    if c == '।' || c == '॥' {
        return " ".to_string();
    }

    if let Some(v) = independent_vowel(c) {
        return v.to_string();
    }

    let Some(first) = consonant_base(c) else {
        return c.to_string();
    };

    let mut syllable = first.to_string();

    loop {
        if chars.peek() == Some(&'्') {
            chars.next();
            if let Some(&next) = chars.peek() {
                if let Some(b) = consonant_base(next) {
                    chars.next();
                    syllable.push_str(b);
                    continue;
                }
            }
            break;
        }
        if let Some(&m) = chars.peek() {
            if let Some(v) = matra_vowel(m) {
                chars.next();
                syllable.push_str(v);
                break;
            }
        }
        if !ends_with_vowel_sound(&syllable) {
            syllable.push('a');
        }
        break;
    }

    syllable
}

fn trim_word_final_schwa(word: &str) -> String {
    if word.len() <= 2 {
        return word.to_string();
    }
    if word.ends_with("aa") || word.ends_with("ai") || word.ends_with("au") {
        return word.to_string();
    }
    if word.ends_with('a') {
        return word[..word.len() - 1].to_string();
    }
    word.to_string()
}

fn romanize_devanagari_segment(segment: &str) -> String {
    segment
        .split_whitespace()
        .map(|word| {
            let mut chars = word.chars().peekable();
            let mut w = String::new();
            while chars.peek().is_some() {
                w.push_str(&read_syllable(&mut chars));
            }
            trim_word_final_schwa(&w)
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Romanize Devanagari segments; preserve Latin/English tokens and punctuation.
pub fn romanize_display_text(input: &str) -> String {
    if input.trim().is_empty() {
        return input.to_string();
    }
    if !contains_devanagari(input) {
        return input.to_string();
    }

    let mut out = String::new();
    let mut latin = String::new();
    let mut deva = String::new();

    let flush_latin = |out: &mut String, latin: &mut String| {
        if !latin.is_empty() {
            out.push_str(latin.trim());
            latin.clear();
        }
    };
    let flush_deva = |out: &mut String, deva: &mut String| {
        if !deva.is_empty() {
            let r = romanize_devanagari_segment(deva);
            if !r.is_empty() {
                if !out.is_empty() && !out.ends_with(' ') {
                    out.push(' ');
                }
                out.push_str(&r);
            }
            deva.clear();
        }
    };

    for c in input.chars() {
        if is_devanagari(c) || c == '्' || c == 'ं' || c == 'ँ' || c == 'ः' || c == '।' {
            flush_latin(&mut out, &mut latin);
            deva.push(c);
        } else if c.is_ascii_alphanumeric() || c == '\'' || c == '-' {
            flush_deva(&mut out, &mut deva);
            latin.push(c);
        } else {
            flush_latin(&mut out, &mut latin);
            flush_deva(&mut out, &mut deva);
            if !c.is_whitespace() || !out.is_empty() {
                out.push(c);
            }
        }
    }
    flush_latin(&mut out, &mut latin);
    flush_deva(&mut out, &mut deva);

    let trimmed = out.split_whitespace().collect::<Vec<_>>().join(" ");
    capitalize_line_start(&trimmed)
}

fn capitalize_line_start(s: &str) -> String {
    let mut chars = s.chars();
    let Some(first) = chars.next() else {
        return String::new();
    };
    let mut head = first.to_uppercase().to_string();
    head.push_str(&chars.as_str().to_lowercase());
    head
}

pub fn romanize_for_matching(input: &str) -> String {
    if !contains_devanagari(input) {
        return input.to_string();
    }
    romanize_display_text(input).to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_devanagari() {
        assert!(contains_devanagari("तुम"));
        assert!(!contains_devanagari("Tum hi ho"));
    }

    #[test]
    fn preserves_roman_lyrics() {
        assert_eq!(romanize_display_text("Hello world"), "Hello world");
    }

    #[test]
    fn romanizes_kesariya_devanagari() {
        let r = romanize_display_text("केसरिया");
        assert!(r.to_lowercase().contains("kesariya"), "got {r}");
    }

    #[test]
    fn romanizes_tum_hi_ho() {
        let r = romanize_display_text("तुम ही हो");
        let lower = r.to_lowercase();
        assert!(lower.contains("tum"), "got {r}");
        assert!(lower.contains("hi"), "got {r}");
        assert!(lower.contains("ho"), "got {r}");
    }

    #[test]
    fn romanizes_baadal_barse() {
        let r = romanize_display_text("कभी जो बादल बरसे");
        let lower = r.to_lowercase();
        assert!(lower.contains("kabhi"), "got {r}");
        assert!(lower.contains("baadal") || lower.contains("badal"), "got {r}");
        assert!(lower.contains("barse") || lower.contains("barase"), "got {r}");
    }

    #[test]
    fn mixed_hindi_english() {
        let r = romanize_display_text("Tum hi ho — तुम ही हो");
        assert!(r.contains("Tum"));
        assert!(r.to_lowercase().contains("tum"));
    }

    #[test]
    fn no_double_transliteration() {
        let once = romanize_display_text("Tum hi ho");
        assert_eq!(romanize_display_text(&once), once);
    }
}
