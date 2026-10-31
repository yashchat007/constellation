/** Display helpers for mixed-script lyrics (backend romanizes; tests guard layout assumptions). */

const DEVA_START = 0x0900;
const DEVA_END = 0x097f;

export function containsDevanagari(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= DEVA_START && code <= DEVA_END) {
      return true;
    }
  }
  return false;
}

export function isMostlyRomanDisplay(text: string): boolean {
  if (!containsDevanagari(text)) {
    return true;
  }
  let letters = 0;
  let deva = 0;
  for (const c of text) {
    if (/[A-Za-z]/.test(c)) {
      letters += 1;
    } else if (containsDevanagari(c)) {
      deva += 1;
    }
  }
  return deva === 0 || letters > deva * 2;
}

/** Estimate max word width factor for long romanized Hindi tokens in karaoke layout. */
export function longWordScaleHint(word: string): number {
  const len = word.length;
  if (len <= 12) {
    return 1;
  }
  return Math.max(0.82, 12 / len);
}
