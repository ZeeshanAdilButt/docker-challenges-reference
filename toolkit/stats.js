// Tiny helpers for measuring. Time is measured, never guessed.

/** Middle value of a list of numbers. For timing we record the median of three runs. */
export function median(values) {
  if (!values.length) throw new Error('median needs at least one number');
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Round to a number of decimals. */
export function round(value, decimals = 1) {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Run fn once and return { ms, value }. Works for sync and async functions. */
export async function timed(fn) {
  const start = process.hrtime.bigint();
  const value = await fn();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return { ms, value };
}
