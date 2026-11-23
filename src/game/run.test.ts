import { describe, expect, it } from 'vitest';
import {
  BUILD_REPAIR,
  BUILD_WOOD_COST,
  createRun,
  HEAL_AMOUNT,
  Job,
  resolveDay,
  Run,
  settleNight,
  startNight,
  TRAIN_BONUS,
} from './run';
import { BELL_MAX_HP, update } from './sim';

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
    const run = createRun(1);
    expect(run.night).toBe(1);
    expect(run.roster).toHaveLength(4);
    expect(run.status).toBe('between');
    expect(run.bellHp).toBe(BELL_MAX_HP);
    expect(Object.keys(run.jobs)).toHaveLength(4);
  });

  it('陣亡的鎮民下一夜不會出現，工作安排也一併清除', () => {
    const run = createRun(1);
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
    expect(startNight(run).villagers).toHaveLength(3);
  });

  it('存活者帶著剩餘血量入下一夜，沒有自動回復', () => {
    const run = createRun(1);
    const g = quietNight(run);
    g.villagers.find((v) => v.id === 3)!.hp = 20;
    g.villagers.find((v) => v.id === 4)!.alive = false; // 移除醫者，避免戰鬥中被治療
    update(g, 6);
    settleNight(run, g);
    expect(run.roster.find((r) => r.id === 3)!.hp).toBe(20);
  });

  it('鐘樓受損會帶到下一夜', () => {
    const run = createRun(1);
    const g = quietNight(run);
    g.bellHp = 123;
    update(g, 6);
    settleNight(run, g);
    expect(run.bellHp).toBe(123);
    expect(startNight(run).bellHp).toBe(123);
  });

  it('鐘樓倒塌時整局結束', () => {
    const run = createRun(1);
    const g = startNight(run);
    g.bellHp = 0;
    update(g, 0.1);
    expect(g.phase).toBe('lost');
    settleNight(run, g);
    expect(run.status).toBe('lost');
  });

  it('全員陣亡時整局結束', () => {
    const run = createRun(1);
    const g = startNight(run);
    for (const v of g.villagers) v.alive = false;
    g.phase = 'won'; // 即使夜晚撐到天亮，沒有人也算失敗
    settleNight(run, g);
    expect(run.status).toBe('lost');
  });

  it('撐過最後一夜即通關，不再增加夜數', () => {
    const run = createRun(1, 2);
    for (let i = 0; i < 2; i++) {
      const g = quietNight(run);
      update(g, 6);
      settleNight(run, g);
    }
    expect(run.status).toBe('won');
    expect(run.night).toBe(2);
  });

  it('夜晚未結束時不能結算', () => {
    const run = createRun(1);
    expect(() => settleNight(run, startNight(run))).toThrow();
  });

  it('同一個種子的整局可重現', () => {
    const play = () => {
      const run = createRun(5);
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
      const run = createRun(9);
      assign(run, { 1: 'scavenge', 2: 'scavenge' });
      return run;
    };
    const a = make();
    const b = make();
    const before = { ...a.resources };
    resolveDay(a);
    resolveDay(b);
    expect(a.resources).toEqual(b.resources);
    expect(a.resources.wood).toBeGreaterThan(before.wood);
    expect(a.resources.food).toBeGreaterThan(before.food);
  });

  it('搜刮有機會受傷，但血量不會低於 1', () => {
    const run = createRun(3);
    for (const r of run.roster) r.hp = 1;
    assign(run, { 1: 'scavenge', 2: 'scavenge', 3: 'scavenge', 4: 'scavenge' });
    resolveDay(run);
    for (const r of run.roster) expect(r.hp).toBeGreaterThanOrEqual(1);
  });

  it('修築消耗木石並修復鐘樓，不超過上限', () => {
    const run = createRun(1);
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
    const run = createRun(1);
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
    const run = createRun(1);
    assign(run, { 1: 'train' });
    resolveDay(run);
    const g = quietNight(run);
    expect(g.villagers.find((v) => v.id === 1)!.powerMul).toBe(TRAIN_BONUS);
    expect(g.villagers.find((v) => v.id === 2)!.powerMul).toBe(1);

    update(g, 6);
    settleNight(run, g);
    expect(startNight(run).villagers.every((v) => v.powerMul === 1)).toBe(true);
  });

  it('訓練後的民兵一擊的傷害確實更高', () => {
    const strike = (mul: number) => {
      const run = createRun(1);
      run.roster[0].powerMul = mul;
      const g = startNight(run);
      g.spawnTimer = 1000;
      for (const o of g.villagers.slice(1)) o.alive = false; // 只留一位，排除其他人的攻擊
      const v = g.villagers[0];
      g.enemies.push({ id: 999, x: v.x + 0.5, y: v.y, hp: 1000, maxHp: 1000, cd: 99, ox: 0, oy: 0, alive: true });
      update(g, 0.1);
      return 1000 - g.enemies[0].hp;
    };
    expect(strike(TRAIN_BONUS)).toBeCloseTo(strike(1) * TRAIN_BONUS);
  });

  it('治療會補最需要的「其他」鎮民，不補自己', () => {
    const run = createRun(1);
    run.roster[0].hp = 100; // 葛雷 100/120
    run.roster[2].hp = 10; // 芬恩 10/60，比例最低
    assign(run, { 1: 'train', 2: 'train', 3: 'train', 4: 'heal' }); // 艾琳治療，其他人不休息
    run.roster[3].hp = 20; // 艾琳自己也受傷，但不能治療自己
    resolveDay(run);
    expect(run.roster[2].hp).toBe(10 + HEAL_AMOUNT);
    expect(run.roster[3].hp).toBe(20);
  });

  it('休息回復自身血量，不超過上限', () => {
    const run = createRun(1);
    run.roster[0].hp = 10; // 葛雷 10/120
    run.roster[2].hp = 50; // 芬恩 50/60
    resolveDay(run); // 預設全員休息
    expect(run.roster[0].hp).toBe(70);
    expect(run.roster[2].hp).toBe(60);
  });

  it('搜刮的木石當天就能拿來修築', () => {
    const run = createRun(1);
    run.resources.wood = 0;
    run.bellHp = 100;
    assign(run, { 1: 'scavenge', 2: 'scavenge', 3: 'scavenge', 4: 'build' });
    resolveDay(run);
    // 三人搜刮至少帶回 3 木石，足夠支付修築的 2
    expect(run.bellHp).toBe(140);
  });
});
