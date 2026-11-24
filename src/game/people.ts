// 鎮民的出身與特質：純資料，不依賴其他遊戲模組。
import type { VillagerKind } from './sim';

export type Origin = 'smith' | 'farmer' | 'guard' | 'hunter' | 'thief' | 'nun';
export type Trait =
  | 'nightEye'
  | 'strong'
  | 'brave'
  | 'swift'
  | 'diligent'
  | 'timid'
  | 'glutton'
  | 'frail'
  | 'lazy'
  | 'none';

export interface OriginInfo {
  label: string;
  /** 白天擅長的事（給介面顯示） */
  skill: string;
  /** 適合的戰鬥職業，開局抽取時只會抽到相符的 */
  kinds: VillagerKind[];
}

export const ORIGIN_INFO: Record<Origin, OriginInfo> = {
  smith: { label: '鐵匠', skill: '修築修復量 ×1.5', kinds: ['militia'] },
  farmer: { label: '農夫', skill: '搜刮時糧食 +2', kinds: ['militia'] },
  guard: { label: '衛兵', skill: '訓練加成多 10%', kinds: ['militia'] },
  hunter: { label: '獵人', skill: '搜刮時糧食、木石各 +1', kinds: ['archer'] },
  thief: { label: '小偷', skill: '搜刮時鐵料 +2，且較不易受傷', kinds: ['archer'] },
  nun: { label: '修女', skill: '治療量 ×1.5', kinds: ['healer'] },
};
export const ORIGIN_LIST = Object.keys(ORIGIN_INFO) as Origin[];

export interface TraitInfo {
  label: string;
  desc: string;
  good: boolean;
  /** 夜晚射程加成（格） */
  rangeBonus?: number;
  /** 移動速度倍率 */
  speedMul?: number;
  /** 戰鬥力倍率 */
  powerMul?: number;
  /** 最大血量倍率 */
  hpMul?: number;
  /** 白天工作效果倍率（搜刮、修築、治療） */
  workMul?: number;
  /** 每晚晚餐吃幾份 */
  meals?: number;
  /** 附近同伴倒下時會逃跑 */
  timid?: boolean;
}

export const TRAIT_INFO: Record<Trait, TraitInfo> = {
  nightEye: { label: '夜眼', desc: '夜晚射程 +1', good: true, rangeBonus: 1 },
  strong: { label: '強壯', desc: '最大血量 +25%', good: true, hpMul: 1.25 },
  brave: { label: '勇猛', desc: '戰鬥力 +20%', good: true, powerMul: 1.2 },
  swift: { label: '迅捷', desc: '移動速度 +30%', good: true, speedMul: 1.3 },
  diligent: { label: '勤勞', desc: '白天工作效果 +30%', good: true, workMul: 1.3 },
  timid: { label: '膽小', desc: '附近同伴倒下時會逃回鐘樓 6 秒', good: false, timid: true },
  glutton: { label: '貪吃', desc: '每晚吃 2 份糧食', good: false, meals: 2 },
  frail: { label: '體弱', desc: '最大血量 −20%', good: false, hpMul: 0.8 },
  lazy: { label: '懶散', desc: '白天工作效果 −30%', good: false, workMul: 0.7 },
  none: { label: '平凡', desc: '沒有特別之處', good: false },
};
export const GOOD_TRAITS = (Object.keys(TRAIT_INFO) as Trait[]).filter((t) => TRAIT_INFO[t].good);
export const BAD_TRAITS = (Object.keys(TRAIT_INFO) as Trait[]).filter((t) => t !== 'none' && !TRAIT_INFO[t].good);

/** 開局抽名字用的名字池。預設名冊（測試與舊存檔）依序取前六個 */
export const NAME_POOL = [
  '葛雷', '瑪莎', '芬恩', '艾琳', '布蘭', '莉娜', '托爾', '蘇菲', '雷夫', '艾瑞克',
  '米拉', '凱爾', '諾拉', '奧斯', '佩姬', '杜蘭', '洛琪', '哈克', '伊芙', '賈斯',
];
