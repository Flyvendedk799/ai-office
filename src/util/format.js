// Formatting helpers for resource metrics and small numeric displays.

function formatMemoryKb(kb) {
  const value = Number(kb);
  if (!Number.isFinite(value) || value <= 0) {
    return '-';
  }
  if (value < 1024) {
    return `${Math.round(value)}K`;
  }
  const mb = value / 1024;
  if (mb < 1024) {
    return `${mb >= 100 ? Math.round(mb) : mb.toFixed(mb >= 10 ? 0 : 1)}M`;
  }
  const gb = mb / 1024;
  return `${gb.toFixed(gb >= 10 ? 1 : 2)}G`;
}

function formatPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return '-';
  }
  if (num >= 100) {
    return `${Math.round(num)}%`;
  }
  if (num >= 10) {
    return `${num.toFixed(0)}%`;
  }
  return `${num.toFixed(1)}%`;
}

// Render a series of numbers as a unicode sparkline.
const SPARK_TICKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

function sparkline(values, { width } = {}) {
  const series = (Array.isArray(values) ? values : [])
    .map((value) => (Number.isFinite(Number(value)) ? Number(value) : 0));
  if (series.length === 0) {
    return '';
  }
  const trimmed = width && series.length > width ? series.slice(series.length - width) : series;
  const max = Math.max(...trimmed, 1);
  return trimmed
    .map((value) => {
      const ratio = Math.max(0, Math.min(1, value / max));
      const index = Math.round(ratio * (SPARK_TICKS.length - 1));
      return SPARK_TICKS[index];
    })
    .join('');
}

module.exports = {
  SPARK_TICKS,
  formatMemoryKb,
  formatPercent,
  sparkline,
};
