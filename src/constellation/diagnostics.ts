const DEBUG_KEY = "constellation-sync-debug";

export function isSyncDebugEnabled(): boolean {
  if (!import.meta.env.DEV) {
    return false;
  }
  try {
    return localStorage.getItem(DEBUG_KEY) === "1";
  } catch {
    return false;
  }
}

export function logSyncMapping(payload: {
  playbackTimeMs: number;
  activeLineIndex: number;
  activeLyricText: string;
  activeNodeId: string | null;
  activeWordIndex: number;
  activeWordText: string | null;
  lineCount: number;
  nodeCount: number;
}) {
  if (!isSyncDebugEnabled()) {
    return;
  }
  console.info("[constellation:sync]", {
    t: Math.round(payload.playbackTimeMs),
    line: payload.activeLineIndex,
    lyric: payload.activeLyricText,
    nodeId: payload.activeNodeId,
    word: payload.activeWordIndex,
    wordText: payload.activeWordText,
    lines: payload.lineCount,
    nodes: payload.nodeCount,
  });
}
