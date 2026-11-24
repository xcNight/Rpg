// 進入點：負責輸入、遊戲迴圈與介面文字。
// 一局的流程：白天（指派工作）→ 夜晚（即時守城）→ 結算 → 下一個白天。
import {
  BARRICADE_WOOD_COST,
  barricades,
  createRun,
  foodNeeded,
  forecast,
  Job,
  JOB_INFO,
  JOB_ORDER,
  openGaps,
  placeBarricade,
  removeBarricade,
  resolveDay,
  Run,
  settleNight,
  startNight,
} from './game/run';
import {
  BARRICADE_HP,
  BELL_MAX_HP,
  Game,
  H,
  orderMove,
  RING,
  tileLabel,
  update,
  VILLAGER_STATS,
  W,
  WALL_HP,
} from './game/sim';
import { render, TILE } from './render';
import { DISASTER_INFO, DISASTER_LIST } from './game/disaster';
import { parseRun, serializeRun } from './game/save';

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
const elDefense = $('defense');
const elForecast = $('forecast');
const elLog = $('log');
const btnAgain = $('again');
const btnPause = $('pause');
const btnSpeed = $('speed');

type Mode = 'day' | 'night';

const SAVE_KEY = 'last-night.save.v1';
const params = new URLSearchParams(location.search);
/** 測試用 ?night=N、?disaster=… 時不讀也不寫存檔，免得蓋掉真正的進度 */
const persist = !params.has('night') && !params.has('disaster');

// localStorage 可能被停用或滿了（私密瀏覽、嵌入頁面等），一律包 try/catch，失敗就當作沒有存檔
function readSave(): Run | null {
  if (!persist) return null;
  try {
    return parseRun(localStorage.getItem(SAVE_KEY));
  } catch {
    return null;
  }
}
function writeSave() {
  if (!persist || run.status !== 'between') return;
  try {
    localStorage.setItem(SAVE_KEY, serializeRun(run));
  } catch {
    /* 存不了就算了，遊戲照常進行 */
  }
}
function clearSave() {
  if (!persist) return;
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* 同上 */
  }
}

/**
 * 新開一局。測試用：網址加 ?night=7 可直接從指定夜數開始（例如測首領戰），
 * ?disaster=wolves（undead／wolves／siege）可指定災厄。
 */
function newRun(): Run {
  const r = createRun(Date.now());
  const d = params.get('disaster');
  if (DISASTER_LIST.includes(d as never)) r.disaster = d as typeof r.disaster;
  const n = Number(params.get('night'));
  if (Number.isInteger(n) && n >= 1 && n <= r.maxNights) r.night = n;
  return r;
}

const resumedRun = readSave();
let run: Run = resumedRun ?? newRun();
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
  run.nightStarted = false;
  writeSave();
  buildDayPanel();
  syncButtons();
  updateHud();
}

/** 在白天面板上方顯示一段文字（第一行粗體） */
function setLog(lines: string[]) {
  elLog.replaceChildren(
    ...lines.map((t, i) => {
      const d = document.createElement('div');
      d.textContent = t;
      if (i === 0) d.style.fontWeight = '600';
      return d;
    }),
  );
  elLog.hidden = false;
}

/** 按下「入夜」：結算白天的工作並存檔（之後白天的選擇就不能反悔），然後開始夜晚戰鬥 */
function startNightFromDay() {
  const report = resolveDay(run);
  setLog([`第 ${run.night} 天的工作：`, ...(report.length ? report : ['今天沒有特別的事。'])]);
  run.nightStarted = true;
  writeSave();
  launchNight();
}

/** 以目前的局狀態開始夜晚戰鬥（白天已結算）。從存檔接續時也走這裡 */
function launchNight() {
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
  clearSave();
  run = newRun();
  enterDay();
}

/** 按下結果畫面的按鈕：局還在進行就進入下一個白天，否則重新開局 */
function onAgain() {
  if (run.status === 'between') enterDay();
  else restart();
}

/** 資源與晚餐預告。工作安排改變時也會重算（搜刮平均每人帶回約 2 糧食） */
function refreshDayInfo() {
  const res = run.resources;
  const need = foodNeeded(run);
  const scavengers = run.roster.filter((r) => run.jobs[r.id] === 'scavenge').length;
  const line1 = document.createElement('div');
  line1.textContent = `木石 ${res.wood}　糧食 ${res.food}　鐵料 ${res.iron}　｜　鐘樓 ${run.bellHp} / ${BELL_MAX_HP}`;
  const line2 = document.createElement('div');
  const expected = res.food + scavengers * 2;
  line2.textContent = `今晚晚餐需糧食 ${need}（已安排 ${scavengers} 人搜刮，預估約有 ${expected}）`;
  if (expected < need) {
    line2.textContent += ' ⚠ 恐怕不夠，會有人挨餓';
    line2.style.color = 'var(--warn)';
    line2.style.fontWeight = '600';
  }
  elDayInfo.replaceChildren(line1, line2);
}

const SIDE_NAME = { west: '西', east: '東', south: '南', north: '北' } as const;

/** 今晚預告：來襲方向、強度、是否有首領 */
function buildForecast() {
  const cfg = forecast(run);
  const info = DISASTER_INFO[cfg.disaster];
  const pct = (m: number) => `${Math.round(m * 100)}%`;
  const l0 = document.createElement('div');
  l0.textContent = `本局災厄：${info.label}（${info.enemyName}）。${info.desc}`;
  l0.style.fontWeight = '600';
  const l1 = document.createElement('div');
  l1.textContent = `今晚敵人來自：${cfg.sides.map((s) => SIDE_NAME[s]).join('、')}（畫面紅色區域）`;
  const l2 = document.createElement('div');
  l2.textContent = `敵人強度：血量 ${pct(cfg.hpMul)}、攻擊 ${pct(cfg.powerMul)}、速度 ${pct(cfg.speedMul)}`;
  const parts: HTMLElement[] = [l0, l1, l2];
  if (cfg.boss) {
    const l3 = document.createElement('div');
    l3.className = 'warn';
    l3.textContent = `⚠ 最後一夜：首領「${info.bossName}」將在入夜 15 秒後現身。擊殺它就能提前天亮。`;
    parts.push(l3);
  }
  elForecast.className = cfg.boss ? 'boss' : '';
  elForecast.replaceChildren(...parts);
}

/** 城防面板：列出開著的缺口（可封堵）與現有路障（可拆除），並摘要城牆受損情況 */
function buildDefensePanel() {
  const rows: HTMLElement[] = [];
  const row = (text: string, btn?: HTMLButtonElement) => {
    const d = document.createElement('div');
    d.className = 'jobrow';
    const span = document.createElement('span');
    span.textContent = text;
    d.append(span);
    if (btn) d.append(btn);
    rows.push(d);
  };
  const button = (text: string, disabled: boolean, onclick: () => void) => {
    const b = document.createElement('button');
    b.textContent = text;
    b.disabled = disabled;
    b.onclick = () => {
      onclick();
      writeSave();
      // 重建預覽畫面與面板，讓木石與地圖立刻反映
      game = startNight(run);
      buildDayPanel();
    };
    return b;
  };

  for (const i of barricades(run)) {
    row(
      `${tileLabel(i)}：路障 ${run.defense.hp[i]}/${BARRICADE_HP}`,
      button('拆除', false, () => removeBarricade(run, i)),
    );
  }
  const canPlace = run.resources.wood >= BARRICADE_WOOD_COST;
  for (const i of openGaps(run)) {
    row(
      `${tileLabel(i)}：開著`,
      button(`封堵（木石 ${BARRICADE_WOOD_COST}）`, !canPlace, () => placeBarricade(run, i)),
    );
  }

  const damaged = RING.filter((i) => run.defense.tiles[i] === 1 && run.defense.hp[i] < WALL_HP);
  if (damaged.length > 0) {
    const lowest = Math.min(...damaged.map((i) => run.defense.hp[i]));
    row(`城牆受損 ${damaged.length} 段（最低 ${lowest}/${WALL_HP}），安排「修築」可修復`);
  }
  elDefense.replaceChildren(...rows);
}

function buildDayPanel() {
  refreshDayInfo();
  buildForecast();
  buildDefensePanel();
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
        refreshDayInfo();
        writeSave();
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
  const boss = game.enemies.find((e) => e.kind === 'boss');
  elKills.textContent = boss
    ? `擊殺 ${game.kills}　首領 ${Math.ceil(boss.hp)} / ${boss.maxHp}`
    : `擊殺 ${game.kills}`;
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
    const earlyDawn = game.bossSpawned && game.time < game.nightLength;
    settleNight(run, game);
    if (run.status === 'between') {
      // 夜晚一結束就存下一天，在結算畫面重新整理也不能把這一夜重打一次
      writeSave();
      const lost =
        (died.length > 0 ? `陣亡：${died.join('、')}。` : '無人陣亡。') +
        (game.breaches > 0 ? `城防被破壞 ${game.breaches} 處。` : '');
      elResult.textContent = `第 ${nightNo} 夜撐過了。${lost}存活 ${run.roster.length} 人，擊殺 ${game.kills}。`;
      btnAgain.textContent = `進入第 ${run.night} 天`;
    } else {
      clearSave();
      showEnding(nightNo, earlyDawn);
      btnAgain.textContent = '重新開局';
    }
    elOverlay.hidden = false;
  }
}

/** 局終畫面：結果與整局統計 */
function showEnding(nightNo: number, earlyDawn: boolean) {
  const won = run.status === 'won';
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = won
    ? earlyDawn
      ? `${DISASTER_INFO[run.disaster].bossName}倒下了，敵人潰散！`
      : '天亮了！小鎮撐過了全部夜晚'
    : `小鎮在第 ${nightNo} 夜陷落……`;
  const survivedNights = won ? run.maxNights : nightNo - 1;
  const names = (xs: string[]) => (xs.length > 0 ? xs.join('、') : '無');
  const rows: [string, string][] = [
    ['撐過的夜晚', `${survivedNights} / ${run.maxNights}`],
    ['存活鎮民', names(run.roster.map((r) => r.name))],
    ['陣亡鎮民', names(run.fallen.map((f) => `${f.name}（第 ${f.night} 夜）`))],
    ['累計擊殺', `${run.kills}`],
    ['城防被破壞', `${run.breaches} 處`],
  ];
  const list = document.createElement('div');
  list.className = 'stats';
  for (const [k, v] of rows) {
    const d = document.createElement('div');
    d.textContent = `${k}：${v}`;
    list.append(d);
  }
  elResult.replaceChildren(title, list);
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

if (resumedRun && run.nightStarted) {
  // 夜晚打到一半關掉頁面：回到這一夜的開頭（敵人相同，指揮要重來）
  setLog([`已從存檔接續：第 ${run.night} 夜重新開始。`]);
  launchNight();
} else {
  enterDay();
  if (resumedRun) setLog([`已從存檔接續第 ${run.night} 天。想重打可按「重新開始」。`]);
}
requestAnimationFrame(frame);
