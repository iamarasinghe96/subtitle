// srtParser.js
// Parses SubRip (.srt) text into an array of cues.
// A cue is: { index:number, startMs:number, endMs:number, text:string }
// text keeps internal line breaks (\n) but has formatting tags stripped.

const TIME_RE =
  /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

function toMs(h, m, s, ms) {
  // ms may be 1-3 digits; normalise to milliseconds
  const msNorm = Number(String(ms).padEnd(3, '0').slice(0, 3));
  return (((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000) + msNorm;
}

function stripTags(text) {
  return text
    .replace(/<\/?[^>]+>/g, '')      // <i>, <b>, <font ...>
    .replace(/\{\\?[^}]*\}/g, '')    // {\an8} ASS-style overrides
    .replace(/\u200b/g, '')          // zero-width spaces
    .trim();
}

// Returns { cues, warnings }
export function parseSrt(raw) {
  const warnings = [];
  if (!raw || !raw.trim()) {
    return { cues: [], warnings: ['The subtitle file is empty.'] };
  }

  // Normalise newlines and strip a leading BOM.
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

  // Split into blocks on blank lines.
  const blocks = text.split(/\n{2,}/);
  const cues = [];

  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (lines.length === 0) continue;

    // Find the line that holds the timecode (usually line 0 or 1).
    let timeLineIdx = lines.findIndex((l) => TIME_RE.test(l));
    if (timeLineIdx === -1) {
      warnings.push(`Skipped a block with no timing:\n"${block.slice(0, 40)}…"`);
      continue;
    }

    const m = lines[timeLineIdx].match(TIME_RE);
    const startMs = toMs(m[1], m[2], m[3], m[4]);
    const endMs = toMs(m[5], m[6], m[7], m[8]);

    // Everything after the timecode line is the cue text.
    const cueText = stripTags(lines.slice(timeLineIdx + 1).join('\n'));
    if (cueText === '') continue;

    cues.push({
      index: cues.length + 1,
      startMs,
      endMs: Math.max(endMs, startMs + 300),
      text: cueText,
    });
  }

  if (cues.length === 0) {
    warnings.push('No usable subtitle lines were found. Is this a valid .srt file?');
  }

  // Ensure ascending order by start time.
  cues.sort((a, b) => a.startMs - b.startMs);
  cues.forEach((c, i) => (c.index = i + 1));

  return { cues, warnings };
}

// Format ms back to SRT timestamp (used for the sync readout).
export function formatMs(ms) {
  const sign = ms < 0 ? '-' : '';
  ms = Math.abs(Math.round(ms));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const msRem = ms % 1000;
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${sign}${pad(h)}:${pad(m)}:${pad(s)}.${pad(msRem, 3)}`;
}
