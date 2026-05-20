import type { StockDailyBar } from "@/lib/types/stock";

/**
 * On-Balance Volume. Cumulative running sum.
 * First bar starts at 0 (no prior reference).
 */
export function calculateOBV(bars: StockDailyBar[]): number[] {
  const out: number[] = new Array(bars.length).fill(0);
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].close;
    const curr = bars[i].close;
    const vol = bars[i].volume;
    if (curr > prev) out[i] = out[i - 1] + vol;
    else if (curr < prev) out[i] = out[i - 1] - vol;
    else out[i] = out[i - 1];
  }
  return out;
}
