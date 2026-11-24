// 一局（Run）：跨越多個夜晚的狀態。夜晚戰鬥由 sim.ts 負責，這裡管名冊、資源與白天的工作結算。
import { Disaster, disasterFor } from './disaster';
import { BAD_TRAITS, GOOD_TRAITS, NAME_POOL, ORIGIN_INFO, ORIGIN_LIST, Origin, Trait, TRAIT_INFO } from './people';
import {
  BARRICADE_HP,
  BELL_MAX_HP,
  createDefense,
  createGame,
  Defense,
  Game,
  nightConfig,
  NightConfig,
  RING,
  RosterEntry,
  tileLabel,
  VILLAGER_STATS,
  VillagerKind,
  WALL_HP,
} from './sim';

/** between：白天配置中；won／lost：整局結束 */
export type RunStatus = 'between' | 'won' | 'lost';
export type Job = 'build' | 'scavenge' | 'train' | 'heal' | 'rest';

export interface Resources {
  wood: number;
  food: number;
  iron: number;
}

export interface Run {
  seed: number;
  /** 這一局的災厄，開局就決定 */
  disaster: Disaster;
  /** 目前（或即將進行）的第幾夜，從 1 開始 */
  night: number;
  maxNights: number;
  roster: RosterEntry[];
  resources: Resources;
  bellHp: number;
  /** 城牆與路障的狀態，跨夜保留（被破壞的地方會變成缺口） */
  defense: Defense;
  /** 今天新放的路障（格子索引）。拆除當天放的路障可退還木石 */
  placedToday: number[];
  /** 每位鎮民（id）今天的工作 */
  jobs: Record<number, Job>;
  status: RunStatus;
  /** 今晚是否已經開戰（白天已結算）。存檔時用來避免白天的選擇被重來 */
  nightStarted: boolean;
  /** 整局累計的統計，給局終畫面使用 */
  kills: number;
  breaches: number;
  fallen: { name: string; night: number }[];
}

export const JOB_INFO: Record<Job, { label: string; desc: string }> = {
  build: { label: '修築', desc: '耗木石 2，修復受損最重的結構（鐘樓、城牆、路障）40 點耐久' },
  scavenge: { label: '搜刮', desc: '帶回木石、糧食、鐵料；有 25% 機率受傷' },
  train: { label: '訓練', desc: '耗鐵料 1，下一夜戰鬥力 +25%（沒有鐵料只有 +10%）' },
  heal: { label: '治療', desc: '照料傷勢最重的同伴，回復 40 點血量' },
  rest: { label: '休息', desc: '回復自身 50% 血量' },
};
export const JOB_ORDER: Job[] = ['build', 'scavenge', 'train', 'heal', 'rest'];

export const BUILD_WOOD_COST = 2;
/** 在缺口放一座路障所需的木石 */
export const BARRICADE_WOOD_COST = 3;
export const BUILD_REPAIR = 40;
export const TRAIN_BONUS = 1.25;
export const TRAIN_BONUS_NO_IRON = 1.1;
export const TRAIN_IRON_COST = 1;
/** 衛兵出身訓練時額外的戰鬥力加成 */
export const GUARD_TRAIN_EXTRA = 0.1;
/** 每人每晚消耗的糧食；不夠時缺幾份就有幾人挨餓 */
export const FOOD_PER_PERSON = 1;
export const HUNGER_DAMAGE = 25;
export const HEAL_AMOUNT = 40;
export const REST_RATIO = 0.5;
export const SCAVENGE_INJURY_CHANCE = 0.25;
export const SCAVENGE_INJURY = 15;

/** 可修築的結構：鐘樓（index 為 null）與受損的城牆、路障。回傳血量比例最低者，同比例時優先鐘樓 */
function mostDamaged(run: Run): { index: number | null; label: string; hp: number; max: number } | null {
  let best: { index: number | null; label: string; hp: number; max: number } | null = null;
  const consider = (index: number | null, label: string, hp: number, max: number) => {
    if (hp >= max) return;
    if (!best || hp / max < best.hp / best.max) best = { index, label, hp, max };
  };
  consider(null, '鐘樓', run.bellHp, BELL_MAX_HP);
  for (const i of RING) {
    const t = run.defense.tiles[i];
    if (t === 1) consider(i, tileLabel(i), run.defense.hp[i], WALL_HP);
    else if (t === 4) consider(i, `${tileLabel(i)}的路障`, run.defense.hp[i], BARRICADE_HP);
  }
  return best;
}

/** 目前開著的缺口（城牆環上的空地），包含原本的城門與被打穿的地方 */
export function openGaps(run: Run): number[] {
  return RING.filter((i) => run.defense.tiles[i] === 0);
}

/** 目前的路障 */
export function barricades(run: Run): number[] {
  return RING.filter((i) => run.defense.tiles[i] === 4);
}

/** 在缺口放路障，成功回傳 true（需要是缺口且木石足夠） */
export function placeBarricade(run: Run, i: number): boolean {
  if (!RING.includes(i) || run.defense.tiles[i] !== 0) return false;
  if (run.resources.wood < BARRICADE_WOOD_COST) return false;
  run.resources.wood -= BARRICADE_WOOD_COST;
  run.defense.tiles[i] = 4;
  run.defense.hp[i] = BARRICADE_HP;
  run.placedToday.push(i);
  return true;
}

/** 拆除路障變回缺口。當天剛放的路障可全額退還木石，之前就有的不退 */
export function removeBarricade(run: Run, i: number): boolean {
  if (run.defense.tiles[i] !== 4) return false;
  run.defense.tiles[i] = 0;
  run.defense.hp[i] = 0;
  const k = run.placedToday.indexOf(i);
  if (k >= 0) {
    run.placedToday.splice(k, 1);
    run.resources.wood += BARRICADE_WOOD_COST;
  }
  return true;
}

/** 今晚晚餐需要的糧食 */
export function foodNeeded(run: Run): number {
  return run.roster.reduce((sum, r) => sum + (TRAIT_INFO[r.trait].meals ?? 1) * FOOD_PER_PERSON, 0);
}

/** 開局的戰鬥職業組成（依序對應編號 1 到 6）：3 民兵、2 弓手、1 醫者 */
const SLOT_KINDS: VillagerKind[] = ['militia', 'militia', 'archer', 'healer', 'militia', 'archer'];

function shuffle<T>(list: T[], rng: () => number): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 依種子抽出這一局的鎮民。戰鬥職業的組成固定，名字、出身與特質是隨機的：
 * 6 位鎮民裡 3 位好特質、3 位壞特質，不重複。同一個種子永遠得到同一批人。
 */
export function makeRoster(seed: number): RosterEntry[] {
  const rng = makeRng(seed ^ 0x51ed270b);
  const names = shuffle(NAME_POOL, rng);
  const traits = shuffle([...shuffle(GOOD_TRAITS, rng).slice(0, 3), ...shuffle(BAD_TRAITS, rng).slice(0, 3)], rng);
  return SLOT_KINDS.map((kind, i) => {
    const origins = ORIGIN_LIST.filter((o) => ORIGIN_INFO[o].kinds.includes(kind));
    const origin: Origin = origins[Math.floor(rng() * origins.length)];
    const trait: Trait = traits[i];
    const maxHp = Math.round(VILLAGER_STATS[kind].hp * (TRAIT_INFO[trait].hpMul ?? 1));
    return { id: i + 1, kind, name: names[i], hp: maxHp, maxHp, origin, trait };
  });
}

export function createRun(
  seed: number,
  maxNights = 7,
  disaster: Disaster = disasterFor(seed),
  roster: RosterEntry[] = makeRoster(seed),
): Run {
  return {
    seed,
    disaster,
    night: 1,
    maxNights,
    roster: roster.map((r) => ({ ...r })),
    resources: { wood: 4, food: 8, iron: 0 },
    bellHp: BELL_MAX_HP,
    defense: createDefense(),
    placedToday: [],
    jobs: Object.fromEntries(roster.map((r) => [r.id, 'rest' as Job])),
    status: 'between',
    nightStarted: false,
    kills: 0,
    breaches: 0,
    fallen: [],
  };
}

function makeRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 結算白天的工作並回傳報告文字。依序處理：搜刮 → 修築 → 訓練 → 治療 → 休息，
 * 因此搜刮得到的木石當天就能拿來修築。同一個種子與同一份工作安排，結果完全相同。
 */
export function resolveDay(run: Run): string[] {
  const rng = makeRng(run.seed * 31 + run.night * 104729);
  const report: string[] = [];
  const workers = (job: Job) => run.roster.filter((r) => (run.jobs[r.id] ?? 'rest') === job);
  /** 勤勞與懶散對白天工作效果的影響 */
  const workMul = (r: RosterEntry) => TRAIT_INFO[r.trait].workMul ?? 1;

  for (const r of workers('scavenge')) {
    const m = workMul(r);
    let wood = Math.round((1 + Math.floor(rng() * 3)) * m);
    let food = Math.round((1 + Math.floor(rng() * 3)) * m);
    let iron = Math.round(Math.floor(rng() * 3) * m);
    if (r.origin === 'farmer') food += 2;
    if (r.origin === 'hunter') {
      food += 1;
      wood += 1;
    }
    if (r.origin === 'thief') iron += 2;
    run.resources.wood += wood;
    run.resources.food += food;
    run.resources.iron += iron;
    let line = `${r.name} 搜刮：木石 +${wood}、糧食 +${food}、鐵料 +${iron}`;
    if (rng() < SCAVENGE_INJURY_CHANCE * (r.origin === 'thief' ? 0.5 : 1)) {
      r.hp = Math.max(1, r.hp - SCAVENGE_INJURY);
      line += `，途中受傷（-${SCAVENGE_INJURY}）`;
    }
    report.push(line);
  }

  for (const r of workers('build')) {
    if (run.resources.wood < BUILD_WOOD_COST) {
      report.push(`${r.name} 想修築，但木石不足`);
      continue;
    }
    const target = mostDamaged(run);
    if (!target) {
      report.push(`${r.name} 想修築，但沒有需要修的地方`);
      continue;
    }
    run.resources.wood -= BUILD_WOOD_COST;
    const repair = Math.round(BUILD_REPAIR * workMul(r) * (r.origin === 'smith' ? 1.5 : 1));
    const gain = Math.min(repair, target.max - target.hp);
    if (target.index === null) run.bellHp += gain;
    else run.defense.hp[target.index] += gain;
    report.push(`${r.name} 修築 ${target.label}：+${gain}`);
  }

  for (const r of workers('train')) {
    const extra = r.origin === 'guard' ? GUARD_TRAIN_EXTRA : 0;
    if (run.resources.iron >= TRAIN_IRON_COST) {
      run.resources.iron -= TRAIN_IRON_COST;
      r.powerMul = TRAIN_BONUS + extra;
      report.push(`${r.name} 訓練：耗鐵料 ${TRAIN_IRON_COST}，下一夜戰鬥力 +${Math.round((r.powerMul - 1) * 100)}%`);
    } else {
      r.powerMul = TRAIN_BONUS_NO_IRON + extra;
      report.push(`${r.name} 訓練：鐵料不足，戰鬥力只有 +${Math.round((r.powerMul - 1) * 100)}%`);
    }
  }

  for (const r of workers('heal')) {
    // 照料傷勢比例最重的「其他」鎮民
    let target: RosterEntry | null = null;
    for (const o of run.roster) {
      if (o.id === r.id || o.hp >= o.maxHp) continue;
      if (!target || o.hp / o.maxHp < target.hp / target.maxHp) target = o;
    }
    if (!target) {
      report.push(`${r.name} 想治療，但沒有人受傷`);
      continue;
    }
    const amount = Math.round(HEAL_AMOUNT * workMul(r) * (r.origin === 'nun' ? 1.5 : 1));
    const gain = Math.min(amount, target.maxHp - target.hp);
    target.hp += gain;
    report.push(`${r.name} 治療 ${target.name}：+${gain}`);
  }

  for (const r of workers('rest')) {
    const gain = Math.min(Math.ceil(r.maxHp * REST_RATIO), r.maxHp - r.hp);
    r.hp += gain;
    if (gain > 0) report.push(`${r.name} 休息：+${gain}`);
  }

  // 晚餐：每人 1 份糧食，不夠的話隨機挑缺口人數挨餓
  const need = foodNeeded(run);
  const eaten = Math.min(need, run.resources.food);
  run.resources.food -= eaten;
  // 缺的是「份數」，挨餓的人數不會超過全部鎮民（貪吃的人一個就占兩份）
  const hungry = Math.min(need - eaten, run.roster.length);
  if (need === eaten) {
    report.push(`晚餐：全員吃飽（糧食 -${eaten}）`);
  } else {
    const pool = [...run.roster];
    const names: string[] = [];
    for (let i = 0; i < hungry && pool.length > 0; i++) {
      const [r] = pool.splice(Math.floor(rng() * pool.length), 1);
      r.hp = Math.max(1, r.hp - HUNGER_DAMAGE);
      names.push(r.name);
    }
    report.push(`晚餐：糧食不足！${names.join('、')} 挨餓（血量 -${HUNGER_DAMAGE}）`);
  }

  run.placedToday = [];
  return report;
}

/** 今晚的難度設定（方向、強度、是否有首領）。白天面板用它做預告，開戰時用的是同一份 */
export function forecast(run: Run): NightConfig {
  return nightConfig(run.seed, run.night, run.maxNights, run.disaster);
}

/** 以目前名冊建立當夜的戰鬥。每夜的亂數種子不同，但整局可重現 */
export function startNight(run: Run): Game {
  return createGame(run.seed + run.night * 7919, run.roster, run.bellHp, run.defense, forecast(run));
}

/**
 * 夜晚結束後結算：陣亡者從名冊移除、存活者帶著剩餘血量進入下一夜，
 * 鐘樓耐久也會保留。白天訓練的加成只對當夜有效，這裡清除。
 * 回傳更新後的局狀態（同一個物件）。
 */
export function settleNight(run: Run, game: Game): Run {
  if (game.phase === 'night') throw new Error('夜晚尚未結束');

  const byId = new Map(game.villagers.map((v) => [v.id, v]));
  for (const r of run.roster) {
    if (!byId.get(r.id)?.alive) run.fallen.push({ name: r.name, night: run.night });
  }
  run.kills += game.kills;
  run.breaches += game.breaches;
  run.nightStarted = false;
  run.roster = run.roster.filter((r) => byId.get(r.id)?.alive);
  for (const r of run.roster) {
    r.hp = Math.ceil(byId.get(r.id)!.hp);
    delete r.powerMul;
  }
  for (const id of Object.keys(run.jobs)) {
    if (!run.roster.some((r) => r.id === Number(id))) delete run.jobs[Number(id)];
  }
  run.bellHp = Math.ceil(game.bellHp);
  run.defense = { tiles: game.tiles.slice(), hp: game.structHp.slice() };
  run.placedToday = [];

  if (game.phase === 'lost' || run.roster.length === 0) {
    run.status = 'lost';
  } else if (run.night >= run.maxNights) {
    run.status = 'won';
  } else {
    run.night++;
    run.status = 'between';
  }
  return run;
}
