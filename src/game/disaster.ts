// 災厄：每局抽一種，決定敵人的組成與行為。純資料，不依賴其他遊戲模組。

export type Disaster = 'undead' | 'wolves' | 'siege';
export const DISASTER_LIST: Disaster[] = ['undead', 'wolves', 'siege'];

export interface BossStats {
  hp: number;
  power: number;
  range: number;
  cd: number;
  speed: number;
  aggro: number;
  /** 對城牆與路障的傷害倍率 */
  structMul: number;
}

export interface DisasterInfo {
  label: string;
  desc: string;
  /** 普通敵人的名稱與畫面上的字 */
  enemyName: string;
  glyph: string;
  color: string;
  bossName: string;
  // 以下倍率會疊加在「逐夜上升的難度曲線」之上
  hpMul: number;
  powerMul: number;
  speedMul: number;
  /** 出怪間隔倍率：越小出得越頻繁 */
  spawnMul: number;
  aggroMul: number;
  /** 普通敵人對城牆與路障的傷害倍率 */
  structMul: number;
  /** 每次出怪有多少機率是攻城槌 */
  ramChance: number;
  /** 後段夜晚是否連北門也會被攻擊 */
  northSide: boolean;
  boss: BossStats;
}

export const DISASTER_INFO: Record<Disaster, DisasterInfo> = {
  undead: {
    label: '亡靈潮',
    desc: '數量眾多、出怪頻繁，但每一隻都很脆弱。',
    enemyName: '行屍',
    glyph: '屍',
    color: '#b0503f',
    bossName: '亡靈領主',
    hpMul: 0.8,
    powerMul: 0.9,
    speedMul: 1,
    spawnMul: 0.8,
    aggroMul: 1,
    structMul: 1,
    ramChance: 0,
    northSide: false,
    boss: { hp: 400, power: 15, range: 1.0, cd: 1.2, speed: 0.9, aggro: 2.2, structMul: 1 },
  },
  wolves: {
    label: '狼人群',
    desc: '速度極快，會從北門繞後，連最安全的門也要防；但不擅長破牆。',
    enemyName: '狼人',
    glyph: '狼',
    color: '#8a6f9e',
    bossName: '狼人王',
    hpMul: 0.8,
    powerMul: 1.1,
    speedMul: 1.6,
    spawnMul: 0.85,
    aggroMul: 1.6,
    structMul: 0.5,
    ramChance: 0,
    northSide: true,
    boss: { hp: 320, power: 14, range: 1.0, cd: 0.9, speed: 1.5, aggro: 3.0, structMul: 0.5 },
  },
  siege: {
    label: '圍城軍',
    desc: '行動遲緩，但帶著攻城槌專門拆牆。槌子不理會鎮民，留著缺口它們就只能慢慢走進來。',
    enemyName: '士兵',
    glyph: '兵',
    color: '#a08a50',
    bossName: '攻城統領',
    hpMul: 1.05,
    powerMul: 1,
    speedMul: 0.85,
    spawnMul: 1.15,
    aggroMul: 1,
    structMul: 1,
    ramChance: 0.2,
    northSide: false,
    boss: { hp: 520, power: 12, range: 1.0, cd: 1.2, speed: 0.8, aggro: 2.0, structMul: 3 },
  },
};

/** 攻城槌：血厚、移動慢、不理鎮民，對城牆的傷害很高 */
export const RAM_STATS = { hp: 150, power: 4, range: 0.8, cd: 1.5, speed: 0.55, aggro: 0, structPower: 25 };

/** 由種子決定這一局的災厄（同一個種子永遠相同） */
export function disasterFor(seed: number): Disaster {
  let h = Math.imul(seed | 0, 2246822519) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 15), 3266489917) >>> 0;
  return DISASTER_LIST[h % DISASTER_LIST.length];
}
