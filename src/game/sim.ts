// 《最後一夜》遊戲邏輯：純資料與純函式，不依賴畫面，方便測試。
// 座標單位為「格」，單位位置是連續值（即時制），地圖本身是格子。

export const W = 20;
export const H = 15;

/** 0 地面、1 城牆、2 鐘樓、3 房屋 */
export type Tile = 0 | 1 | 2 | 3;
export type VillagerKind = 'militia' | 'archer' | 'healer';
export type Phase = 'night' | 'won' | 'lost';

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
  hp: number;
  maxHp: number;
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
  /** 每格到鐘樓的步數（走不到為 Infinity） */
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
const GUARD_RADIUS = 2.5;

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

/** 從鐘樓往外做廣度優先搜尋，算出每格的步數 */
function buildFlow(tiles: Tile[]): number[] {
  const flow: number[] = new Array(W * H).fill(Infinity);
  const queue: number[] = [idx(BELL.x, BELL.y)];
  flow[queue[0]] = 0;
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    const cx = cur % W;
    const cy = Math.floor(cur / W);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inMap(nx, ny)) continue;
      const n = idx(nx, ny);
      if (tiles[n] !== 0 || flow[n] !== Infinity) continue;
      flow[n] = flow[cur] + 1;
      queue.push(n);
    }
  }
  return flow;
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
): Game {
  const tiles = buildTiles();
  return {
    tiles,
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

function spawnEnemy(g: Game): void {
  const side = Math.floor(rand(g) * 3);
  let tx: number;
  let ty: number;
  if (side === 0) {
    tx = 0;
    ty = 2 + Math.floor(rand(g) * 11);
  } else if (side === 1) {
    tx = W - 1;
    ty = 2 + Math.floor(rand(g) * 11);
  } else {
    tx = 2 + Math.floor(rand(g) * 16);
    ty = H - 1;
  }
  const ox = (rand(g) - 0.5) * 0.4;
  const oy = (rand(g) - 0.5) * 0.4;
  g.enemies.push({
    id: g.nextId++,
    x: tx + 0.5 + ox,
    y: ty + 0.5 + oy,
    hp: ENEMY_STATS.hp,
    maxHp: ENEMY_STATS.hp,
    cd: 0,
    ox,
    oy,
    alive: true,
  });
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
  const step = ENEMY_STATS.speed * dt;

  // 附近有鎮民就優先攻擊鎮民
  const prey = nearest(g.villagers, e, ENEMY_STATS.aggro);
  if (prey) {
    if (dist(e, prey) <= ENEMY_STATS.range) {
      if (e.cd === 0) {
        prey.hp -= ENEMY_STATS.power;
        e.cd = ENEMY_STATS.cd;
        g.effects.push({ kind: 'hit', x1: e.x, y1: e.y, x2: prey.x, y2: prey.y, ttl: 0.15 });
        if (prey.hp <= 0) prey.alive = false;
      }
      return;
    }
    if (stepToward(g, e, prey, step)) return;
  }

  // 否則沿著流場走向鐘樓
  const tx = Math.floor(e.x);
  const ty = Math.floor(e.y);
  const here = g.flow[idx(tx, ty)];
  if (here <= 1) {
    if (e.cd === 0) {
      g.bellHp = Math.max(0, g.bellHp - ENEMY_STATS.power);
      e.cd = ENEMY_STATS.cd;
      g.effects.push({ kind: 'hit', x1: e.x, y1: e.y, x2: BELL.x + 0.5, y2: BELL.y + 0.5, ttl: 0.15 });
    }
    return;
  }
  let best = here;
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
  const target = { x: bx + 0.5 + e.ox, y: by + 0.5 + e.oy };
  const d = dist(e, target);
  if (d > 1e-6) {
    const s = Math.min(step, d);
    e.x += ((target.x - e.x) / d) * s;
    e.y += ((target.y - e.y) / d) * s;
  }
}

function tick(g: Game, dt: number): void {
  if (g.phase !== 'night') return;
  g.time += dt;

  // 出怪間隔隨夜晚推進，從 3.5 秒縮短到 1.5 秒
  g.spawnTimer -= dt;
  if (g.spawnTimer <= 0) {
    spawnEnemy(g);
    g.spawnTimer += 3.5 - 2 * Math.min(1, g.time / g.nightLength);
  }

  for (const v of g.villagers) if (v.alive) updateVillager(g, v, dt);
  for (const e of g.enemies) if (e.alive) updateEnemy(g, e, dt);
  g.enemies = g.enemies.filter((e) => e.alive);
  for (const fx of g.effects) fx.ttl -= dt;
  g.effects = g.effects.filter((fx) => fx.ttl > 0);

  if (g.bellHp <= 0) g.phase = 'lost';
  else if (g.time >= g.nightLength) g.phase = 'won';
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
