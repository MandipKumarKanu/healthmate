/**
 * HealthMate - Geometric OCR text ordering
 *
 * ML Kit returns blocks/lines in detection order, not visual reading order.
 * On medicine packaging (boxes with side panels, bottles, blister backs) the
 * flattened text blob frequently interleaves lines, so the "full label text"
 * reads jumbled and downstream label parsing misfires. Every recognized line
 * carries a bounding `frame`, so the reliable reading order can be rebuilt
 * geometrically:
 *
 *   1. lines with frames are grouped into visual rows by vertical overlap
 *   2. rows sort top → bottom; fragments inside a row sort left → right
 *   3. fragments separated by a wide horizontal gap (separate label columns
 *      or panels) are split back into their own lines
 *   4. duplicate detections (same text at the same spot) are dropped
 *
 * Pure and framework-free: unit-testable without native module mocks.
 */

export interface LineFrame {
  width: number;
  height: number;
  top: number;
  left: number;
}

export interface FramedLine {
  text: string;
  frame?: LineFrame | null;
}

/** Horizontal gap (px) that means "different column/panel", as a multiple of the row's median line height. */
const COLUMN_GAP_FACTOR = 1.5;

/** Minimum vertical overlap ratio for two framed lines to be the same row. */
const ROW_OVERLAP_RATIO = 0.45;

/** Overlap under which two similar-text lines count as duplicate detections. */
const DUPLICATE_CENTRAL_OVERLAP = 0.5;

/** Normalizes one recognized line: collapses inner spacing, trims edges. */
export function normalizeLineText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export interface FramedLineLike {
  frame?: LineFrame | null;
}

function hasUsableFrame<T extends FramedLineLike>(
  line: T
): line is T & { frame: LineFrame } {
  return (
    !!line.frame &&
    line.frame.width > 0 &&
    line.frame.height > 0
  );
}

function verticalOverlapRatio(
  aTop: number,
  aBottom: number,
  bTop: number,
  bBottom: number
): number {
  const overlap = Math.min(aBottom, bBottom) - Math.max(aTop, bTop);
  const smaller = Math.min(aBottom - aTop, bBottom - bTop);
  if (overlap <= 0 || smaller <= 0) return 0;
  return overlap / smaller;
}

function centersClose(a: LineFrame, b: LineFrame): boolean {
  const aCx = a.left + a.width / 2;
  const aCy = a.top + a.height / 2;
  const bCx = b.left + b.width / 2;
  const bCy = b.top + b.height / 2;
  const refHeight = Math.max(a.height, b.height);
  return (
    Math.abs(aCx - bCx) < refHeight * DUPLICATE_CENTRAL_OVERLAP &&
    Math.abs(aCy - bCy) < refHeight * DUPLICATE_CENTRAL_OVERLAP
  );
}

/**
 * ML Kit occasionally emits the same physical line twice (overlapping
 * block/paragraph groupings). Drop second occurrences whose text matches and
 * whose frame sits on the same spot.
 */
export function dedupeLines<T extends FramedLine>(lines: T[]): T[] {
  const kept: T[] = [];
  for (const line of lines) {
    const text = normalizeLineText(line.text);
    if (!text) continue;
    const duplicateOfExisting = kept.some(
      (other) =>
        normalizeLineText(other.text) === text &&
        line.frame &&
        other.frame &&
        centersClose(line.frame, other.frame)
    );
    if (!duplicateOfExisting) kept.push({ ...line, text });
  }
  return kept;
}

interface Row {
  lines: Array<FramedLine & { frame: LineFrame }>;
  top: number;
  bottom: number;
}

function groupIntoRows(
  lines: Array<FramedLine & { frame: LineFrame }>
): Row[] {
  const sorted = [...lines].sort(
    (a, b) =>
      a.frame.top - b.frame.top || a.frame.left - b.frame.left
  );
  const rows: Row[] = [];

  for (const line of sorted) {
    const top = line.frame.top;
    const bottom = top + line.frame.height;
    let best: Row | null = null;
    let bestRatio = 0;
    for (const row of rows) {
      const ratio = verticalOverlapRatio(top, bottom, row.top, row.bottom);
      if (ratio > bestRatio) {
        bestRatio = ratio;
        best = row;
      }
    }
    if (best && bestRatio >= ROW_OVERLAP_RATIO) {
      best.lines.push(line);
      best.top = Math.min(best.top, top);
      best.bottom = Math.max(best.bottom, bottom);
    } else {
      rows.push({ lines: [line], top, bottom });
    }
  }

  rows.sort((a, b) => a.top - b.top);
  return rows;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Stitches the fragments of one visual row into display line(s).
 * Fragments separated by a wide horizontal gap come from separate label
 * columns/panels; each group of contiguous fragments becomes its own line.
 */
export function stitchRow(
  row: Array<FramedLine & { frame: LineFrame }>
): string[] {
  if (row.length === 0) return [];
  const fragments = [...row].sort(
    (a, b) => a.frame.left - b.frame.left
  );
  const lineHeight =
    median(row.map((line) => line.frame.height)) || 1;

  const groups: Array<Array<FramedLine & { frame: LineFrame }>> = [];
  for (const fragment of fragments) {
    const previousGroup = groups[groups.length - 1];
    if (previousGroup) {
      const previous = previousGroup[previousGroup.length - 1];
      const gap =
        fragment.frame.left - (previous.frame.left + previous.frame.width);
      if (gap < COLUMN_GAP_FACTOR * lineHeight) {
        previousGroup.push(fragment);
        continue;
      }
    }
    groups.push([fragment]);
  }

  return groups
    .map((group) => group.map((line) => line.text).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * Rebuilds the label text's reading order from ML Kit line frames.
 *
 * When (almost) no lines carry frames, recognition order is preserved — it is
 * still better than trusting an unusable geometry. Line text is whitespace-
 * normalized; stitched rows become single display lines.
 */
export function reconstructReadingOrder(input: FramedLine[]): string[] {
  const cleaned = input
    .map((line) => ({ text: normalizeLineText(line.text), frame: line.frame ?? null }))
    .filter((line) => line.text.length > 0);
  if (cleaned.length === 0) return [];

  const framed = cleaned.filter(hasUsableFrame);
  const unframed = cleaned.filter((line) => !hasUsableFrame(line));

  // Without enough geometry to trust, keep the recognizer's own ordering.
  if (framed.length < 2 || framed.length < cleaned.length / 2) {
    return cleaned.map((line) => line.text);
  }

  const rows = groupIntoRows(dedupeLines(framed));
  const ordered = rows.flatMap((row) => stitchRow(row.lines));

  // Rare unframed leftovers keep their recognition order at the end.
  return [...ordered, ...unframed.map((line) => line.text)];
}

interface TextRegion {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

/** Padding around the detected text region, as a fraction of each edge. */
const REGION_MARGIN_FRACTION = 0.1;

/**
 * Computes the crop rectangle that tightly contains every line frame, with
 * a small safety margin. Returns null when cropping is pointless (no frames
 * or the region already covers most of the image).
 */
export function computeTextRegion(
  frames: readonly LineFrame[],
  imageWidth: number,
  imageHeight: number
): TextRegion | null {
  if (imageWidth <= 0 || imageHeight <= 0) return null;
  const usable = frames.filter((f) => f.width > 0 && f.height > 0);
  if (usable.length === 0) return null;

  const left = Math.min(...usable.map((f) => f.left));
  const top = Math.min(...usable.map((f) => f.top));
  const right = Math.max(...usable.map((f) => f.left + f.width));
  const bottom = Math.max(...usable.map((f) => f.top + f.height));

  const marginX = (right - left) * REGION_MARGIN_FRACTION;
  const marginY = (bottom - top) * REGION_MARGIN_FRACTION;
  const originX = Math.max(0, Math.floor(left - marginX));
  const originY = Math.max(0, Math.floor(top - marginY));
  const width = Math.min(imageWidth - originX, Math.ceil(right + marginX) - originX);
  const height = Math.min(imageHeight - originY, Math.ceil(bottom + marginY) - originY);

  if (width <= 0 || height <= 0) return null;
  // Cropping only pays off when it meaningfully reduces the picture.
  if (width >= imageWidth * 0.85 && height >= imageHeight * 0.85) return null;

  return { originX, originY, width, height };
}
