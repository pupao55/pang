/**
 * Simple moving average. Returns an array the same length as `values`.
 * Indices [0, period - 2] are filled with NaN so callers can detect warm-up.
 */
export function calculateMA(values: number[], period: number): number[] {
  if (period <= 0) throw new Error("period must be > 0");
  const out: number[] = new Array(values.length).fill(NaN);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  out[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    sum += values[i] - values[i - period];
    out[i] = sum / period;
  }
  return out;
}
