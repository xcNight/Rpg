// 一局（Run）：跨越多個夜晚的狀態。夜晚戰鬥由 sim.ts 負責，這裡管名冊、資源與白天的工作結算。
import { BELL_MAX_HP, createGame, DEFAULT_ROSTER, Game, RosterEntry } from './sim';

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
  /** 目前（或即將進行）的第幾夜，從 1 開始 */
  night: number;
  maxNights: number;
  roster: RosterEntry[];
  resources: Resources;
  bellHp: number;
  /** 每位鎮民（id）今天的工作 */
  jobs: Record<number, Job>;
  status: RunStatus;
}

export const JOB_INFO: Record<Job, { label: string; desc: string }> = {
  build: { label: '修築', desc: '耗木石 2，修復鐘樓 40 點耐久' },
  scavenge: { label: '搜刮', desc: '帶回木石、糧食、鐵料；有 25% 機率受傷' },
  train: { label: '訓練', desc: '耗鐵料 1，下一夜戰鬥力 +25%（沒有鐵料只有 +10%）' },
  heal: { label: '治療', desc: '照料傷勢最重的同伴，回復 40 點血量' },
  rest: { label: '休息', desc: '回復自身 50% 血量' },
};
export const JOB_ORDER: Job[] = ['build', 'scavenge', 'train', 'heal', 'rest'];

export const BUILD_WOOD_COST = 2;
export const BUILD_REPAIR = 40;
export const TRAIN_BONUS = 1.25;
export const TRAIN_BONUS_NO_IRON = 1.1;
export const TRAIN_IRON_COST = 1;
/** 每人每晚消耗的糧食；不夠時缺幾份就有幾人挨餓 */
export const FOOD_PER_PERSON = 1;
export const HUNGER_DAMAGE = 25;
export const HEAL_AMOUNT = 40;
export const REST_RATIO = 0.5;
export const SCAVENGE_INJURY_CHANCE = 0.25;
export const SCAVENGE_INJURY = 15;

/** 今晚晚餐需要的糧食 */
export function foodNeeded(run: Run): number {
  return run.roster.length * FOOD_PER_PERSON;
}

export function createRun(seed: number, maxNights = 7): Run {
  const roster = DEFAULT_ROSTER.map((r) => ({ ...r }));
  return {
    seed,
    night: 1,
    maxNights,
    roster,
    resources: { wood: 4, food: 6, iron: 0 },
    bellHp: BELL_MAX_HP,
    jobs: Object.fromEntries(roster.map((r) => [r.id, 'rest' as Job])),
    status: 'between',
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

  for (const r of workers('scavenge')) {
    const wood = 1 + Math.floor(rng() * 3);
    const food = 1 + Math.floor(rng() * 3);
    const iron = Math.floor(rng() * 3);
    run.resources.wood += wood;
    run.resources.food += food;
    run.resources.iron += iron;
    let line = `${r.name} 搜刮：木石 +${wood}、糧食 +${food}、鐵料 +${iron}`;
    if (rng() < SCAVENGE_INJURY_CHANCE) {
      r.hp = Math.max(1, r.hp - SCAVENGE_INJURY);
      line += `，途中受傷（-${SCAVENGE_INJURY}）`;
    }
    report.push(line);
  }

  for (const r of workers('build')) {
    if (run.resources.wood < BUILD_WOOD_COST) {
      report.push(`${r.name} 想修築，但木石不足`);
    } else if (run.bellHp >= BELL_MAX_HP) {
      report.push(`${r.name} 想修築，但鐘樓完好無缺`);
    } else {
      run.resources.wood -= BUILD_WOOD_COST;
      const gain = Math.min(BUILD_REPAIR, BELL_MAX_HP - run.bellHp);
      run.bellHp += gain;
      report.push(`${r.name} 修築：鐘樓 +${gain}`);
    }
  }

  for (const r of workers('train')) {
    if (run.resources.iron >= TRAIN_IRON_COST) {
      run.resources.iron -= TRAIN_IRON_COST;
      r.powerMul = TRAIN_BONUS;
      report.push(`${r.name} 訓練：耗鐵料 ${TRAIN_IRON_COST}，下一夜戰鬥力 +${Math.round((TRAIN_BONUS - 1) * 100)}%`);
    } else {
      r.powerMul = TRAIN_BONUS_NO_IRON;
      report.push(`${r.name} 訓練：鐵料不足，戰鬥力只有 +${Math.round((TRAIN_BONUS_NO_IRON - 1) * 100)}%`);
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
    const gain = Math.min(HEAL_AMOUNT, target.maxHp - target.hp);
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
  const hungry = need - eaten;
  if (hungry === 0) {
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

  return report;
}

/** 以目前名冊建立當夜的戰鬥。每夜的亂數種子不同，但整局可重現 */
export function startNight(run: Run): Game {
  return createGame(run.seed + run.night * 7919, run.roster, run.bellHp);
}

/**
 * 夜晚結束後結算：陣亡者從名冊移除、存活者帶著剩餘血量進入下一夜，
 * 鐘樓耐久也會保留。白天訓練的加成只對當夜有效，這裡清除。
 * 回傳更新後的局狀態（同一個物件）。
 */
export function settleNight(run: Run, game: Game): Run {
  if (game.phase === 'night') throw new Error('夜晚尚未結束');

  const byId = new Map(game.villagers.map((v) => [v.id, v]));
  run.roster = run.roster.filter((r) => byId.get(r.id)?.alive);
  for (const r of run.roster) {
    r.hp = Math.ceil(byId.get(r.id)!.hp);
    delete r.powerMul;
  }
  for (const id of Object.keys(run.jobs)) {
    if (!run.roster.some((r) => r.id === Number(id))) delete run.jobs[Number(id)];
  }
  run.bellHp = Math.ceil(game.bellHp);

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
