/**
 * Subtitle segmentation and sidecar files.
 *
 * A narration cue is a whole spoken paragraph. Showing one as a single caption
 * covers a third of the frame and is unreadable, which is why caption burn-in
 * used to be something to avoid. Splitting each cue into short, sentence-shaped
 * segments makes subtitles usable by default.
 *
 * Timing within a cue is proportional to segment length in characters. That is
 * an approximation of speech rate, and good enough at this granularity: a cue
 * carries real start/end times from synthesis, so error cannot accumulate beyond
 * one cue.
 */

export interface SubtitleCue {
  sceneId?: string;
  text: string;
  startMs: number;
  endMs: number;
}

/** Longest subtitle allowed on screen, in characters, across at most two lines. */
export const DEFAULT_MAX_SUBTITLE_CHARS = 84;

/** Shortest time a subtitle may stay up, so short fragments stay readable. */
const MIN_CUE_MS = 900;

/**
 * Split text into sentence-sized pieces, then pack any over-long sentence into
 * chunks at clause boundaries, falling back to word boundaries.
 */
export function splitIntoSubtitleTexts(
  text: string,
  maxChars = DEFAULT_MAX_SUBTITLE_CHARS
): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  // Keep terminal punctuation with its sentence.
  const sentences =
    normalized.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g)?.map((s) => s.trim()) ?? [
      normalized,
    ];

  const out: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= maxChars) {
      out.push(sentence);
      continue;
    }
    out.push(...packLongSentence(sentence, maxChars));
  }
  return out.filter((s) => s.length > 0);
}

function packLongSentence(sentence: string, maxChars: number): string[] {
  // Prefer breaking where a listener would pause.
  const clauses = sentence
    .split(/(?<=[,;:])\s+/)
    .map((c) => c.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const clause of clauses) {
    if (clause.length > maxChars) {
      flush();
      chunks.push(...packWords(clause, maxChars));
      continue;
    }
    if (!current) {
      current = clause;
    } else if (current.length + 1 + clause.length <= maxChars) {
      current = `${current} ${clause}`;
    } else {
      flush();
      current = clause;
    }
  }
  flush();
  return chunks;
}

function packWords(input: string, maxChars: number): string[] {
  const words = input.split(' ');
  const chunks: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxChars) {
      current = `${current} ${word}`;
    } else {
      chunks.push(current);
      current = word;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Expand paragraph-length cues into readable subtitle cues, distributing each
 * cue's own timing across its segments by character count.
 */
export function segmentSubtitleCues(
  cues: SubtitleCue[],
  maxChars = DEFAULT_MAX_SUBTITLE_CHARS
): SubtitleCue[] {
  const out: SubtitleCue[] = [];

  for (const cue of cues) {
    const pieces = splitIntoSubtitleTexts(cue.text, maxChars);
    if (pieces.length <= 1) {
      if (pieces.length === 1) out.push({ ...cue, text: pieces[0] });
      continue;
    }

    const span = Math.max(1, cue.endMs - cue.startMs);
    const totalChars = pieces.reduce((sum, p) => sum + p.length, 0) || 1;

    let consumed = 0;
    pieces.forEach((piece, index) => {
      const startMs =
        index === 0
          ? cue.startMs
          : Math.round(cue.startMs + (consumed / totalChars) * span);
      consumed += piece.length;
      const endMs =
        index === pieces.length - 1
          ? cue.endMs
          : Math.round(cue.startMs + (consumed / totalChars) * span);
      out.push({
        sceneId: cue.sceneId,
        text: piece,
        startMs,
        endMs: Math.max(endMs, startMs + 1),
      });
    });
  }

  // Enforce a readable minimum without letting a cue overrun the next one.
  for (let i = 0; i < out.length; i++) {
    const next = out[i + 1];
    const limit = next ? next.startMs : Number.POSITIVE_INFINITY;
    if (out[i].endMs - out[i].startMs < MIN_CUE_MS) {
      out[i].endMs = Math.min(out[i].startMs + MIN_CUE_MS, limit);
    }
  }

  return out;
}

/** Wrap a subtitle onto at most two balanced lines. */
export function wrapSubtitleText(text: string, maxCharsPerLine = 42): string {
  if (text.length <= maxCharsPerLine) return text;
  const words = text.split(' ');
  let best = { diff: Number.POSITIVE_INFINITY, at: 1 };
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ').length;
    const b = words.slice(i).join(' ').length;
    const diff = Math.abs(a - b);
    if (Math.max(a, b) <= maxCharsPerLine * 1.35 && diff < best.diff) {
      best = { diff, at: i };
    }
  }
  return `${words.slice(0, best.at).join(' ')}\n${words.slice(best.at).join(' ')}`;
}

function formatTimestamp(ms: number, comma: boolean): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const frac = total % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}${comma ? ',' : '.'}${pad(frac, 3)}`;
}

export function toSrt(cues: SubtitleCue[]): string {
  return (
    cues
      .map((cue, index) => {
        const time = `${formatTimestamp(cue.startMs, true)} --> ${formatTimestamp(cue.endMs, true)}`;
        return `${index + 1}\n${time}\n${wrapSubtitleText(cue.text)}\n`;
      })
      .join('\n') + '\n'
  );
}

export function toVtt(cues: SubtitleCue[], language?: string): string {
  const header = language ? `WEBVTT\nLanguage: ${language}\n` : 'WEBVTT\n';
  return (
    header +
    '\n' +
    cues
      .map((cue) => {
        const time = `${formatTimestamp(cue.startMs, false)} --> ${formatTimestamp(cue.endMs, false)}`;
        return `${time}\n${wrapSubtitleText(cue.text)}\n`;
      })
      .join('\n')
  );
}
