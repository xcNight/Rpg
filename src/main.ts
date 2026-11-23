// 進入點：負責輸入、遊戲迴圈與介面文字。
// 一局的流程：白天（指派工作）→ 夜晚（即時守城）→ 結算 → 下一個白天。
import { createRun, Job, JOB_INFO, JOB_ORDER, resolveDay, Run, settleNight, startNight } from './game/run';
import { BELL_MAX_HP, Game, H, orderMove, update, VILLAGER_STATS, W } from './game/sim';
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
const elDay = $('day');
const elDayInfo = $('dayInfo');
const elJobs = $('jobs');
const elJobHelp = $('jobHelp');
const elLog = $('log');
const btnAgain = $('again');
const btnPause = $('pause');
const btnSpeed = $('speed');

type Mode = 'day' | 'night';

let run: Run = createRun(Date.now());
let game: Game = startNight(run);
let mode: Mode = 'day';
// 這一夜是否已結算進 run（避免重複結算）
let settled = true;
// 畫面上顯示的夜數：結算後 run.night 已加一，但結果畫面仍屬於剛打完的那一夜
let shownNight = run.night;
let selected: number | null = null;
// 點擊目的地的短暫標記，讓觸控時看得出命令有生效
let marker: { x: number; y: number; ttl: number } | null = null;
let paused = false;
let speed = 1;

/** 進入白天：以目前名冊建立預覽畫面，並顯示工作指派面板 */
function enterDay() {
  mode = 'day';
  game = startNight(run);
  settled = true;
  shownNight = run.night;
  selected = null;
  marker = null;
  paused = false;
  elOverlay.hidden = true;
  elLog.hidden = true;
  elRoster.hidden = true;
  elDay.hidden = false;
  buildDayPanel();
  syncButtons();
  updateHud();
}

/** 按下「入夜」：結算白天的工作，然後開始夜晚戰鬥 */
function startNightFromDay() {
  const report = resolveDay(run);
  elLog.replaceChildren(
    ...[`第 ${run.night} 天的工作：`, ...(report.length ? report : ['今天沒有特別的事。'])].map((t, i) => {
      const d = document.createElement('div');
      d.textContent = t;
      if (i === 0) d.style.fontWeight = '600';
      return d;
    }),
  );
  elLog.hidden = false;

  mode = 'night';
  game = startNight(run);
  settled = false;
  shownNight = run.night;
  selected = game.villagers[0].id;
  marker = null;
  paused = false;
  elDay.hidden = true;
  elRoster.hidden = false;
  elOverlay.hidden = true;
  syncButtons();
  updateHud();
}

/** 重新開一局（回到第 1 天） */
function restart() {
  run = createRun(Date.now());
  enterDay();
}

/** 按下結果畫面的按鈕：局還在進行就進入下一個白天，否則重新開局 */
function onAgain() {
  if (run.status === 'between') enterDay();
  else restart();
}

function buildDayPanel() {
  const res = run.resources;
  elDayInfo.textContent = `木石 ${res.wood}　糧食 ${res.food}　鐵料 ${res.iron}　｜　鐘樓 ${run.bellHp} / ${BELL_MAX_HP}`;
  elJobs.replaceChildren(
    ...run.roster.map((r) => {
      const row = document.createElement('div');
      row.className = 'jobrow';
      const label = document.createElement('span');
      label.textContent = `${VILLAGER_STATS[r.kind].label} ${r.name}　血量 ${r.hp}/${r.maxHp}`;
      const sel = document.createElement('select');
      sel.setAttribute('aria-label', `${r.name} 的工作`);
      for (const job of JOB_ORDER) {
        const opt = document.createElement('option');
        opt.value = job;
        opt.textContent = JOB_INFO[job].label;
        sel.append(opt);
      }
      sel.value = run.jobs[r.id] ?? 'rest';
      sel.onchange = () => {
        run.jobs[r.id] = sel.value as Job;
      };
      row.append(label, sel);
      return row;
    }),
  );
  elJobHelp.replaceChildren(
    ...JOB_ORDER.map((job) => {
      const li = document.createElement('li');
      li.textContent = `${JOB_INFO[job].label}：${JOB_INFO[job].desc}`;
      return li;
    }),
  );
}

function syncButtons() {
  btnPause.textContent = paused ? '▶ 繼續' : '⏸ 暫停';
  btnSpeed.textContent = `速度 ×${speed}`;
  (btnPause as HTMLButtonElement).disabled = mode === 'day';
  (btnSpeed as HTMLButtonElement).disabled = mode === 'day';
}

function togglePause() {
  if (mode !== 'night') return;
  paused = !paused;
  syncButtons();
}

canvas.addEventListener('pointerdown', (ev) => {
  if (mode !== 'night' || game.phase !== 'night') return;
  const rect = canvas.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / rect.width) * W;
  const y = ((ev.clientY - rect.top) / rect.height) * H;
  ev.preventDefault();
  // 滑鼠右鍵：取消選取
  if (ev.pointerType === 'mouse' && ev.button === 2) {
    selected = null;
    return;
  }
  if (ev.pointerType === 'mouse' && ev.button !== 0) return;
  // 手指比滑鼠粗，觸控時放寬判定範圍；點到鎮民就選取（取最近的），否則命令已選取的鎮民移動
  const reach = ev.pointerType === 'mouse' ? 0.6 : 1.0;
  let hit: Game['villagers'][number] | null = null;
  let best = reach;
  for (const v of game.villagers) {
    const d = Math.hypot(v.x - x, v.y - y);
    if (v.alive && d < best) {
      hit = v;
      best = d;
    }
  }
  if (hit) {
    // 再點一次已選取的鎮民：取消選取
    selected = hit.id === selected ? null : hit.id;
  } else if (selected !== null) {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (orderMove(game, selected, tx, ty)) marker = { x: tx + 0.5, y: ty + 0.5, ttl: 0.6 };
  }
});

// 右鍵不要跳出瀏覽器選單
canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

window.addEventListener('keydown', (ev) => {
  if (mode !== 'night') return;
  if (ev.code === 'Escape') {
    selected = null;
  } else if (ev.code === 'Space') {
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
btnAgain.addEventListener('click', onAgain);
$('startNight').addEventListener('click', startNightFromDay);

function updateHud() {
  if (mode === 'day') {
    elTime.textContent = `第 ${run.night} / ${run.maxNights} 天　白天`;
    elBell.textContent = `鐘樓 ${run.bellHp} / ${BELL_MAX_HP}`;
    elKills.textContent = '';
    return;
  }
  const left = Math.max(0, game.nightLength - game.time);
  elTime.textContent = `第 ${shownNight} / ${run.maxNights} 夜　距離黎明 ${Math.ceil(left)} 秒`;
  elBell.textContent = `鐘樓 ${Math.ceil(game.bellHp)} / ${game.bellMaxHp}`;
  elKills.textContent = `擊殺 ${game.kills}`;
  elRoster.replaceChildren(
    ...game.villagers.map((v, i) => {
      const b = document.createElement('button');
      b.className = 'unit' + (v.id === selected ? ' sel' : '') + (v.alive ? '' : ' dead');
      b.textContent = `${i + 1} ${VILLAGER_STATS[v.kind].label} ${v.name} ${v.alive ? Math.ceil(v.hp) : '陣亡'}`;
      b.disabled = !v.alive;
      b.onclick = () => (selected = v.id === selected ? null : v.id);
      return b;
    }),
  );
  if (game.phase !== 'night' && !settled) {
    settled = true;
    const nightNo = run.night;
    const died = game.villagers.filter((v) => !v.alive).map((v) => v.name);
    settleNight(run, game);
    const lost = died.length > 0 ? `陣亡：${died.join('、')}。` : '無人陣亡。';
    if (run.status === 'lost') {
      elResult.textContent = `小鎮在第 ${nightNo} 夜陷落……${lost}擊殺 ${game.kills}。`;
      btnAgain.textContent = '重新開局';
    } else if (run.status === 'won') {
      elResult.textContent = `第 ${run.maxNights} 夜過去，天亮了！小鎮撐過了全部夜晚。存活 ${run.roster.length} 人。`;
      btnAgain.textContent = '重新開局';
    } else {
      elResult.textContent = `第 ${nightNo} 夜撐過了。${lost}存活 ${run.roster.length} 人，擊殺 ${game.kills}。`;
      btnAgain.textContent = `進入第 ${run.night} 天`;
    }
    elOverlay.hidden = false;
  }
}

let last = performance.now();
let hudTimer = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (mode === 'night' && !paused) update(game, dt * speed);
  render(ctx, game, selected, mode === 'day');
  if (marker) {
    marker.ttl -= dt;
    if (marker.ttl <= 0) marker = null;
    else {
      const k = marker.ttl / 0.6;
      ctx.strokeStyle = `rgba(255,255,255,${k})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(marker.x * TILE, marker.y * TILE, 8 + (1 - k) * 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
  }
  hudTimer -= dt;
  if (hudTimer <= 0) {
    updateHud();
    hudTimer = 0.2;
  }
  requestAnimationFrame(frame);
}

enterDay();
requestAnimationFrame(frame);
