import { describe, it, expect } from '@jest/globals';
import {
  FramedLine,
  LineFrame,
  computeTextRegion,
  dedupeLines,
  reconstructReadingOrder,
} from '../src/services/ocrTextGeometry';

function frame(
  left: number,
  top: number,
  width: number,
  height: number
): LineFrame {
  return { left, top, width, height };
}

function line(text: string, f?: LineFrame): FramedLine {
  return { text, frame: f ?? null };
}

describe('OCR text geometry - reading order reconstruction', () => {
  it('orders detection-order-jumbled blocks into visual reading order', () => {
    // ML Kit emitted the bottom line first, then the top; frames fix it.
    const recognition = [
      line('Batch No: DEMO-MF0426', frame(0, 60, 180, 16)),
      line('Metformin 500mg Tablets BP', frame(0, 0, 220, 18)),
      line('Exp: 12/2027', frame(0, 90, 120, 15)),
    ];

    expect(reconstructReadingOrder(recognition)).toEqual([
      'Metformin 500mg Tablets BP',
      'Batch No: DEMO-MF0426',
      'Exp: 12/2027',
    ]);
  });

  it('stitches fragments that belong to one visual row into a single line', () => {
    const recognition = [
      // One physical line detected as two right/left fragments.
      line('500mg', frame(160, 0, 60, 18)),
      line('Metformin', frame(0, 1, 150, 18)),
      line('Batch: DEMO-0001', frame(0, 40, 180, 16)),
    ];

    expect(reconstructReadingOrder(recognition)).toEqual([
      'Metformin 500mg',
      'Batch: DEMO-0001',
    ]);
  });

  it('splits wide column gaps on the same row into separate lines', () => {
    const recognition = [
      // Left panel text and right panel text share a visual row (largish
      // documents) but are separate label columns.
      line('per tablet', frame(20, 0, 90, 14)),
      line('Keep out of reach of children', frame(480, 0, 260, 14)),
      line('Metformin 500mg', frame(0, 30, 150, 16)),
    ];

    expect(reconstructReadingOrder(recognition)).toEqual([
      'per tablet',
      'Keep out of reach of children',
      'Metformin 500mg',
    ]);
  });

  it('drops duplicate detections of the same physical line', () => {
    const recognition = [
      line('Metformin 500mg', frame(0, 0, 150, 16)),
      // Re-emitted under an overlapping grouping at the same spot.
      line('Metformin 500mg', frame(2, 1, 150, 16)),
    ];

    expect(reconstructReadingOrder(recognition)).toEqual(['Metformin 500mg']);
  });

  it('preserves recognition order when no frames are available', () => {
    const recognition = [
      line('Metformin 500mg Tablets BP'),
      line('Batch: DEMO-MF0426'),
    ];

    expect(reconstructReadingOrder(recognition)).toEqual([
      'Metformin 500mg Tablets BP',
      'Batch: DEMO-MF0426',
    ]);
  });

  it('normalizes messy whitespace and drops empty lines', () => {
    const recognition = [
      line('  Metformin   500mg\tTablets  '),
      line('   '),
      line('Exp: 12/2027', frame(0, 20, 120, 15)),
    ];

    expect(reconstructReadingOrder(recognition)).toEqual([
      'Metformin 500mg Tablets',
      'Exp: 12/2027',
    ]);
  });

  it('orders framed lines and appends stray unframed ones at the end', () => {
    const recognition = [
      line('Last detected', frame(0, 30, 120, 16)),
      line('Unframed middle'),
      line('First detected', frame(0, 0, 100, 16)),
    ];

    expect(reconstructReadingOrder(recognition)).toEqual([
      'First detected',
      'Last detected',
      'Unframed middle',
    ]);
  });
});

describe('OCR text geometry - helpers', () => {
  it('dedupeLines keeps distinct lines and drops same-spot repeats', () => {
    const kept = dedupeLines([
      line('Batch: A', frame(0, 0, 100, 14)),
      line('Batch: A', frame(1, 1, 100, 14)),
      line('Batch: B', frame(0, 40, 100, 14)),
    ]);
    expect(kept.map((l) => l.text)).toEqual(['Batch: A', 'Batch: B']);
  });

  it('computeTextRegion boxes the text with margin and skips full-frame crops', () => {
    const region = computeTextRegion(
      [frame(100, 50, 60, 14), frame(200, 90, 80, 14)],
      1000,
      2000
    );
    // Text box 100..280 × 50..104 with a 10% margin per edge.
    expect(region).toEqual({ originX: 82, originY: 44, width: 216, height: 66 });

    // Text covering almost the whole photo offers nothing to crop.
    const useless = computeTextRegion(
      [frame(0, 0, 990, 1990), frame(10, 10, 970, 1960)],
      1000,
      2000
    );
    expect(useless).toBeNull();

    expect(computeTextRegion([], 1000, 1000)).toBeNull();
  });
});
