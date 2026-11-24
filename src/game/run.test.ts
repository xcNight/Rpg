import { describe, expect, it } from 'vitest';
import {
  BARRICADE_WOOD_COST,
  barricades,
  BUILD_REPAIR,
  BUILD_WOOD_COST,
  createRun,
  foodNeeded,
  forecast,
  GUARD_TRAIN_EXTRA,
  HEAL_AMOUNT,
  HUNGER_DAMAGE,
  Job,
  openGaps,
  placeBarricade,
  removeBarricade,
  resolveDay,
  Run,
  settleNight,
  startNight,
  TRAIN_BONUS,
  TRAIN_BONUS_NO_IRON,
} from './run';
import { BARRICADE_HP, BELL_MAX_HP, spawnEnemyAt, update, W, WALL_HP } from './sim';
import { DEFAULT_ROSTER } from './sim';
import type { Disaster } from './disaster';

/** 固定名冊（沒有特質）的一局，讓下列測試的數字不受隨機鎮民影響 */
const plainRun = (seed: number, maxNights?: number, disaster?: Disaster) =>
  createRun(seed, maxNights, disaster, DEFAULT_ROSTER.map((r) => ({ ...r })));

const WEST_GATE = 7 * W + 5;
const WEST_WALL = 5 * W + 5;

/** 把名冊裡指定鎮民設成某項工作，其餘維持預設（休息） */
function assign(run: Run, jobs: Record<number, Job>) {
  Object.assign(run.jobs, jobs);
}

/** 不出怪、幾秒就天亮的一夜，用來單純驗證結算 */
function quietNight(run: Run) {
  const g = startNight(run);
  g.nightLength = 5;
  g.spawnTimer = 1000;
  return g;
}

describe('一局的狀態', () => {
  it('開局從第 1 夜、完整名冊與初始資源開始', () => {
    const run = plainRun(1);
    expect(run.night).toBe(1);
    expect(run.roster).toHaveLength(6);
    expect(run.status).toBe('between');
    expect(run.bellHp).toBe(BELL_MAX_HP);
    expect(Object.keys(run.jobs)).toHaveLength(6);
  });

  it('陣亡的鎮民下一夜不會出現，工作安排也一併清除', () => {
    const run = plainRun(1);
    const g = quietNight(run);
    const victim = g.villagers.find((v) => v.id === 1)!;
    victim.alive = false;
    victim.hp = 0;
    update(g, 6);
    expect(g.phase).toBe('won');

    settleNight(run, g);
    expect(run.status).toBe('between');
    expect(run.night).toBe(2);
    expect(run.roster.map((r) => r.id)).not.toContain(1);
    expect(run.jobs[1]).toBeUndefined();
    expect(startNight(run).villagers).toHaveLength(5);
  });

  it('存活者帶著剩餘血量入下一夜，沒有自動回復', () => {
    const run = plainRun(1);
    const g = quietNight(run);
    g.villagers.find((v) => v.id === 3)!.hp = 20;
    g.villagers.find((v) => v.id === 4)!.alive = false; // 移除醫者，避免戰鬥中被治療
    update(g, 6);
    settleNight(run, g);
    expect(run.roster.find((r) => r.id === 3)!.hp).toBe(20);
  });

  it('鐘樓受損會帶到下一夜', () => {
    const run = plainRun(1);
    const g = quietNight(run);
    g.bellHp = 123;
    update(g, 6);
    settleNight(run, g);
    expect(run.bellHp).toBe(123);
    expect(startNight(run).bellHp).toBe(123);
  });

  it('鐘樓倒塌時整局結束', () => {
    const run = plainRun(1);
    const g = startNight(run);
    g.bellHp = 0;
    update(g, 0.1);
    expect(g.phase).toBe('lost');
    settleNight(run, g);
    expect(run.status).toBe('lost');
  });

  it('全員陣亡時整局結束', () => {
    const run = plainRun(1);
    const g = startNight(run);
    for (const v of g.villagers) v.alive = false;
    g.phase = 'won'; // 即使夜晚撐到天亮，沒有人也算失敗
    settleNight(run, g);
    expect(run.status).toBe('lost');
  });

  it('撐過最後一夜即通關，不再增加夜數', () => {
    const run = plainRun(1, 2);
    for (let i = 0; i < 2; i++) {
      const g = quietNight(run);
      update(g, 6);
      settleNight(run, g);
    }
    expect(run.status).toBe('won');
    expect(run.night).toBe(2);
  });

  it('夜晚未結束時不能結算', () => {
    const run = plainRun(1);
    expect(() => settleNight(run, startNight(run))).toThrow();
  });

  it('同一個種子的整局可重現', () => {
    const play = () => {
      const run = plainRun(5);
      const g = startNight(run);
      update(g, g.nightLength + 1);
      return g;
    };
    const a = play();
    const b = play();
    expect(a.kills).toBe(b.kills);
    expect(a.bellHp).toBe(b.bellHp);
  });
});

describe('白天的工作', () => {
  it('搜刮會增加資源，且同一種子結果相同', () => {
    const make = () => {
      const run = plainRun(9);
      assign(run, { 1: 'scavenge', 2: 'scavenge' });
      return run;
    };
    const a = make();
    const b = make();
    const before = { ...a.resources };
    a.resources.food = b.resources.food = 100;
    resolveDay(a);
    resolveDay(b);
    expect(a.resources).toEqual(b.resources);
    expect(a.resources.wood).toBeGreaterThan(before.wood);
    // 對照組：沒人搜刮，只扣晚餐
    const control = plainRun(9);
    control.resources.food = 100;
    resolveDay(control);
    expect(a.resources.food).toBeGreaterThan(control.resources.food);
  });

  it('搜刮有機會受傷，但血量不會低於 1', () => {
    const run = plainRun(3);
    for (const r of run.roster) r.hp = 1;
    assign(run, { 1: 'scavenge', 2: 'scavenge', 3: 'scavenge', 4: 'scavenge' });
    resolveDay(run);
    for (const r of run.roster) expect(r.hp).toBeGreaterThanOrEqual(1);
  });

  it('修築消耗木石並修復鐘樓，不超過上限', () => {
    const run = plainRun(1);
    run.bellHp = 100;
    run.resources.wood = 10;
    assign(run, { 1: 'build', 2: 'build' });
    resolveDay(run);
    expect(run.bellHp).toBe(100 + BUILD_REPAIR * 2);
    expect(run.resources.wood).toBe(10 - BUILD_WOOD_COST * 2);

    run.bellHp = BELL_MAX_HP - 10;
    run.resources.wood = 10;
    assign(run, { 1: 'build', 2: 'rest' });
    resolveDay(run);
    expect(run.bellHp).toBe(BELL_MAX_HP);
  });

  it('木石不足或鐘樓完好時，修築不會消耗資源', () => {
    const run = plainRun(1);
    run.bellHp = 100;
    run.resources.wood = 1;
    assign(run, { 1: 'build' });
    expect(resolveDay(run).join()).toContain('木石不足');
    expect(run.bellHp).toBe(100);
    expect(run.resources.wood).toBe(1);

    run.bellHp = BELL_MAX_HP;
    run.resources.wood = 10;
    resolveDay(run);
    expect(run.resources.wood).toBe(10);
  });

  it('訓練讓當夜戰鬥力提高，隔夜清除', () => {
    const run = plainRun(1);
    run.resources.iron = 1;
    assign(run, { 1: 'train' });
    resolveDay(run);
    const g = quietNight(run);
    expect(g.villagers.find((v) => v.id === 1)!.powerMul).toBeCloseTo(TRAIN_BONUS + GUARD_TRAIN_EXTRA); // 預設鎮民 1 是衛兵
    expect(g.villagers.find((v) => v.id === 2)!.powerMul).toBe(1);

    update(g, 6);
    settleNight(run, g);
    expect(startNight(run).villagers.every((v) => v.powerMul === 1)).toBe(true);
  });

  it('訓練後的民兵一擊的傷害確實更高', () => {
    const strike = (mul: number) => {
      const run = plainRun(1);
      run.roster[0].powerMul = mul;
      const g = startNight(run);
      g.spawnTimer = 1000;
      for (const o of g.villagers.slice(1)) o.alive = false; // 只留一位，排除其他人的攻擊
      const v = g.villagers[0];
      const foe = spawnEnemyAt(g, v.x + 0.5, v.y);
      foe.hp = foe.maxHp = 1000;
      foe.cd = 99; // 敵人不還手，只量測傷害
      update(g, 0.1);
      return 1000 - g.enemies[0].hp;
    };
    expect(strike(TRAIN_BONUS)).toBeCloseTo(strike(1) * TRAIN_BONUS);
  });

  it('治療會補最需要的「其他」鎮民，不補自己', () => {
    const run = plainRun(1);
    run.roster[0].hp = 20; // 葛雷 20/120，比例最低
    run.roster[2].hp = 50; // 芬恩 50/60
    assign(run, { 1: 'train', 2: 'train', 3: 'train', 4: 'heal' }); // 艾琳治療，其他人不休息
    run.roster[3].hp = 20; // 艾琳自己也受傷，但不能治療自己
    resolveDay(run);
    expect(run.roster[0].hp).toBe(20 + HEAL_AMOUNT * 1.5); // 艾琳是修女，治療量 ×1.5
    expect(run.roster[2].hp).toBe(50);
    expect(run.roster[3].hp).toBe(20);
  });

  it('休息回復自身血量，不超過上限', () => {
    const run = plainRun(1);
    run.roster[0].hp = 10; // 葛雷 10/120
    run.roster[2].hp = 50; // 芬恩 50/60
    resolveDay(run); // 預設全員休息
    expect(run.roster[0].hp).toBe(70);
    expect(run.roster[2].hp).toBe(60);
  });

  it('搜刮的木石當天就能拿來修築', () => {
    const run = plainRun(1);
    run.resources.wood = 0;
    run.bellHp = 100;
    assign(run, { 1: 'scavenge', 2: 'scavenge', 3: 'scavenge', 4: 'build' });
    resolveDay(run);
    // 三人搜刮至少帶回 3 木石，足夠支付修築的 2
    expect(run.bellHp).toBe(140);
  });
});

describe('糧食與鐵料', () => {
  it('晚餐每人消耗 1 糧食，吃飽不扣血', () => {
    const run = plainRun(1);
    run.resources.food = 10;
    for (const r of run.roster) r.hp = r.maxHp;
    const report = resolveDay(run);
    expect(foodNeeded(run)).toBe(6);
    expect(run.resources.food).toBe(4);
    expect(report.join()).toContain('全員吃飽');
    for (const r of run.roster) expect(r.hp).toBe(r.maxHp);
  });

  it('糧食不足時，缺幾份就有幾人挨餓，糧食歸零', () => {
    const run = plainRun(1);
    run.resources.food = 3; // 需要 6，缺 3
    assign(run, { 1: 'train', 2: 'train', 3: 'train', 4: 'train', 5: 'train', 6: 'train' }); // 不休息，避免回血干擾
    run.resources.iron = 6;
    const before = run.roster.map((r) => r.hp);
    resolveDay(run);
    expect(run.resources.food).toBe(0);
    const hurt = run.roster.filter((r, i) => r.hp < before[i]);
    expect(hurt).toHaveLength(3);
    for (const r of hurt) expect(r.hp).toBe(Math.max(1, r.maxHp - HUNGER_DAMAGE));
  });

  it('挨餓不會讓人餓死，血量最低留 1', () => {
    const run = plainRun(1);
    run.resources.food = 0;
    for (const r of run.roster) r.hp = 5;
    assign(run, { 1: 'train', 2: 'train', 3: 'train', 4: 'train' });
    resolveDay(run);
    for (const r of run.roster) expect(r.hp).toBeGreaterThanOrEqual(1);
  });

  it('挨餓的人選擇可重現', () => {
    const play = () => {
      const run = plainRun(4);
      run.resources.food = 0;
      assign(run, { 1: 'train', 2: 'train', 3: 'train', 4: 'train' });
      return resolveDay(run).join();
    };
    expect(play()).toBe(play());
  });

  it('訓練耗 1 鐵料；沒有鐵料時加成較小', () => {
    const run = plainRun(1);
    run.resources.iron = 1;
    assign(run, { 1: 'train', 2: 'train' });
    resolveDay(run);
    expect(run.resources.iron).toBe(0);
    // 預設的民兵都是衛兵出身，訓練加成各多 0.1
    expect(run.roster[0].powerMul).toBeCloseTo(TRAIN_BONUS + GUARD_TRAIN_EXTRA);
    expect(run.roster[1].powerMul).toBeCloseTo(TRAIN_BONUS_NO_IRON + GUARD_TRAIN_EXTRA);
  });
});

describe('城防', () => {
  it('開局有四個缺口、沒有路障', () => {
    const run = plainRun(1);
    expect(openGaps(run)).toHaveLength(4);
    expect(barricades(run)).toHaveLength(0);
  });

  it('在缺口放路障：耗木石、記為今天放的；牆上或木石不足時不能放', () => {
    const run = plainRun(1);
    run.resources.wood = 10;
    expect(placeBarricade(run, WEST_GATE)).toBe(true);
    expect(run.resources.wood).toBe(10 - BARRICADE_WOOD_COST);
    expect(run.defense.tiles[WEST_GATE]).toBe(4);
    expect(run.defense.hp[WEST_GATE]).toBe(BARRICADE_HP);
    expect(placeBarricade(run, WEST_GATE)).toBe(false); // 已經有路障
    expect(placeBarricade(run, WEST_WALL)).toBe(false); // 城牆不是缺口
    run.resources.wood = BARRICADE_WOOD_COST - 1;
    expect(placeBarricade(run, 7 * W + 14)).toBe(false); // 木石不足
  });

  it('拆除：當天剛放的退還木石，過夜後再拆不退', () => {
    const run = plainRun(1);
    run.resources.wood = 10;
    placeBarricade(run, WEST_GATE);
    expect(removeBarricade(run, WEST_GATE)).toBe(true);
    expect(run.resources.wood).toBe(10);
    expect(run.defense.tiles[WEST_GATE]).toBe(0);

    placeBarricade(run, WEST_GATE);
    resolveDay(run); // 入夜，今天放的標記清除
    run.resources.wood = 10;
    expect(removeBarricade(run, WEST_GATE)).toBe(true);
    expect(run.resources.wood).toBe(10);
    expect(removeBarricade(run, WEST_GATE)).toBe(false); // 已經不是路障
  });

  it('城防會用在夜晚戰鬥裡', () => {
    const run = plainRun(1);
    run.resources.wood = 10;
    placeBarricade(run, WEST_GATE);
    expect(startNight(run).tiles[WEST_GATE]).toBe(4);
  });

  it('受損與被摧毀的結構會跨夜保留', () => {
    const run = plainRun(1);
    const g = quietNight(run);
    g.structHp[WEST_WALL] = 50;
    const brokenWall = 6 * W + 5;
    g.tiles[brokenWall] = 0; // 西牆第 4 段被打穿
    g.structHp[brokenWall] = 0;
    update(g, 6);
    settleNight(run, g);
    expect(run.defense.hp[WEST_WALL]).toBe(50);
    expect(run.defense.tiles[brokenWall]).toBe(0);
    expect(openGaps(run)).toContain(brokenWall);
    expect(startNight(run).structHp[WEST_WALL]).toBe(50);
  });

  it('修築優先修血量比例最低的結構', () => {
    const run = plainRun(1);
    run.resources.wood = 10;
    run.defense.hp[WEST_WALL] = 20; // 17%
    run.bellHp = 250; // 83%
    assign(run, { 1: 'build' });
    const report = resolveDay(run);
    expect(run.defense.hp[WEST_WALL]).toBe(20 + BUILD_REPAIR);
    expect(run.bellHp).toBe(250);
    expect(report.join()).toContain('西牆第 3 段');
  });

  it('鐘樓比例更低時先修鐘樓；修好後不超過上限', () => {
    const run = plainRun(1);
    run.resources.wood = 10;
    run.defense.hp[WEST_WALL] = 100;
    run.bellHp = 30;
    assign(run, { 1: 'build' });
    resolveDay(run);
    expect(run.bellHp).toBe(30 + BUILD_REPAIR);
    expect(run.defense.hp[WEST_WALL]).toBe(100);

    const run2 = plainRun(1);
    run2.resources.wood = 10;
    run2.defense.hp[WEST_WALL] = WALL_HP - 5;
    assign(run2, { 1: 'build' });
    resolveDay(run2);
    expect(run2.defense.hp[WEST_WALL]).toBe(WALL_HP);
  });

  it('路障也能被修築修復', () => {
    const run = plainRun(1);
    run.resources.wood = 10;
    placeBarricade(run, WEST_GATE);
    run.defense.hp[WEST_GATE] = 10;
    assign(run, { 1: 'build' });
    resolveDay(run);
    expect(run.defense.hp[WEST_GATE]).toBe(10 + BUILD_REPAIR);
  });
});

describe('七夜難度', () => {
  it('預告與實際開戰使用同一份設定', () => {
    const run = plainRun(3);
    expect(startNight(run).cfg).toEqual(forecast(run));
  });

  it('預設一局七夜，第七夜才有首領', () => {
    const run = plainRun(3);
    expect(forecast(run).boss).toBe(false);
    run.night = 7;
    expect(forecast(run).boss).toBe(true);
    expect(startNight(run).cfg.boss).toBe(true);
  });

  it('夜數增加後，預告的敵人強度跟著提高', () => {
    const run = plainRun(3);
    const first = forecast(run);
    run.night = 6;
    expect(forecast(run).hpMul).toBeGreaterThan(first.hpMul);
  });
});

describe('災厄與一局', () => {
  it('預設由種子決定災厄，也可以指定', () => {
    expect(plainRun(5).disaster).toBe(plainRun(5).disaster);
    expect(plainRun(5, 7, 'wolves').disaster).toBe('wolves');
  });

  it('預告與開戰的災厄一致', () => {
    for (const d of ['undead', 'wolves', 'siege'] as const) {
      const run = plainRun(2, 7, d);
      expect(forecast(run).disaster).toBe(d);
      expect(startNight(run).cfg.disaster).toBe(d);
    }
  });

  it('狼人群的敵人真的比亡靈潮快', () => {
    const speed = (d: 'undead' | 'wolves') => {
      const g = startNight(plainRun(2, 7, d));
      g.spawnTimer = 0;
      update(g, 0.05);
      return g.enemies[0].speed;
    };
    expect(speed('wolves')).toBeGreaterThan(speed('undead'));
  });
});
