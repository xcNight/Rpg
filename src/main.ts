// 進入點：負責輸入、遊戲迴圈與介面文字。
import { createGame, Game, H, orderMove, update, VILLAGER_STATS, W } from './game/sim';
import { render, TILE } from './render';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
canvas.width = W * TILE;
canvas.height = H * TILE;

const $ = (id: string) => document.getElementById(id)!;
const elTime = $('time');
const elBell = $('bell');
const elKills = $('kills');
const elRoster = $('roster');
const elOverlay = $('overlay');
const elResult = $('result');
const btnPause = $('pause');
const btnSpeed = $('speed');

let game: Game = createGame(Date.now());
let selected: number | null = null;
let paused = false;
let speed = 1;

function restart() {
  game = createGame(Date.now());
  selected = null;
  paused = false;
  elOverlay.hidden = true;
  syncButtons();
}

function syncButtons() {
  btnPause.textContent = paused ? '▶ 繼續' : '⏸ 暫停';
  btnSpeed.textContent = `速度 ×${speed}`;
}

function togglePause() {
  paused = !paused;
  syncButtons();
}

canvas.addEventListener('pointerdown', (ev) => {
  if (game.phase !== 'night') return;
  const rect = canvas.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / rect.width) * W;
  const y = ((ev.clientY - rect.top) / rect.height) * H;
  // 點到鎮民就選取，否則命令已選取的鎮民移動
  const hit = game.villagers.find((v) => v.alive && Math.hypot(v.x - x, v.y - y) < 0.6);
  if (hit) selected = hit.id;
  else if (selected !== null) orderMove(game, selected, Math.floor(x), Math.floor(y));
});

window.addEventListener('keydown', (ev) => {
  if (ev.code === 'Space') {
    ev.preventDefault();
    togglePause();
  } else if (ev.key >= '1' && ev.key <= '9') {
    const v = game.villagers[Number(ev.key) - 1];
    if (v?.alive) selected = v.id;
  }
});

btnPause.addEventListener('click', togglePause);
btnSpeed.addEventListener('click', () => {
  speed = speed === 1 ? 2 : 1;
  syncButtons();
});
$('restart').addEventListener('click', restart);
$('again').addEventListener('click', restart);

function updateHud() {
  const left = Math.max(0, game.nightLength - game.time);
  elTime.textContent = `距離黎明 ${Math.ceil(left)} 秒`;
  elBell.textContent = `鐘樓 ${Math.ceil(game.bellHp)} / ${game.bellMaxHp}`;
  elKills.textContent = `擊殺 ${game.kills}`;
  elRoster.replaceChildren(
    ...game.villagers.map((v, i) => {
      const b = document.createElement('button');
      b.className = 'unit' + (v.id === selected ? ' sel' : '') + (v.alive ? '' : ' dead');
      b.textContent = `${i + 1} ${VILLAGER_STATS[v.kind].label} ${v.name} ${v.alive ? Math.ceil(v.hp) : '陣亡'}`;
      b.disabled = !v.alive;
      b.onclick = () => (selected = v.id);
      return b;
    }),
  );
  if (game.phase !== 'night' && elOverlay.hidden) {
    const alive = game.villagers.filter((v) => v.alive).length;
    elResult.textContent =
      game.phase === 'won'
        ? `天亮了！小鎮撐過了這一夜。存活 ${alive} 人，擊殺 ${game.kills}。`
        : `鐘樓倒下了……小鎮陷落。擊殺 ${game.kills}。`;
    elOverlay.hidden = false;
  }
}

let last = performance.now();
let hudTimer = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused) update(game, dt * speed);
  render(ctx, game, selected);
  hudTimer -= dt;
  if (hudTimer <= 0) {
    updateHud();
    hudTimer = 0.2;
  }
  requestAnimationFrame(frame);
}

syncButtons();
requestAnimationFrame(frame);
