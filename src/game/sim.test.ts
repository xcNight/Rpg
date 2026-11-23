import { describe, expect, it } from 'vitest';
import {
  BARRICADE_HP,
  BELL,
  BOSS_SPAWN_TIME,
  BOSS_STATS,
  createDefense,
  createGame,
  findPath,
  nightConfig,
  NEUTRAL_CONFIG,
  orderMove,
  passable,
  spawnEnemyAt,
  tileLabel,
  update,
  W,
} from './sim';

const GATES = [7 * W + 5, 7 * W + 14, 11 * W + 10, 3 * W + 9]; // 西、東、南、北門

describe('地圖與尋路', () => {
  it('鐘樓與城牆不可通行，缺口可通行', () => {
    const g = createGame();
    expect(passable(g, BELL.x, BELL.y)).toBe(false);
    expect(passable(g, 5, 4)).toBe(false);
    expect(passable(g, 5, 7)).toBe(true);
  });

  it('牆外可以經由缺口走到牆內', () => {
    const g = createGame();
    const path = findPath(g, { x: 0.5, y: 0.5 }, 9, 7);
    expect(path).not.toBeNull();
    for (const p of path!) expect(passable(g, p.x, p.y)).toBe(true);
  });

  it('不能命令鎮民走進城牆', () => {
    const g = createGame();
    expect(orderMove(g, 1, 5, 4)).toBe(false);
  });

  it('鎮民會走到被指派的格子', () => {
    const g = createGame();
    g.nightLength = 1000;
    g.spawnTimer = 1000;
    expect(orderMove(g, 3, 8, 5)).toBe(true);
    update(g, 10);
    const v = g.villagers.find((u) => u.id === 3)!;
    expect(v.x).toBeCloseTo(8.5);
    expect(v.y).toBeCloseTo(5.5);
  });
});

describe('夜晚戰鬥', () => {
  it('沒有守軍時鐘樓會被摧毀', () => {
    const g = createGame(7);
    for (const v of g.villagers) v.alive = false;
    update(g, g.nightLength);
    expect(g.phase).toBe('lost');
    expect(g.bellHp).toBe(0);
  });

  it('守軍會擊殺敵人，夜晚一定會分出勝負', () => {
    const g = createGame(7);
    update(g, g.nightLength + 1);
    expect(g.phase).not.toBe('night');
    expect(g.kills).toBeGreaterThan(0);
  });

  it('相同種子的結果完全相同', () => {
    const a = createGame(42);
    const b = createGame(42);
    update(a, 60);
    for (let i = 0; i < 600; i++) update(b, 0.1);
    expect(a.kills).toBe(b.kills);
    expect(a.bellHp).toBe(b.bellHp);
  });

  it('醫者會治療受傷的同伴', () => {
    const g = createGame();
    g.spawnTimer = 1000;
    const militia = g.villagers[0];
    const healer = g.villagers[3];
    healer.x = militia.x + 1;
    healer.y = militia.y;
    healer.anchor = { x: healer.x, y: healer.y };
    militia.hp = 50;
    update(g, 2);
    expect(militia.hp).toBeGreaterThan(50);
  });
});

describe('城牆與路障', () => {
  const sealedDefense = (gates: number[]) => {
    const d = createDefense();
    for (const i of gates) {
      d.tiles[i] = 4;
      d.hp[i] = BARRICADE_HP;
    }
    return d;
  };

  it('敵人尋路：走缺口比破路障便宜，全封死時仍然走得到鐘樓', () => {
    const open = createGame(1, [], 300, sealedDefense([]));
    const west = createGame(1, [], 300, sealedDefense([GATES[0]]));
    const all = createGame(1, [], 300, sealedDefense(GATES));
    const outsideWest = 7 * W + 4;
    expect(west.flow[outsideWest]).toBeGreaterThan(open.flow[outsideWest]);
    expect(Number.isFinite(all.flow[outsideWest])).toBe(true);
    // 西門被封後，從西側來的敵人寧可繞去開著的南門，也不破路障
    expect(west.flow[outsideWest]).toBeLessThan(all.flow[outsideWest] + 100);
  });

  it('全部封死時，敵人會打穿路障：耐久歸零後變成缺口', () => {
    const g = createGame(3, [], 300, sealedDefense(GATES));
    g.nightLength = 120;
    update(g, 60);
    expect(g.breaches).toBeGreaterThan(0);
    const broken = GATES.filter((i) => g.tiles[i] === 0);
    expect(broken.length).toBe(g.breaches);
    for (const i of broken) expect(g.structHp[i]).toBe(0);
  });

  it('沒有人守時，破口後鐘樓會被攻擊', () => {
    const g = createGame(3, [], 300, sealedDefense(GATES));
    update(g, 90);
    expect(g.bellHp).toBeLessThan(300);
  });

  it('被打穿的缺口，村民可以穿過走出去', () => {
    const g = createGame(1, undefined, 300, sealedDefense(GATES));
    expect(findPath(g, { x: 8.5, y: 7.5 }, 2, 7)).toBeNull(); // 四門全封時走不出去
    g.tiles[GATES[0]] = 0;
    expect(findPath(g, { x: 8.5, y: 7.5 }, 2, 7)).not.toBeNull();
  });

  it('城牆耐久是獨立的資料，建立遊戲時不會改到傳入的城防', () => {
    const d = sealedDefense([GATES[0]]);
    const g = createGame(1, [], 300, d);
    g.structHp[GATES[0]] = 1;
    g.tiles[GATES[1]] = 4;
    expect(d.hp[GATES[0]]).toBe(BARRICADE_HP);
    expect(d.tiles[GATES[1]]).toBe(0);
  });

  it('城牆環格子有名稱', () => {
    expect(tileLabel(GATES[0])).toBe('西門');
    expect(tileLabel(5 * W + 5)).toBe('西牆第 3 段');
  });
});

describe('夜晚難度', () => {
  it('難度逐夜上升：血量、攻擊、速度提高，出怪間隔縮短', () => {
    const cfgs = [1, 2, 3, 4, 5, 6, 7].map((n) => nightConfig(1, n, 7));
    for (let i = 1; i < cfgs.length; i++) {
      expect(cfgs[i].hpMul).toBeGreaterThan(cfgs[i - 1].hpMul);
      expect(cfgs[i].powerMul).toBeGreaterThan(cfgs[i - 1].powerMul);
      expect(cfgs[i].speedMul).toBeGreaterThan(cfgs[i - 1].speedMul);
      expect(cfgs[i].spawnScale).toBeLessThan(cfgs[i - 1].spawnScale);
    }
  });

  it('前兩夜只有兩個來襲方向，之後三個；同一個種子結果固定', () => {
    for (let seed = 1; seed <= 20; seed++) {
      expect(nightConfig(seed, 1, 7).sides).toHaveLength(2);
      expect(nightConfig(seed, 2, 7).sides).toHaveLength(2);
      for (let n = 3; n <= 7; n++) expect(nightConfig(seed, n, 7).sides).toHaveLength(3);
    }
    expect(nightConfig(5, 1, 7)).toEqual(nightConfig(5, 1, 7));
  });

  it('不同種子會抽到不同的方向組合', () => {
    const combos = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) combos.add(nightConfig(seed, 1, 7).sides.join());
    expect(combos.size).toBeGreaterThan(1);
  });

  it('只有最後一夜有首領', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => nightConfig(1, n, 7).boss)).toEqual([
      false, false, false, false, false, false, true,
    ]);
    expect(nightConfig(1, 1, 1).boss).toBe(false); // 單夜的局不算首領戰
  });

  it('敵人只從當夜的來襲方向出現', () => {
    const g = createGame(1, [], 300, undefined, { ...NEUTRAL_CONFIG, sides: ['west'] });
    g.spawnTimer = 0;
    update(g, 0.05);
    expect(g.enemies).toHaveLength(1);
    expect(g.enemies[0].x).toBeLessThan(1);
  });

  it('越後面的夜晚，敵人越強', () => {
    const make = (night: number) => {
      const g = createGame(1, [], 300, undefined, nightConfig(1, night, 7));
      return spawnEnemyAt(g, 0.5, 5.5);
    };
    const early = make(1);
    const late = make(6);
    expect(late.hp).toBeGreaterThan(early.hp);
    expect(late.power).toBeGreaterThan(early.power);
    expect(late.speed).toBeGreaterThan(early.speed);
  });
});

describe('首領戰', () => {
  const bossGame = () => {
    const g = createGame(2, [], 300, undefined, nightConfig(2, 7, 7));
    g.spawnTimer = 1000; // 排除小怪，只看首領
    return g;
  };

  it('首領在固定時間點現身，且不受夜晚倍率影響', () => {
    const g = bossGame();
    update(g, BOSS_SPAWN_TIME - 1);
    expect(g.enemies.some((e) => e.kind === 'boss')).toBe(false);
    update(g, 2);
    const boss = g.enemies.find((e) => e.kind === 'boss')!;
    expect(boss).toBeDefined();
    expect(boss.maxHp).toBe(BOSS_STATS.hp);
    expect(boss.power).toBe(BOSS_STATS.power);
  });

  it('首領存活時，夜晚繼續到天亮', () => {
    const g = bossGame();
    update(g, BOSS_SPAWN_TIME + 5);
    expect(g.phase).toBe('night');
  });

  it('擊殺首領就提前天亮', () => {
    const g = bossGame();
    update(g, BOSS_SPAWN_TIME + 1);
    g.enemies.find((e) => e.kind === 'boss')!.alive = false;
    update(g, 0.1);
    expect(g.phase).toBe('won');
    expect(g.time).toBeLessThan(g.nightLength);
  });

  it('首領出現前不會誤判為擊殺', () => {
    const g = bossGame();
    update(g, BOSS_SPAWN_TIME - 5);
    expect(g.phase).toBe('night');
  });

  it('沒有首領的夜晚，不會因為「沒有首領」而提前結束', () => {
    const g = createGame(2, [], 300, undefined, nightConfig(2, 3, 7));
    g.spawnTimer = 1000;
    update(g, 30);
    expect(g.phase).toBe('night');
  });

  it('首領會破牆：被封死的缺口擋不住它太久', () => {
    const d = createDefense();
    for (const i of GATES) {
      d.tiles[i] = 4;
      d.hp[i] = BARRICADE_HP;
    }
    const g = createGame(2, [], 300, d, { ...NEUTRAL_CONFIG, boss: true, sides: ['west'] });
    g.spawnTimer = 1000;
    update(g, BOSS_SPAWN_TIME + 45);
    expect(g.breaches).toBeGreaterThan(0);
  });
});
