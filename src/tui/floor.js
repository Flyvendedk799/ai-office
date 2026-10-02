// A character-cell scene, authored in layers. Geometry also drives pathfinding.
const MAP_W = 88;
const MAP_H = 23;
const MAP = Array.from({ length: MAP_H }, () => Array(MAP_W).fill('.'));
function put(x, y, text) { Array.from(text).forEach((ch, i) => { MAP[y][x + i] = ch; }); }
function box(x, y, w, h) {
  put(x, y, `┌${'─'.repeat(w - 2)}┐`);
  for (let row = y + 1; row < y + h - 1; row++) { put(x, row, '│'); put(x + w - 1, row, '│'); }
  put(x, y + h - 1, `└${'─'.repeat(w - 2)}┘`);
}
put(0, 0, `╔${'═'.repeat(MAP_W - 2)}╗`);
put(0, MAP_H - 1, `╚${'═'.repeat(MAP_W - 2)}╝`);
for (let y = 1; y < MAP_H - 1; y++) { put(0, y, '║'); put(MAP_W - 1, y, '║'); }
put(78, 0, '╡kkkkk╞');
const WINDOWS = [5, 24, 43, 62].map((x) => ({ x: x + 1, y: 2, width: 13 }));
for (const window of WINDOWS) {
  box(window.x - 1, 1, window.width + 2, 3);
  put(window.x, 2, 'w'.repeat(window.width));
}
const SEATS = [];
const MONITORS = [];
for (const y of [5, 10, 15]) {
  for (const x of y === 15 ? [5, 20] : [5, 20, 35, 50, 65]) {
    put(x + 3, y, '┌─────┐');
    put(x + 3, y + 1, '└──┬──┘');
    put(x, y + 2, '▬▬▬▬▬▬▬▬▬▬▬▬▬');
    put(x + 6, y + 3, 'n');
    SEATS.push({ x: x + 6, y: y + 3 });
    MONITORS.push({ x: x + 4, y, seatIndex: SEATS.length - 1 });
  }
}
box(47, 15, 39, 6);
put(47, 18, '+'); put(47, 19, '+');
put(53, 17, '▣');
put(52, 18, '└─┘');
put(64, 18, '~~~~~~~~~~');
put(76, 17, '❀'); put(76, 18, '╧');
put(35, 17, '┌─┬─┬─┐'); put(35, 18, '│▥│▥│▥│'); put(35, 19, '└─┴─┴─┘');
box(81, 5, 5, 6);
for (const y of [6, 7, 8, 9]) put(82, y, 'r──');
for (const [x, y] of [[2, 5], [2, 11], [83, 12], [2, 16]]) { put(x, y, '❀'); put(x, y + 1, '╧'); }
put(0, 18, '+'); put(0, 19, '+');

module.exports = { MAP, MAP_H, MAP_W, SEATS, WINDOWS, MONITORS };
