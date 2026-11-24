// 《最後一夜》遊戲邏輯：純資料與純函式，不依賴畫面，方便測試。
// 座標單位為「格」，單位位置是連續值（即時制），地圖本身是格子。

import { Disaster, DISASTER_INFO, RAM_STATS } from './disaster';

export const W = 20;
export const H = 15;

/** 0 地面、1 城牆、2 鐘樓、3 房屋、4 路障（封堵缺口用，比城牆脆弱） */
export type Tile = 0 | 1 | 2 | 3 | 4;
export type VillagerKind = 'militia' | 'archer' | 'healer';
export type Phase = 'night' | 'won' | 'lost';
export type Side = 'west' | 'east' | 'south' | 'north';
/** grunt：該災厄的普通敵人；ram：攻城槌；boss：首領 */
export type EnemyKind = 'grunt' | 'ram' | 'boss';

/** 每一夜的難度設定。倍率相對於基礎敵人 */
export interface NightConfig {
  disaster: Disaster;
  night: number;
  maxNights: number;
  /** 敵人出現的方向 */
  sides: Side[];
  hpMul: number;
  powerMul: number;
  speedMul: number;
  /** 出怪間隔倍率，越大出得越慢 */
  spawnScale: number;
  aggroMul: number;
  /** 普通敵人對城牆與路障的傷害倍率 */
  structMul: number;
  /** 每次出怪是攻城槌的機率 */
  ramChance: number;
  /** 是否有首領（擊殺首領即可提前結束這一夜） */
  boss: boolean;
}

/** 沒有特別指定時使用：基礎敵人、三個方向、沒有首領 */
export const NEUTRAL_CONFIG: NightConfig = {
  disaster: 'undead',
  night: 1,
  maxNights: 1,
  sides: ['west', 'east', 'south'],
  hpMul: 1,
  powerMul: 1,
  speedMul: 1,
  spawnScale: 1,
  aggroMul: 1,
  structMul: 1,
  ramChance: 0,
  boss: false,
};

export interface Point {
  x: number;
  y: number;
}

export interface Villager extends Point {
  id: number;
  kind: VillagerKind;
  name: string;
  hp: number;
  maxHp: number;
  cd: number;
  /** 尚未走完的路徑（各格中心點） */
  path: Point[];
  /** 駐守點：民兵追擊後會回到這裡 */
  anchor: Point;
  /** 戰鬥力倍率（白天訓練的加成），1 為無加成 */
  powerMul: number;
  alive: boolean;
}

export interface Enemy extends Point {
  id: number;
  kind: EnemyKind;
  hp: number;
  maxHp: number;
  power: number;
  speed: number;
  range: number;
  /** 對城牆與路障的單次傷害 */
  structPower: number;
  /** 攻擊間隔（秒） */
  cdMax: number;
  /** 發現鎮民並轉向追擊的距離 */
  aggro: number;
  cd: number;
  /** 格內偏移，避免敵人完全重疊 */
  ox: number;
  oy: number;
  alive: boolean;
}

export interface Effect {
  kind: 'shot' | 'heal' | 'hit';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  ttl: number;
}

export interface Game {
  tiles: Tile[];
  /** 城牆與路障各格的剩餘耐久（其他格為 0） */
  structHp: number[];
  /** 每格到鐘樓的「代價」：走地面 1，破牆或破路障代價更高；走不到為 Infinity */
  flow: number[];
  villagers: Villager[];
  enemies: Enemy[];
  effects: Effect[];
  bellHp: number;
  bellMaxHp: number;
  time: number;
  nightLength: number;
  phase: Phase;
  spawnTimer: number;
  nextId: number;
  rng: number;
  kills: number;
  /** 這一夜被敵人摧毀的城牆與路障數量 */
  breaches: number;
  cfg: NightConfig;
  bossSpawned: boolean;
}

export const BELL: Point = { x: 10, y: 7 };

export const VILLAGER_STATS: Record<
  VillagerKind,
  { label: string; hp: number; power: number; range: number; cd: number; speed: number }
> = {
  militia: { label: '民兵', hp: 120, power: 14, range: 0.9, cd: 0.8, speed: 2.6 },
  archer: { label: '弓手', hp: 60, power: 12, range: 5, cd: 1.1, speed: 2.8 },
  healer: { label: '醫者', hp: 55, power: 10, range: 3.5, cd: 1.5, speed: 2.8 },
};

export const ENEMY_STATS = { hp: 40, power: 6, range: 0.8, cd: 1, speed: 1.1, aggro: 1.6 };
/** 首領在入夜後幾秒出現 */
export const BOSS_SPAWN_TIME = 15;
const GUARD_RADIUS = 2.5;

export const WALL_HP = 120;
export const BARRICADE_HP = 60;
/** 敵人尋路時，破一格城牆／路障相當於多少步路。數字越大，越傾向繞去開著的缺口 */
const WALL_COST = 12;
const BARRICADE_COST = 5;
/** 敵人與要破壞的結構相距多近時開始攻擊（格） */
const STRUCT_REACH = 1.35;

const idx = (x: number, y: number) => y * W + x;
const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const center = (tx: number, ty: number): Point => ({ x: tx + 0.5, y: ty + 0.5 });

export function tileAt(g: Game, x: number, y: number): Tile {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  return inMap(tx, ty) ? g.tiles[idx(tx, ty)] : 1;
}

export function passable(g: Game, x: number, y: number): boolean {
  return tileAt(g, x, y) === 0;
}

/** 可重現的亂數（mulberry32），狀態存在 Game 內 */
function rand(g: Game): number {
  g.rng = (g.rng + 0x6d2b79f5) | 0;
  let t = g.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function buildTiles(): Tile[] {
  const tiles: Tile[] = new Array(W * H).fill(0);
  // 城牆圍成一圈，留下西、東、南、北四個缺口
  for (let x = 5; x <= 14; x++) {
    tiles[idx(x, 3)] = 1;
    tiles[idx(x, 11)] = 1;
  }
  for (let y = 3; y <= 11; y++) {
    tiles[idx(5, y)] = 1;
    tiles[idx(14, y)] = 1;
  }
  for (const [x, y] of [
    [5, 7],
    [14, 7],
    [10, 11],
    [9, 3],
  ]) {
    tiles[idx(x, y)] = 0;
  }
  for (const [x, y] of [
    [7, 5],
    [12, 5],
    [7, 9],
    [12, 9],
  ]) {
    tiles[idx(x, y)] = 3;
  }
  tiles[idx(BELL.x, BELL.y)] = 2;
  return tiles;
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function enterCost(t: Tile): number {
  if (t === 0) return 1;
  if (t === 4) return BARRICADE_COST;
  if (t === 1) return WALL_COST;
  return Infinity; // 房屋與鐘樓不能穿越
}

/** 從鐘樓往外做最短路徑搜尋（Dijkstra），算出每格到鐘樓的代價 */
function buildFlow(tiles: Tile[]): number[] {
  const flow: number[] = new Array(W * H).fill(Infinity);
  const done: boolean[] = new Array(W * H).fill(false);
  flow[idx(BELL.x, BELL.y)] = 0;
  for (;;) {
    let cur = -1;
    for (let i = 0; i < flow.length; i++) {
      if (!done[i] && flow[i] !== Infinity && (cur === -1 || flow[i] < flow[cur])) cur = i;
    }
    if (cur === -1) break;
    done[cur] = true;
    const cx = cur % W;
    const cy = Math.floor(cur / W);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inMap(nx, ny)) continue;
      const n = idx(nx, ny);
      const c = enterCost(tiles[n]);
      if (c === Infinity) continue;
      if (flow[cur] + c < flow[n]) flow[n] = flow[cur] + c;
    }
  }
  return flow;
}

/** 城牆或路障被摧毀後，重新計算敵人的路線 */
function rebuildFlow(g: Game): void {
  g.flow = buildFlow(g.tiles);
}

/**
 * 第 night 夜的難度設定。難度從第 1 夜到最後一夜線性上升；
 * 前兩夜只有兩個來襲方向（隨機，但同一個種子固定），之後三個方向。
 * 同一個 seed 與夜數永遠得到相同設定，白天的預告才準確。
 */
export function nightConfig(
  seed: number,
  night: number,
  maxNights: number,
  disaster: Disaster = 'undead',
): NightConfig {
  const t = maxNights <= 1 ? 0 : (night - 1) / (maxNights - 1);
  const d = DISASTER_INFO[disaster];
  // 狼人群的後段夜晚連北門也會被攻擊；其他災厄只有西、東、南
  const all: Side[] = d.northSide ? ['west', 'east', 'south', 'north'] : ['west', 'east', 'south'];
  const sides = all.slice();
  if (night <= 2) {
    // 前兩夜只留兩個方向：用種子決定剔除哪些
    let h = Math.imul(seed | 0, 2654435761) ^ Math.imul(night, 40503);
    while (sides.length > 2) {
      h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
      sides.splice(h % sides.length, 1);
    }
  }
  return {
    disaster,
    night,
    maxNights,
    sides,
    hpMul: (0.85 + 0.5 * t) * d.hpMul,
    powerMul: (0.85 + 0.4 * t) * d.powerMul,
    speedMul: (0.9 + 0.2 * t) * d.speedMul,
    spawnScale: (1.4 - 0.6 * t) * d.spawnMul,
    aggroMul: d.aggroMul,
    structMul: d.structMul,
    ramChance: d.ramChance,
    boss: maxNights > 1 && night >= maxNights,
  };
}

/** 一局中跨夜保存的城防：地形與各結構的耐久 */
export interface Defense {
  tiles: Tile[];
  hp: number[];
}

export function createDefense(): Defense {
  const tiles = buildTiles();
  return { tiles, hp: tiles.map((t) => (t === 1 ? WALL_HP : 0)) };
}

/** 城牆環上的所有格子（原本的城牆與四個缺口），可封堵的位置只會出現在這裡 */
export const RING: number[] = (() => {
  const set = new Set<number>();
  for (let x = 5; x <= 14; x++) {
    set.add(idx(x, 3));
    set.add(idx(x, 11));
  }
  for (let y = 3; y <= 11; y++) {
    set.add(idx(5, y));
    set.add(idx(14, y));
  }
  // 城門排最前面（西、東、南、北），其餘城牆依位置排序，介面列表就會先出現最常被攻擊的門
  const gates = [idx(5, 7), idx(14, 7), idx(10, 11), idx(9, 3)];
  const rest = [...set].filter((i) => !gates.includes(i)).sort((x, y) => x - y);
  return [...gates, ...rest];
})();

/** 城牆環上格子的名稱，給介面與日誌使用 */
export function tileLabel(i: number): string {
  const x = i % W;
  const y = Math.floor(i / W);
  if (x === 5 && y === 7) return '西門';
  if (x === 14 && y === 7) return '東門';
  if (x === 10 && y === 11) return '南門';
  if (x === 9 && y === 3) return '北門';
  if (x === 5) return `西牆第 ${y - 2} 段`;
  if (x === 14) return `東牆第 ${y - 2} 段`;
  if (y === 3) return `北牆第 ${x - 4} 段`;
  if (y === 11) return `南牆第 ${x - 4} 段`;
  return `(${x},${y})`;
}

/** 一局中跨夜保存的鎮民資料（不含戰鬥中的位置與冷卻） */
export interface RosterEntry {
  id: number;
  kind: VillagerKind;
  name: string;
  hp: number;
  maxHp: number;
  /** 下一夜的戰鬥力倍率，沒有設定視為 1 */
  powerMul?: number;
}

export const DEFAULT_ROSTER: RosterEntry[] = [
  { id: 1, kind: 'militia', name: '葛雷', hp: 120, maxHp: 120 },
  { id: 2, kind: 'militia', name: '瑪莎', hp: 120, maxHp: 120 },
  { id: 3, kind: 'archer', name: '芬恩', hp: 60, maxHp: 60 },
  { id: 4, kind: 'healer', name: '艾琳', hp: 55, maxHp: 55 },
  { id: 5, kind: 'militia', name: '布蘭', hp: 120, maxHp: 120 },
  { id: 6, kind: 'archer', name: '莉娜', hp: 60, maxHp: 60 },
];

/** 入夜時各鎮民的起始格子（依名冊順序），名冊超過時從頭循環 */
const START_SLOTS: [number, number][] = [
  [6, 7],
  [13, 7],
  [10, 9],
  [9, 7],
  [8, 9],
  [11, 5],
];

function makeVillager(r: RosterEntry, tx: number, ty: number): Villager {
  const c = center(tx, ty);
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    x: c.x,
    y: c.y,
    hp: r.hp,
    maxHp: r.maxHp,
    cd: 0,
    path: [],
    anchor: c,
    powerMul: r.powerMul ?? 1,
    alive: true,
  };
}

export const BELL_MAX_HP = 300;

export function createGame(
  seed = 1,
  roster: RosterEntry[] = DEFAULT_ROSTER,
  bellHp: number = BELL_MAX_HP,
  defense: Defense = createDefense(),
  cfg: NightConfig = NEUTRAL_CONFIG,
): Game {
  const tiles = defense.tiles.slice();
  return {
    tiles,
    structHp: defense.hp.slice(),
    flow: buildFlow(tiles),
    villagers: roster.map((r, i) => {
      const [tx, ty] = START_SLOTS[i % START_SLOTS.length];
      return makeVillager(r, tx, ty);
    }),
    enemies: [],
    effects: [],
    bellHp: Math.min(bellHp, BELL_MAX_HP),
    bellMaxHp: BELL_MAX_HP,
    time: 0,
    nightLength: 90,
    phase: 'night',
    spawnTimer: 3,
    nextId: 100,
    rng: seed | 0,
    kills: 0,
    breaches: 0,
    cfg,
    bossSpawned: false,
  };
}

/** 以格子為單位找路，回傳各格中心點；走不到回傳 null */
export function findPath(g: Game, from: Point, tx: number, ty: number): Point[] | null {
  if (!inMap(tx, ty) || g.tiles[idx(tx, ty)] !== 0) return null;
  const sx = Math.floor(from.x);
  const sy = Math.floor(from.y);
  const start = idx(sx, sy);
  const goal = idx(tx, ty);
  const prev = new Map<number, number>([[start, -1]]);
  const queue = [start];
  for (let head = 0; head < queue.length && !prev.has(goal); head++) {
    const cur = queue[head];
    const cx = cur % W;
    const cy = Math.floor(cur / W);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inMap(nx, ny)) continue;
      const n = idx(nx, ny);
      if (g.tiles[n] !== 0 || prev.has(n)) continue;
      prev.set(n, cur);
      queue.push(n);
    }
  }
  if (!prev.has(goal)) return null;
  const path: Point[] = [];
  for (let cur = goal; cur !== start; cur = prev.get(cur)!) {
    path.push(center(cur % W, Math.floor(cur / W)));
  }
  return path.reverse();
}

/** 命令鎮民移動到指定格子，成功回傳 true */
export function orderMove(g: Game, villagerId: number, tx: number, ty: number): boolean {
  const v = g.villagers.find((u) => u.id === villagerId && u.alive);
  if (!v) return false;
  const path = findPath(g, v, tx, ty);
  if (!path) return false;
  v.path = path;
  v.anchor = center(tx, ty);
  return true;
}

/** 朝目標直線前進一步；若會走進障礙就不動。回傳是否有移動 */
function stepToward(g: Game, u: Point, target: Point, maxStep: number): boolean {
  const d = dist(u, target);
  if (d < 1e-6) return false;
  const s = Math.min(maxStep, d);
  const nx = u.x + ((target.x - u.x) / d) * s;
  const ny = u.y + ((target.y - u.y) / d) * s;
  if (!passable(g, nx, ny)) return false;
  u.x = nx;
  u.y = ny;
  return true;
}

function nearest<T extends Point & { alive: boolean }>(list: T[], from: Point, maxDist: number): T | null {
  let best: T | null = null;
  let bestD = maxDist;
  for (const u of list) {
    if (!u.alive) continue;
    const d = dist(u, from);
    if (d <= bestD) {
      best = u;
      bestD = d;
    }
  }
  return best;
}

/** 在指定位置放一個敵人（測試與出怪共用）。屬性由當夜的難度設定與災厄決定 */
export function spawnEnemyAt(g: Game, x: number, y: number, kind: EnemyKind = 'grunt'): Enemy {
  const cfg = g.cfg;
  const boss = DISASTER_INFO[cfg.disaster].boss;
  let hp: number, power: number, speed: number, range: number, cdMax: number, aggro: number, structPower: number;
  if (kind === 'boss') {
    ({ hp, power, speed, range, aggro } = boss);
    cdMax = boss.cd;
    structPower = boss.power * boss.structMul;
  } else if (kind === 'ram') {
    hp = Math.round(RAM_STATS.hp * cfg.hpMul);
    power = RAM_STATS.power;
    speed = RAM_STATS.speed * cfg.speedMul;
    range = RAM_STATS.range;
    cdMax = RAM_STATS.cd;
    aggro = RAM_STATS.aggro;
    structPower = RAM_STATS.structPower * cfg.powerMul;
  } else {
    hp = Math.round(ENEMY_STATS.hp * cfg.hpMul);
    power = ENEMY_STATS.power * cfg.powerMul;
    speed = ENEMY_STATS.speed * cfg.speedMul;
    range = ENEMY_STATS.range;
    cdMax = ENEMY_STATS.cd;
    aggro = ENEMY_STATS.aggro * cfg.aggroMul;
    structPower = power * cfg.structMul;
  }
  const ox = (rand(g) - 0.5) * 0.4;
  const oy = (rand(g) - 0.5) * 0.4;
  const e: Enemy = {
    id: g.nextId++,
    kind,
    x: x + ox,
    y: y + oy,
    hp,
    maxHp: hp,
    power,
    speed,
    range,
    cdMax,
    aggro,
    structPower,
    cd: 0,
    ox,
    oy,
    alive: true,
  };
  g.enemies.push(e);
  return e;
}

/** 從這一夜的來襲方向之一挑一個地圖邊緣的位置 */
function edgePoint(g: Game): Point {
  const side = g.cfg.sides[Math.floor(rand(g) * g.cfg.sides.length)];
  if (side === 'west') return { x: 0.5, y: 2.5 + Math.floor(rand(g) * 11) };
  if (side === 'east') return { x: W - 0.5, y: 2.5 + Math.floor(rand(g) * 11) };
  if (side === 'north') return { x: 3.5 + Math.floor(rand(g) * 13), y: 0.5 };
  return { x: 2.5 + Math.floor(rand(g) * 16), y: H - 0.5 };
}

function spawnEnemy(g: Game): void {
  const p = edgePoint(g);
  // 只有圍城軍會抽攻城槌；沒有槌子的災厄不消耗亂數，維持原本的出怪序列
  const ram = g.cfg.ramChance > 0 && rand(g) < g.cfg.ramChance;
  spawnEnemyAt(g, p.x, p.y, ram ? 'ram' : 'grunt');
}

function updateVillager(g: Game, v: Villager, dt: number): void {
  const st = VILLAGER_STATS[v.kind];
  v.cd = Math.max(0, v.cd - dt);

  // 移動：有命令就照路徑走；民兵閒置時會追擊駐守範圍內的敵人
  if (v.path.length > 0) {
    const next = v.path[0];
    const d = dist(v, next);
    const s = st.speed * dt;
    if (d <= s) {
      v.x = next.x;
      v.y = next.y;
      v.path.shift();
    } else {
      v.x += ((next.x - v.x) / d) * s;
      v.y += ((next.y - v.y) / d) * s;
    }
  } else if (v.kind === 'militia') {
    const foe = nearest(g.enemies, v.anchor, GUARD_RADIUS);
    if (foe) {
      if (dist(v, foe) > st.range * 0.8) stepToward(g, v, foe, st.speed * dt);
    } else {
      stepToward(g, v, v.anchor, st.speed * dt);
    }
  }

  if (v.cd > 0) return;
  if (v.kind === 'healer') {
    // 治療範圍內血量比例最低的受傷同伴
    let target: Villager | null = null;
    for (const u of g.villagers) {
      if (!u.alive || u.hp >= u.maxHp || dist(u, v) > st.range) continue;
      if (!target || u.hp / u.maxHp < target.hp / target.maxHp) target = u;
    }
    if (target) {
      target.hp = Math.min(target.maxHp, target.hp + st.power * v.powerMul);
      v.cd = st.cd;
      g.effects.push({ kind: 'heal', x1: v.x, y1: v.y, x2: target.x, y2: target.y, ttl: 0.3 });
    }
    return;
  }
  const foe = nearest(g.enemies, v, st.range);
  if (foe) {
    foe.hp -= st.power * v.powerMul;
    v.cd = st.cd;
    g.effects.push({
      kind: v.kind === 'archer' ? 'shot' : 'hit',
      x1: v.x,
      y1: v.y,
      x2: foe.x,
      y2: foe.y,
      ttl: 0.15,
    });
    if (foe.hp <= 0) {
      foe.alive = false;
      g.kills++;
    }
  }
}

function updateEnemy(g: Game, e: Enemy, dt: number): void {
  e.cd = Math.max(0, e.cd - dt);
  const step = e.speed * dt;

  // 附近有鎮民就優先攻擊鎮民
  const prey = nearest(g.villagers, e, e.aggro);
  if (prey) {
    if (dist(e, prey) <= e.range) {
      if (e.cd === 0) {
        prey.hp -= e.power;
        e.cd = e.cdMax;
        g.effects.push({ kind: 'hit', x1: e.x, y1: e.y, x2: prey.x, y2: prey.y, ttl: 0.15 });
        if (prey.hp <= 0) prey.alive = false;
      }
      return;
    }
    if (stepToward(g, e, prey, step)) return;
  }

  // 否則沿著流場走向鐘樓：貼著鐘樓就攻擊鐘樓
  const tx = Math.floor(e.x);
  const ty = Math.floor(e.y);
  if (DIRS.some(([dx, dy]) => inMap(tx + dx, ty + dy) && g.tiles[idx(tx + dx, ty + dy)] === 2)) {
    if (e.cd === 0) {
      g.bellHp = Math.max(0, g.bellHp - e.power);
      e.cd = e.cdMax;
      g.effects.push({ kind: 'hit', x1: e.x, y1: e.y, x2: BELL.x + 0.5, y2: BELL.y + 0.5, ttl: 0.15 });
    }
    return;
  }
  // 挑代價最低的相鄰格；若那一格是城牆或路障，就停下來把它打穿
  let best = Infinity;
  let bx = tx;
  let by = ty;
  for (const [dx, dy] of DIRS) {
    const nx = tx + dx;
    const ny = ty + dy;
    if (!inMap(nx, ny)) continue;
    const f = g.flow[idx(nx, ny)];
    if (f < best) {
      best = f;
      bx = nx;
      by = ny;
    }
  }
  if (best === Infinity) return;
  const targetTile = g.tiles[idx(bx, by)];
  const target = { x: bx + 0.5 + (targetTile === 0 ? e.ox : 0), y: by + 0.5 + (targetTile === 0 ? e.oy : 0) };
  const d = dist(e, target);
  if (targetTile === 1 || targetTile === 4) {
    if (d <= STRUCT_REACH) {
      if (e.cd === 0) attackStructure(g, e, idx(bx, by));
      return;
    }
  }
  if (d > 1e-6) {
    const s = Math.min(step, d);
    e.x += ((target.x - e.x) / d) * s;
    e.y += ((target.y - e.y) / d) * s;
  }
}

/** 敵人攻擊一格城牆或路障；耐久歸零就變成缺口並重算路線 */
function attackStructure(g: Game, e: Enemy, i: number): void {
  e.cd = e.cdMax;
  g.structHp[i] -= e.structPower;
  g.effects.push({ kind: 'hit', x1: e.x, y1: e.y, x2: (i % W) + 0.5, y2: Math.floor(i / W) + 0.5, ttl: 0.15 });
  if (g.structHp[i] <= 0) {
    g.structHp[i] = 0;
    g.tiles[i] = 0;
    g.breaches++;
    rebuildFlow(g);
  }
}

function tick(g: Game, dt: number): void {
  if (g.phase !== 'night') return;
  g.time += dt;

  // 出怪間隔隨夜晚推進，從 3.5 秒縮短到 1.5 秒，再乘上當夜的難度倍率
  g.spawnTimer -= dt;
  if (g.spawnTimer <= 0) {
    spawnEnemy(g);
    g.spawnTimer += (3.5 - 2 * Math.min(1, g.time / g.nightLength)) * g.cfg.spawnScale;
  }

  // 首領戰：固定時間點從來襲方向之一現身
  if (g.cfg.boss && !g.bossSpawned && g.time >= BOSS_SPAWN_TIME) {
    g.bossSpawned = true;
    const p = edgePoint(g);
    spawnEnemyAt(g, p.x, p.y, 'boss');
  }

  for (const v of g.villagers) if (v.alive) updateVillager(g, v, dt);
  for (const e of g.enemies) if (e.alive) updateEnemy(g, e, dt);
  g.enemies = g.enemies.filter((e) => e.alive);
  for (const fx of g.effects) fx.ttl -= dt;
  g.effects = g.effects.filter((fx) => fx.ttl > 0);

  if (g.bellHp <= 0) g.phase = 'lost';
  else if (g.time >= g.nightLength) g.phase = 'won';
  else if (g.bossSpawned && !g.enemies.some((e) => e.kind === 'boss')) {
    // 首領倒下，其餘敵人潰散，提前天亮
    g.phase = 'won';
  }
}

/** 推進遊戲時間。大的 dt 會切成小步，確保加速時結果仍穩定 */
export function update(g: Game, dt: number): void {
  const STEP = 0.05;
  let left = dt;
  while (left > 1e-9) {
    const s = Math.min(STEP, left);
    tick(g, s);
    left -= s;
  }
}
