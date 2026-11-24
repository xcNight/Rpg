import { describe, expect, it } from 'vitest';
import { createRun, foodNeeded, makeRoster, resolveDay, Run } from './run';
import { BAD_TRAITS, GOOD_TRAITS, ORIGIN_INFO, ORIGIN_LIST, TRAIT_INFO } from './people';
import { parseRun, serializeRun } from './save';
import {
  createGame,
  DEFAULT_ROSTER,
  orderMove,
  RosterEntry,
  spawnEnemyAt,
  update,
  VILLAGER_STATS,
  WALL_HP,
} from './sim';
import type { Disaster } from './disaster';

const plainRun = (seed: number, disaster?: Disaster) =>
  createRun(seed, 7, disaster, DEFAULT_ROSTER.map((r) => ({ ...r })));

describe('隨機名冊', () => {
  it('同一個種子得到同一批人，不同種子不同', () => {
    expect(makeRoster(7)).toEqual(makeRoster(7));
    const sigs = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) sigs.add(JSON.stringify(makeRoster(seed)));
    expect(sigs.size).toBeGreaterThan(25);
  });

  it('戰鬥職業的組成固定：3 民兵、2 弓手、1 醫者，編號 1 到 6', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const r = makeRoster(seed);
      expect(r.map((m) => m.id)).toEqual([1, 2, 3, 4, 5, 6]);
      const count = (k: string) => r.filter((m) => m.kind === k).length;
      expect([count('militia'), count('archer'), count('healer')]).toEqual([3, 2, 1]);
    }
  });

  it('名字不重複；出身一定與職業相符', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const r = makeRoster(seed);
      expect(new Set(r.map((m) => m.name)).size).toBe(6);
      for (const m of r) expect(ORIGIN_INFO[m.origin].kinds).toContain(m.kind);
    }
  });

  it('六個特質：3 好 3 壞，彼此不重複', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const traits = makeRoster(seed).map((m) => m.trait);
      expect(new Set(traits).size).toBe(6);
      expect(traits.filter((t) => GOOD_TRAITS.includes(t))).toHaveLength(3);
      expect(traits.filter((t) => BAD_TRAITS.includes(t))).toHaveLength(3);
    }
  });

  it('每種出身與特質都有機會出現', () => {
    const origins = new Set<string>();
    const traits = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      for (const m of makeRoster(seed)) {
        origins.add(m.origin);
        traits.add(m.trait);
      }
    }
    expect([...origins].sort()).toEqual([...ORIGIN_LIST].sort());
    expect([...traits].sort()).toEqual([...GOOD_TRAITS, ...BAD_TRAITS].sort());
  });

  it('強壯與體弱會改變最大血量，且開局是滿血', () => {
    for (let seed = 1; seed <= 100; seed++) {
      for (const m of makeRoster(seed)) {
        const base = VILLAGER_STATS[m.kind].hp;
        expect(m.maxHp).toBe(Math.round(base * (TRAIT_INFO[m.trait].hpMul ?? 1)));
        expect(m.hp).toBe(m.maxHp);
      }
    }
  });

  it('一局預設使用種子抽出的名冊，也可以指定名冊', () => {
    expect(createRun(9).roster).toEqual(makeRoster(9));
    expect(plainRun(9).roster).toEqual(DEFAULT_ROSTER);
    expect(Object.keys(createRun(9).jobs)).toHaveLength(6);
  });
});

/** 以指定的特質建立夜戰：只有名冊中的人，位置依序為各起始格 */
const entry = (over: Partial<RosterEntry> & { id: number }): RosterEntry => ({
  kind: 'militia',
  name: `測${over.id}`,
  hp: 120,
  maxHp: 120,
  origin: 'guard',
  trait: 'none',
  ...over,
});

describe('特質：夜晚', () => {
  it('夜眼：射程 +1，能打到平常打不到的敵人', () => {
    const shoot = (trait: 'none' | 'nightEye') => {
      const g = createGame(1, [entry({ id: 1, kind: 'archer', hp: 60, maxHp: 60, origin: 'hunter', trait })]);
      g.spawnTimer = 1000;
      const v = g.villagers[0];
      const foe = spawnEnemyAt(g, v.x + 5.5, v.y); // 弓手射程 5，夜眼 6
      foe.cd = 99;
      const before = foe.hp;
      update(g, 0.1);
      return before - foe.hp;
    };
    expect(shoot('none')).toBe(0);
    expect(shoot('nightEye')).toBeGreaterThan(0);
  });

  it('勇猛：戰鬥力 +20%', () => {
    const strike = (trait: 'none' | 'brave') => {
      const g = createGame(1, [entry({ id: 1, trait })]);
      g.spawnTimer = 1000;
      const v = g.villagers[0];
      const foe = spawnEnemyAt(g, v.x + 0.5, v.y);
      foe.hp = foe.maxHp = 1000;
      foe.cd = 99;
      update(g, 0.1);
      return 1000 - foe.hp;
    };
    expect(strike('brave')).toBeCloseTo(strike('none') * 1.2);
  });

  it('迅捷：移動速度 +30%', () => {
    const travelled = (trait: 'none' | 'swift') => {
      const g = createGame(1, [entry({ id: 1, trait })]);
      g.spawnTimer = 1000;
      const v = g.villagers[0];
      v.x = 6.5;
      v.y = 8.5;
      expect(orderMove(g, 1, 13, 8)).toBe(true);
      update(g, 1);
      return v.x - 6.5;
    };
    // 沿格子路徑移動時，每過一格會損失一點剩餘步長，所以比值只會接近 1.3
    const plain = travelled('none');
    const swift = travelled('swift');
    expect(swift).toBeGreaterThan(plain * 1.2);
    expect(swift).toBeLessThan(plain * 1.4);
  });

  it('膽小：附近同伴倒下時逃回鐘樓，較遠的不受影響', () => {
    const roster = [
      entry({ id: 1, trait: 'timid' }), // 起始 (6.5,7.5)，離陣亡者 2.8 格
      entry({ id: 2, trait: 'timid' }), // 起始 (13.5,7.5)，離陣亡者超過 4 格
      entry({ id: 3 }), // 一般
      entry({ id: 4 }), // 一般
      entry({ id: 5, hp: 1 }), // 起始 (8.5,9.5)，會被殺
    ];
    const g = createGame(1, roster);
    g.spawnTimer = 1000;
    const victim = g.villagers[4];
    const e = spawnEnemyAt(g, victim.x, victim.y);
    e.power = 100;
    e.cd = 0;
    update(g, 0.1);
    expect(victim.alive).toBe(false);
    expect(g.villagers[0].fleeTimer).toBeGreaterThan(0);
    expect(g.villagers[1].fleeTimer).toBe(0);
    expect(g.villagers[2].fleeTimer).toBe(0);

    // 逃跑期間往鐘樓移動，結束後恢復
    const t0 = g.villagers[0];
    const d0 = Math.hypot(t0.x - 10.5, t0.y - 8.5);
    update(g, 1);
    expect(Math.hypot(t0.x - 10.5, t0.y - 8.5)).toBeLessThan(d0);
    update(g, 6);
    expect(t0.fleeTimer).toBe(0);
  });

  it('膽小的鎮民在逃跑時不戰鬥', () => {
    const g = createGame(1, [entry({ id: 1, trait: 'timid' })]);
    g.spawnTimer = 1000;
    const v = g.villagers[0];
    v.fleeTimer = 5;
    const foe = spawnEnemyAt(g, v.x + 0.5, v.y);
    foe.hp = foe.maxHp = 1000;
    foe.cd = 99;
    update(g, 1);
    expect(foe.hp).toBe(1000);
  });
});

describe('特質與出身：白天', () => {
  const withRoster = (seed: number, patch: (r: Run) => void) => {
    const run = plainRun(seed);
    patch(run);
    return run;
  };

  it('鐵匠修築量 ×1.5，勤勞 +30%，懶散 −30%', () => {
    const repaired = (patch: (r: Run) => void) => {
      const run = withRoster(1, (r) => {
        r.resources.wood = 10;
        const i = 5 * 20 + 5; // 西牆第 3 段
        r.defense.hp[i] = 10;
        r.jobs[1] = 'build';
        patch(r);
      });
      resolveDay(run);
      return run.defense.hp[5 * 20 + 5] - 10;
    };
    expect(repaired(() => {})).toBe(40);
    expect(repaired((r) => (r.roster[0].origin = 'smith'))).toBe(60);
    expect(repaired((r) => (r.roster[0].trait = 'diligent'))).toBe(52);
    expect(repaired((r) => (r.roster[0].trait = 'lazy'))).toBe(28);
    expect(repaired((r) => {
      r.roster[0].origin = 'smith';
      r.roster[0].trait = 'diligent';
    })).toBe(78);
  });

  it('修女治療量 ×1.5，勤勞與懶散同樣適用', () => {
    const healed = (trait: 'none' | 'diligent' | 'lazy') => {
      const run = withRoster(1, (r) => {
        for (const m of r.roster) r.jobs[m.id] = 'train';
        r.jobs[4] = 'heal';
        r.roster[3].trait = trait;
        r.roster[0].hp = 1;
      });
      resolveDay(run);
      return run.roster[0].hp - 1;
    };
    expect(healed('none')).toBe(60);
    expect(healed('diligent')).toBe(78);
    expect(healed('lazy')).toBe(42);
  });

  it('農夫、獵人、小偷搜刮各有加成（同種子下與衛兵對照）', () => {
    const haul = (origin: 'guard' | 'farmer' | 'hunter' | 'thief') => {
      const run = withRoster(3, (r) => {
        r.jobs[3] = 'scavenge';
        r.roster[2].origin = origin;
      });
      const before = { ...run.resources };
      const food = (run: Run) => run.resources.food;
      resolveDay(run);
      return { wood: run.resources.wood - before.wood, food: food(run) - before.food, iron: run.resources.iron - before.iron };
    };
    const base = haul('guard');
    expect(haul('farmer').food - base.food).toBe(2);
    const hunter = haul('hunter');
    expect(hunter.food - base.food).toBe(1);
    expect(hunter.wood - base.wood).toBe(1);
    expect(haul('thief').iron - base.iron).toBe(2);
  });

  it('小偷搜刮時受傷機率大約只有一半', () => {
    const injuries = (origin: 'guard' | 'thief') => {
      let n = 0;
      for (let seed = 1; seed <= 400; seed++) {
        const run = withRoster(seed, (r) => {
          r.jobs[3] = 'scavenge';
          r.roster[2].origin = origin;
        });
        resolveDay(run);
        if (run.roster[2].hp < 60) n++;
      }
      return n;
    };
    const guard = injuries('guard');
    const thief = injuries('thief');
    expect(thief).toBeGreaterThan(0);
    expect(thief).toBeLessThan(guard * 0.7);
  });

  it('貪吃的鎮民每晚吃 2 份', () => {
    const run = plainRun(1);
    expect(foodNeeded(run)).toBe(6);
    run.roster[0].trait = 'glutton';
    expect(foodNeeded(run)).toBe(7);
    run.roster[1].trait = 'glutton';
    expect(foodNeeded(run)).toBe(8);
    run.resources.food = 20;
    for (const m of run.roster) run.jobs[m.id] = 'train';
    resolveDay(run);
    expect(run.resources.food).toBe(12);
  });

  it('缺糧時挨餓的人數不會超過鎮民人數', () => {
    const run = plainRun(1);
    for (const m of run.roster) {
      m.trait = 'glutton';
      run.jobs[m.id] = 'train';
    }
    run.resources.food = 0;
    run.resources.iron = 6;
    const report = resolveDay(run);
    expect(report.join()).toContain('挨餓');
    for (const m of run.roster) expect(m.hp).toBeLessThan(m.maxHp);
  });

  it('牆的耐久上限不受影響（確認測試用的位置正確）', () => {
    expect(WALL_HP).toBe(120);
  });
});

describe('存檔：出身與特質', () => {
  it('隨機名冊存檔後讀回相同', () => {
    const run = createRun(77);
    expect(parseRun(serializeRun(run))).toEqual(run);
  });

  const mutate = (fn: (r: any) => void) => {
    const obj = JSON.parse(serializeRun(createRun(77)));
    fn(obj.run);
    return JSON.stringify(obj);
  };

  it('舊存檔沒有出身與特質時，依職業補預設值並視為平凡', () => {
    const loaded = parseRun(
      mutate((r) => {
        for (const m of r.roster) {
          delete m.origin;
          delete m.trait;
        }
      }),
    )!;
    expect(loaded).not.toBeNull();
    for (const m of loaded.roster) {
      expect(m.trait).toBe('none');
      expect(ORIGIN_INFO[m.origin].kinds).toContain(m.kind);
    }
  });

  it('未知的出身或特質、職業不符的出身都會被拒絕', () => {
    expect(parseRun(mutate((r) => (r.roster[0].origin = 'wizard')))).toBeNull();
    expect(parseRun(mutate((r) => (r.roster[0].trait = 'lucky')))).toBeNull();
    expect(parseRun(mutate((r) => (r.roster[0].trait = 5)))).toBeNull();
    // 第 1 位一定是民兵，修女出身不符
    expect(parseRun(mutate((r) => (r.roster[0].origin = 'nun')))).toBeNull();
  });
});
