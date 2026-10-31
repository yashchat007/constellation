export type LyricsErrorKind =
  | "not_found"
  | "rejected"
  | "rate_limit"
  | "transient"
  | "connectivity"
  | "busy"
  | "cancelled"
  | "parse"
  | "timeout"
  | "unknown";

export function classifyLyricsError(raw: string): LyricsErrorKind {
  const msg = raw.toLowerCase();
  if (msg.includes("not found") || msg.includes("no matching lyrics") || msg.includes("cached miss")) {
    return "not_found";
  }
  if (msg.includes("400") || msg.includes("bad request") || msg.includes("rejected query")) {
    return "rejected";
  }
  if (msg.includes("429") || msg.includes("rate limit")) {
    return "rate_limit";
  }
  if (msg.includes("already in progress") || msg.includes("fetch busy")) {
    return "busy";
  }
  if (msg.includes("cancelled") || msg.includes("superseded")) {
    return "cancelled";
  }
  if (msg.includes("parse error") || msg.includes("response parse")) {
    return "parse";
  }
  if (
    msg.includes("503") ||
    msg.includes("502") ||
    msg.includes("504") ||
    msg.includes("500") ||
    msg.includes("temporary outage") ||
    msg.includes("service may be unavailable") ||
    msg.includes("failed after retries")
  ) {
    return "transient";
  }
  if (msg.includes("timed out") || msg.includes("timeout")) {
    return "timeout";
  }
  if (msg.includes("connection error") || msg.includes("connectivity")) {
    return "connectivity";
  }
  return "unknown";
}

export function formatLyricsError(error: unknown): {
  kind: LyricsErrorKind;
  message: string;
} {
  const raw =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : "Lyrics lookup failed";
  const kind = classifyLyricsError(raw);
  switch (kind) {
    case "not_found":
      return {
        kind,
        message: `${raw}. Import a .lrc from Settings if LRCLIB has no match.`,
      };
    case "rejected":
      return {
        kind,
        message:
          "Lyrics lookup was rejected for this track title or artist. Use Retry or import a .lrc.",
      };
    case "rate_limit":
      return {
        kind,
        message:
          "LRCLIB rate limit reached. Wait a moment, then use Retry lyrics.",
      };
    case "transient":
      return {
        kind,
        message:
          "LRCLIB is temporarily unavailable (server or gateway error). Cached lyrics are kept when available — try Retry shortly.",
      };
    case "connectivity":
      return {
        kind,
        message:
          "Could not reach LRCLIB (connection, DNS, or TLS). Check your network, then Retry.",
      };
    case "busy":
      return {
        kind,
        message:
          "A lyrics lookup is already running for this track. Wait a moment, then Retry.",
      };
    case "cancelled":
      return {
        kind,
        message: "Lyrics lookup was replaced by a newer track.",
      };
    case "parse":
      return {
        kind,
        message:
          "Lyrics provider returned an unexpected response. Try Retry or import a .lrc.",
      };
    case "timeout":
      return {
        kind,
        message:
          "Lyrics lookup timed out while LRCLIB was slow or retrying. Try Retry lyrics.",
      };
    case "unknown":
      return {
        kind,
        message: `${raw}. Try Retry or import a .lrc.`,
      };
  }
}
