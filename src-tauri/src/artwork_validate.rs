//! Reject browser/app icons masquerading as album art from SMTC thumbnails.

pub fn png_dimensions(raw: &[u8]) -> Option<(u32, u32)> {
    if raw.len() < 24 || !raw.starts_with(b"\x89PNG\r\n\x1a\n") {
        return None;
    }
    let w = u32::from_be_bytes([raw[16], raw[17], raw[18], raw[19]]);
    let h = u32::from_be_bytes([raw[20], raw[21], raw[22], raw[23]]);
    Some((w, h))
}

fn jpeg_dimensions(raw: &[u8]) -> Option<(u32, u32)> {
    if raw.len() < 4 || raw[0] != 0xFF || raw[1] != 0xD8 {
        return None;
    }
    let mut i = 2usize;
    while i + 9 < raw.len() {
        if raw[i] != 0xFF {
            i += 1;
            continue;
        }
        let marker = raw[i + 1];
        if marker == 0xD9 || marker == 0xDA {
            break;
        }
        if i + 3 >= raw.len() {
            break;
        }
        let len = u16::from_be_bytes([raw[i + 2], raw[i + 3]]) as usize;
        if len < 2 || i + 2 + len > raw.len() {
            break;
        }
        if matches!(marker, 0xC0 | 0xC1 | 0xC2 | 0xC3) {
            if i + 7 < raw.len() {
                let h = u16::from_be_bytes([raw[i + 5], raw[i + 6]]) as u32;
                let w = u16::from_be_bytes([raw[i + 7], raw[i + 8]]) as u32;
                return Some((w, h));
            }
        }
        i += 2 + len;
    }
    None
}

pub fn image_dimensions(raw: &[u8]) -> Option<(u32, u32)> {
    png_dimensions(raw).or_else(|| jpeg_dimensions(raw))
}

/// Returns false for favicons, tiny squares, and other non-album thumbnails.
pub fn is_plausible_album_artwork(raw: &[u8]) -> bool {
    if raw.len() < 4096 {
        return false;
    }
    if let Some((w, h)) = image_dimensions(raw) {
        let min_side = w.min(h);
        let max_side = w.max(h);
        if min_side < 120 {
            return false;
        }
        if max_side <= 128 && raw.len() < 20_000 {
            return false;
        }
        if w == h && w <= 96 {
            return false;
        }
    } else if raw.len() < 12_000 {
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_tiny_payloads() {
        assert!(!is_plausible_album_artwork(&[0u8; 500]));
    }

    #[test]
    fn rejects_small_square_png() {
        let mut png = vec![
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D, 0x49, 0x48, 0x44, 0x52,
        ];
        png.extend_from_slice(&64u32.to_be_bytes());
        png.extend_from_slice(&64u32.to_be_bytes());
        png.resize(5000, 0);
        assert!(!is_plausible_album_artwork(&png));
    }

    #[test]
    fn accepts_large_enough_png_without_dimensions() {
        assert!(is_plausible_album_artwork(&vec![0u8; 14_000]));
    }
}
