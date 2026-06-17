function parseEtime(value) {
  const text = String(value || '').trim();
  if (!text) {
    return 0;
  }

  let days = 0;
  let rest = text;
  if (text.includes('-')) {
    const pieces = text.split('-');
    days = Number(pieces[0]) || 0;
    rest = pieces.slice(1).join('-');
  }

  const parts = rest.split(':').map((part) => Number(part));
  let hours = 0;
  let minutes = 0;
  let seconds = 0;

  if (parts.length === 3) {
    [hours, minutes, seconds] = parts;
  } else if (parts.length === 2) {
    [minutes, seconds] = parts;
  } else if (parts.length === 1) {
    [seconds] = parts;
  }

  return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

module.exports = {
  formatDuration,
  parseEtime,
};

