// 一局（Run）：跨越多個夜晚的狀態。夜晚戰鬥由 sim.ts 負責，這裡只管名冊與天數。
import { createGame, DEFAULT_ROSTER, Game, RosterEntry } from './sim';

export type RunStatus = 'between' | 'won' | 'lost';

export interface Run {
  seed: number;
  /** 目前（或即將進行）的第幾夜，從 1 開始 */
  night: number;
  maxNights: number;
  roster: RosterEntry[];
  status: RunStatus;
}

/** 兩夜之間的暫時回復比例。之後白天的「治療／休息」會取代這個固定值 */
export const OVERNIGHT_RECOVERY = 0.3;

export function createRun(seed: number, maxNights = 7): Run {
  return {
    seed,
    night: 1,
    maxNights,
    roster: DEFAULT_ROSTER.map((r) => ({ ...r })),
    status: 'between',
  };
}

/** 以目前名冊建立當夜的戰鬥。每夜的亂數種子不同，但整局可重現 */
export function startNight(run: Run): Game {
  return createGame(run.seed + run.night * 7919, run.roster);
}

/**
 * 夜晚結束後結算：陣亡者從名冊移除、存活者帶著剩餘血量進入下一夜。
 * 回傳更新後的局狀態（同一個物件）。
 */
export function settleNight(run: Run, game: Game): Run {
  if (game.phase === 'night') throw new Error('夜晚尚未結束');

  const byId = new Map(game.villagers.map((v) => [v.id, v]));
  run.roster = run.roster.filter((r) => byId.get(r.id)?.alive);
  for (const r of run.roster) r.hp = Math.ceil(byId.get(r.id)!.hp);

  if (game.phase === 'lost' || run.roster.length === 0) {
    run.status = 'lost';
  } else if (run.night >= run.maxNights) {
    run.status = 'won';
  } else {
    run.night++;
    for (const r of run.roster) r.hp = Math.min(r.maxHp, r.hp + Math.ceil(r.maxHp * OVERNIGHT_RECOVERY));
    run.status = 'between';
  }
  return run;
}
