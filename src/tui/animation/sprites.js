const SPRITE_W = 5;
const SPRITE_H = 3;

const SEQUENCE_NAMES = [
  'entering',
  'walk-right',
  'walk-left',
  'walk-up',
  'walk-down',
  'run',
  'sit-type',
  'think',
  'pour-coffee',
  'sip',
  'return-with-cup',
  'wave-leave',
  'leave-run',
];

const POSES = {
  idle: [
    ['  o  ', ' /|  ', ' / \\ '],
    ['  o  ', '  |\\ ', ' / \\ '],
  ],
  thinking: [
    [' o?  ', ' /|  ', ' / \\ '],
    ['  o? ', '  |\\ ', ' / \\ '],
  ],
  walk: {
    right: [
      ['  o> ', ' /|  ', " /'  "],
      ['  o  ', ' /|> ', '  \\  '],
      ['  o> ', ' /|  ', "  '\\ "],
      ['  o  ', ' /|> ', ' /   '],
    ],
    left: [
      [' <o  ', '  |\\ ', "  '\\ "],
      ['  o  ', '<|\\ ', '  /  '],
      [' <o  ', '  |\\ ', " /'  "],
      ['  o  ', '<|\\ ', '   \\ '],
    ],
    down: [
      ['  o  ', ' /|\\ ', ' / \\ '],
      ['  o  ', ' /|  ', ' / > '],
      ['  o) ', ' /|\\ ', '  \\  '],
      ['  o  ', '  |\\ ', '< \\ '],
    ],
    up: [
      ['  o  ', ' /|\\ ', ' / \\ '],
      [' (o  ', '  |\\ ', ' / > '],
      ['  o  ', ' /|\\ ', '  \\  '],
      ['  o  ', ' /|  ', '< \\ '],
    ],
  },
  run: {
    right: [
      ['  o> ', '/|)  ', "/  \\ "],
      ['  o> ', ' /|> ', "/'   "],
      ['  o) ', '/|   ', "  '\\ "],
      ['  o> ', ' /|> ', ' /   '],
    ],
    left: [
      [' <o  ', ' (|\\ ', " /  \\"],
      [' <o  ', '<|\\ ', "   '\\"],
      [' (o  ', '  |\\ ', " /'  "],
      [' <o  ', '<|\\ ', '   \\ '],
    ],
    down: [
      ['  o) ', '/|\\  ', "/  \\ "],
      ['  o  ', ' /|> ', "/'   "],
      [' (o  ', ' /|\\ ', "  '\\"],
      ['  o  ', '<|\\ ', ' /   '],
    ],
    up: [
      [' (o  ', ' /|\\ ', "/  \\ "],
      ['  o  ', '<|\\ ', "/'   "],
      ['  o) ', ' /|\\ ', "  '\\"],
      ['  o  ', ' /|> ', ' /   '],
    ],
  },
  sitType: [
    ['  o  ', ' /|_ ', ' _/  '],
    ['  o  ', ' _|\\ ', ' _/  '],
    ['  o  ', ' /|. ', ' _/  '],
    ['  o  ', ' _|\\ ', ' _/  '],
  ],
  pourCoffee: [
    [' oc  ', ' /|  ', ' / \\ '],
    [' oC  ', ' /|  ', ' / \\ '],
    [' oc  ', ' /|. ', ' / \\ '],
    ['  o  ', ' /|c ', ' / \\ '],
  ],
  sip: [
    [' oU  ', ' /|  ', ' / \\ '],
    [' ou  ', ' /|  ', ' / \\ '],
    ['  o  ', ' /|U ', ' / \\ '],
    [' oU  ', ' /|  ', ' / \\ '],
  ],
  returnCup: {
    right: [
      [' oc> ', ' /|  ', " /'  "],
      [' oc  ', ' /|> ', '  \\  '],
      [' oc> ', ' /|  ', "  '\\"],
      [' oc  ', ' /|> ', ' /   '],
    ],
    left: [
      [' <co ', '  |\\ ', "  '\\"],
      ['  co ', '<|\\ ', '  /  '],
      [' <co ', '  |\\ ', " /'  "],
      ['  co ', '<|\\ ', '   \\ '],
    ],
    down: [
      [' oc  ', ' /|\\ ', ' / \\ '],
      [' oc  ', ' /|  ', ' / > '],
      [' oc) ', ' /|\\ ', '  \\  '],
      [' oc  ', '  |\\ ', '< \\ '],
    ],
    up: [
      [' co  ', ' /|\\ ', ' / \\ '],
      ['(co  ', '  |\\ ', ' / > '],
      [' co  ', ' /|\\ ', '  \\  '],
      [' co  ', ' /|  ', '< \\ '],
    ],
  },
  waveLeave: [
    [' o\\  ', ' /|  ', ' / \\ '],
    [' o/  ', ' /|  ', ' / \\ '],
    [' o\\  ', ' /|  ', ' / \\ '],
    ['  o  ', ' /|  ', ' / \\ '],
  ],
  spawn: [
    ['     ', '  o  ', '     '],
    ['  o  ', '     ', ' / \\ '],
    ['  o  ', ' /|  ', ' / \\ '],
  ],
};

function spriteFor(animated, now) {
  const action = animated.action;
  const actionElapsed = Math.max(0, now - (animated.actionStartedAt ?? now));
  const direction = animated.direction || 'right';

  if (action === 'working') {
    const workLoop = actionElapsed % 8800;
    if (workLoop > 6100 && workLoop < 7350) {
      return frameFrom(POSES.thinking, animated.actionStartedAt + 6100, now, 1250);
    }
    return frameFrom(POSES.sitType, animated.actionStartedAt, now, 820);
  }
  if (action === 'coffee') {
    if (actionElapsed < 760) {
      return frameFrom(POSES.pourCoffee, animated.actionStartedAt, now, 760);
    }
    return frameFrom(POSES.sip, animated.actionStartedAt + 760, now, 1200);
  }
  if (action === 'thinking') {
    return frameFrom(POSES.thinking, animated.actionStartedAt, now, 1400);
  }
  if (action === 'leaving') {
    if (actionElapsed < 520) {
      return frameFrom(POSES.waveLeave, animated.actionStartedAt, now, 520);
    }
    return frameFrom(POSES.run[direction] || POSES.run.right, animated.actionStartedAt + 520, now, 520);
  }
  if (action === 'entering' && actionElapsed < 360) {
    return frameFrom(POSES.spawn, animated.actionStartedAt, now, 360);
  }
  if (action === 'toBreak') {
    return frameFrom(POSES.walk[direction] || POSES.walk.right, animated.routeStartedAt, now, 620);
  }
  if (action === 'returning') {
    return frameFrom(POSES.returnCup[direction] || POSES.returnCup.right, animated.routeStartedAt, now, 620);
  }
  return frameFrom(POSES.run[direction] || POSES.run.right, animated.routeStartedAt, now, 560);
}

function frameFrom(frames, startedAt, now, cycleMs) {
  const elapsed = Math.max(0, now - (startedAt ?? now));
  const frameIndex = Math.floor((elapsed % cycleMs) / (cycleMs / frames.length));
  return normalizeSprite(frames[frameIndex] || frames[0]);
}

function normalizeSprite(lines) {
  return lines.map((line) => String(line).padEnd(SPRITE_W, ' ').slice(0, SPRITE_W));
}

function spriteSize() {
  return { width: SPRITE_W, height: SPRITE_H };
}

function sequenceNames() {
  return SEQUENCE_NAMES.slice();
}

module.exports = {
  sequenceNames,
  spriteFor,
  spriteSize,
};
