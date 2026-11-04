// A small horizontal bar chart as an SVG string.
// It uses currentColor and opacity only, so it follows the page's light or dark theme.

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const fmt = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));

/**
 * barsSvg({ title, unit, bars: [{ label, value }] }) returns an SVG string.
 * The chart has a title and a text description, so a screen reader can read the numbers.
 */
export function barsSvg({ title, unit = '', bars }) {
  if (!title) throw new Error('barsSvg needs a title');
  if (!Array.isArray(bars) || bars.length === 0) throw new Error('barsSvg needs at least one bar');
  for (const b of bars) {
    if (typeof b.label !== 'string' || !Number.isFinite(b.value) || b.value < 0) {
      throw new Error(`Bad bar: ${JSON.stringify(b)}. Need a label and a number that is 0 or more.`);
    }
  }

  const width = 640;
  const rowH = 34;
  const top = 48;
  const bottom = 16;
  const longest = Math.max(...bars.map((b) => b.label.length));
  const labelW = Math.min(240, Math.max(80, longest * 8 + 12));
  const valueW = 90;
  const barX = labelW + 16;
  const barMax = width - barX - valueW - 16;
  const max = Math.max(...bars.map((b) => b.value), 0) || 1;
  const height = top + bars.length * rowH + bottom;
  const suffix = unit ? ` ${unit}` : '';
  const desc = bars.map((b) => `${b.label}: ${fmt(b.value)}${suffix}`).join('. ');

  const rows = bars
    .map((b, i) => {
      const y = top + i * rowH;
      const w = Math.max(b.value > 0 ? 2 : 0, (b.value / max) * barMax);
      return [
        `  <text x="${labelW}" y="${y + 17}" text-anchor="end" font-size="14">${esc(b.label)}</text>`,
        `  <rect x="${barX}" y="${y + 3}" width="${barMax}" height="20" rx="3" fill="currentColor" fill-opacity="0.08"/>`,
        `  <rect x="${barX}" y="${y + 3}" width="${w.toFixed(1)}" height="20" rx="3" fill="currentColor" fill-opacity="0.7"/>`,
        `  <text x="${barX + barMax + 10}" y="${y + 18}" font-size="14">${esc(fmt(b.value))}${esc(suffix)}</text>`,
      ].join('\n');
    })
    .join('\n');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="t d" font-family="system-ui, sans-serif" fill="currentColor">`,
    `  <title id="t">${esc(title)}</title>`,
    `  <desc id="d">${esc(desc)}</desc>`,
    `  <text x="0" y="24" font-size="17" font-weight="600">${esc(title)}</text>`,
    rows,
    '</svg>',
    '',
  ].join('\n');
}
