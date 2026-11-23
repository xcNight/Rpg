import { describe, expect, it } from 'vitest';
import { createRun, OVERNIGHT_RECOVERY, settleNight, startNight } from './run';
import { update } from './sim';

/** 讓當夜直接分出勝負（不下任何指令） */
function playOut(run: ReturnType<typeof createRun>) {
  const g = startNight(run);
  update(g, g.nightLength + 1);
  return g;
}

describe('一局的狀態', () => {
  it('開局從第 1 夜、完整名冊開始', () => {
    const run = createRun(1);
    expect(run.night).toBe(1);
    expect(run.roster).toHaveLength(4);
    expect(run.status).toBe('between');
  });

  it('陣亡的鎮民下一夜不會出現', () => {
    const run = createRun(1);
    const g = startNight(run);
    g.nightLength = 5;
    g.spawnTimer = 1000; // 不出怪，只驗證結算邏輯
    const victim = g.villagers.find((v) => v.id === 1)!;
    victim.alive = false;
    victim.hp = 0;
    update(g, 6);
    expect(g.phase).toBe('won');

    settleNight(run, g);
    expect(run.status).toBe('between');
    expect(run.night).toBe(2);
    expect(run.roster.map((r) => r.id)).not.toContain(1);

    const next = startNight(run);
    expect(next.villagers.map((v) => v.id)).not.toContain(1);
    expect(next.villagers).toHaveLength(3);
  });

  it('存活者帶著剩餘血量入下一夜，並獲得固定回復', () => {
    const run = createRun(1);
    const g = startNight(run);
    g.nightLength = 5;
    g.spawnTimer = 1000;
    g.villagers.find((v) => v.id === 3)!.hp = 20; // 弓手，上限 60
    g.villagers.find((v) => v.id === 4)!.alive = false; // 移除醫者，避免戰鬥中被治療影響數字
    update(g, 6);

    settleNight(run, g);
    const archer = run.roster.find((r) => r.id === 3)!;
    expect(archer.hp).toBe(20 + Math.ceil(60 * OVERNIGHT_RECOVERY));
    // 其他人本來就是滿血，回復不會超過上限
    expect(run.roster.find((r) => r.id === 1)!.hp).toBe(120);
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
      const g = startNight(run);
      g.nightLength = 5;
      g.spawnTimer = 1000;
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
    const a = createRun(5);
    const b = createRun(5);
    const ga = playOut(a);
    const gb = playOut(b);
    expect(ga.kills).toBe(gb.kills);
    expect(ga.bellHp).toBe(gb.bellHp);
  });
});
