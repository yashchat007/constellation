/** Karaoke-style word focus driven by sync indices (not a separate clock). */

export const WORD_BASE_PX = 19;
export const WORD_ACTIVE_SCALE_MAX = 1.32;
export const WORD_ACTIVE_SCALE_MIN = 1;

export function wordScaleFromEmphasis(emphasis: number): number {
  const e = Math.max(0, Math.min(1, emphasis));
  return WORD_ACTIVE_SCALE_MIN + e * (WORD_ACTIVE_SCALE_MAX - WORD_ACTIVE_SCALE_MIN);
}

export function wordEmphasisTarget(
  wordIndex: number,
  activeWordIndex: number,
  playing: boolean,
  wordSyncActive: boolean,
): number {
  if (!playing || !wordSyncActive || activeWordIndex < 0) {
    return wordIndex === activeWordIndex && activeWordIndex >= 0 ? 0.85 : 0;
  }
  if (wordIndex === activeWordIndex) {
    return 1;
  }
  if (wordIndex < activeWordIndex) {
    return 0.38;
  }
  return 0.12;
}

export function smoothEmphasis(
  current: number,
  target: number,
  dtMs: number,
  becomingActive: boolean,
): number {
  const rate = becomingActive ? 0.038 : 0.026;
  const t = 1 - Math.exp(-dtMs * rate);
  return current + (target - current) * t;
}

export function updateWordEmphasisLevels(
  levels: number[],
  wordCount: number,
  activeWordIndex: number,
  playing: boolean,
  dtMs: number,
): number[] {
  const next =
    levels.length === wordCount ? [...levels] : new Array(wordCount).fill(0);
  const wordSyncActive = activeWordIndex >= 0;
  for (let i = 0; i < wordCount; i += 1) {
    const target = wordEmphasisTarget(
      i,
      activeWordIndex,
      playing,
      wordSyncActive,
    );
    if (!playing) {
      continue;
    }
    next[i] = smoothEmphasis(next[i], target, dtMs, i === activeWordIndex);
  }
  return next;
}

/** True when at least one word has non-estimated timing (karaoke emphasis allowed). */
export function wordsHaveReliableSync(words: { estimated: boolean }[]): boolean {
  return words.length > 0 && words.some((w) => !w.estimated);
}

/** Phrase-level highlight when there is no word index (no per-word timings). */
export function phraseLevelWordEmphasis(
  wordCount: number,
  lineIsActive: boolean,
): number[] {
  if (!lineIsActive || wordCount <= 0) {
    return new Array(wordCount).fill(0);
  }
  return new Array(wordCount).fill(0.55);
}
