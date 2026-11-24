// 存檔：把一局（Run）轉成文字，以及讀回時的嚴格驗證。
// 這裡只處理資料，不碰 localStorage（由 main.ts 負責），方便測試。
import { DISASTER_LIST } from './disaster';
import { Job, JOB_ORDER, Run } from './run';
import { BELL, BELL_MAX_HP, VillagerKind, W, H } from './sim';

const VERSION = 1;
const KINDS: VillagerKind[] = ['militia', 'archer', 'healer'];

export function serializeRun(run: Run): string {
  return JSON.stringify({ v: VERSION, run });
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isInt = (x: unknown): x is number => isNum(x) && Number.isInteger(x);
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * 讀回存檔。任何欄位缺漏、型別不對、數值超出合理範圍都回傳 null，
 * 避免壞掉的存檔（或手動改過的存檔）讓遊戲進入無法預期的狀態。
 * 只接受「白天、局還在進行」的存檔。
 */
export function parseRun(text: string | null): Run | null {
  if (!text) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(data) || data.v !== VERSION || !isObj(data.run)) return null;
  const r = data.run;

  if (!isNum(r.seed)) return null;
  // 災厄加入前的舊存檔沒有這個欄位，視為亡靈潮；有的話必須是已知的災厄
  if (r.disaster === undefined) r.disaster = 'undead';
  if (!DISASTER_LIST.includes(r.disaster as never)) return null;
  if (!isInt(r.maxNights) || r.maxNights < 1 || r.maxNights > 30) return null;
  if (!isInt(r.night) || r.night < 1 || r.night > r.maxNights) return null;
  if (r.status !== 'between') return null;
  if (typeof r.nightStarted !== 'boolean') return null;
  if (!isInt(r.kills) || r.kills < 0 || !isInt(r.breaches) || r.breaches < 0) return null;
  if (!isInt(r.bellHp) || r.bellHp < 1 || r.bellHp > BELL_MAX_HP) return null;

  if (!Array.isArray(r.roster) || r.roster.length < 1 || r.roster.length > 20) return null;
  const ids = new Set<number>();
  for (const m of r.roster) {
    if (!isObj(m) || !isInt(m.id) || ids.has(m.id)) return null;
    ids.add(m.id);
    if (!KINDS.includes(m.kind as VillagerKind) || typeof m.name !== 'string' || m.name.length > 20) return null;
    if (!isNum(m.maxHp) || m.maxHp <= 0 || m.maxHp > 1000) return null;
    if (!isNum(m.hp) || m.hp < 1 || m.hp > m.maxHp) return null;
    if (m.powerMul !== undefined && (!isNum(m.powerMul) || m.powerMul < 1 || m.powerMul > 3)) return null;
  }

  if (!isObj(r.resources)) return null;
  for (const k of ['wood', 'food', 'iron']) {
    const v = r.resources[k];
    if (!isInt(v) || v < 0 || v > 9999) return null;
  }

  if (!isObj(r.defense)) return null;
  const { tiles, hp } = r.defense;
  if (!Array.isArray(tiles) || !Array.isArray(hp) || tiles.length !== W * H || hp.length !== W * H) return null;
  for (let i = 0; i < tiles.length; i++) {
    if (!isInt(tiles[i]) || tiles[i] < 0 || tiles[i] > 4) return null;
    if (!isNum(hp[i]) || hp[i] < 0 || hp[i] > 1000) return null;
  }
  if (tiles[BELL.y * W + BELL.x] !== 2) return null;

  if (!isObj(r.jobs)) return null;
  for (const [id, job] of Object.entries(r.jobs)) {
    if (!ids.has(Number(id)) || !JOB_ORDER.includes(job as Job)) return null;
  }
  if (!Array.isArray(r.placedToday) || !r.placedToday.every((i) => isInt(i) && i >= 0 && i < W * H)) return null;

  if (!Array.isArray(r.fallen) || r.fallen.length > 100) return null;
  for (const f of r.fallen) {
    if (!isObj(f) || typeof f.name !== 'string' || !isInt(f.night) || f.night < 1) return null;
  }

  return r as unknown as Run;
}
