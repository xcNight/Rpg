import { describe, expect, it } from 'vitest';
import { createRun, placeBarricade, resolveDay, Run, settleNight, startNight } from './run';
import { parseRun, serializeRun } from './save';
import { update, W } from './sim';

/** 取一份完整、合法的存檔文字，並提供修改後再序列化的方法 */
function saved(mutate?: (r: any) => void): string {
  const run = createRun(42);
  run.resources.wood = 10;
  placeBarricade(run, 7 * W + 5);
  const obj = JSON.parse(serializeRun(run));
  mutate?.(obj.run);
  return JSON.stringify(obj);
}

describe('存檔', () => {
  it('存檔後讀回，內容完全相同', () => {
    const run = createRun(42);
    run.resources.wood = 10;
    placeBarricade(run, 7 * W + 5);
    run.jobs[1] = 'scavenge';
    run.roster[0].hp = 77;
    run.fallen.push({ name: '路人', night: 1 });
    expect(parseRun(serializeRun(run))).toEqual(run);
  });

  it('讀回的存檔可以繼續玩下去：開戰、結算、進入隔天', () => {
    const run = parseRun(serializeRun(createRun(7)))!;
    resolveDay(run);
    const g = startNight(run);
    g.nightLength = 5;
    g.spawnTimer = 1000;
    update(g, 6);
    settleNight(run, g);
    expect(run.night).toBe(2);
    expect(parseRun(serializeRun(run))).toEqual(run);
  });

  it('災厄會一起存檔與讀回', () => {
    const run = createRun(42, 7, 'siege');
    expect(parseRun(serializeRun(run))!.disaster).toBe('siege');
  });

  it('舊存檔沒有災厄欄位時，視為亡靈潮', () => {
    const loaded = parseRun(saved((r) => delete r.disaster));
    expect(loaded).not.toBeNull();
    expect(loaded!.disaster).toBe('undead');
  });

  it('空值、亂碼、非物件都回傳 null', () => {
    expect(parseRun(null)).toBeNull();
    expect(parseRun('')).toBeNull();
    expect(parseRun('not json')).toBeNull();
    expect(parseRun('123')).toBeNull();
    expect(parseRun('[]')).toBeNull();
    expect(parseRun('null')).toBeNull();
    expect(parseRun('{}')).toBeNull();
  });

  it('版本不符時拒絕', () => {
    expect(parseRun(saved().replace('"v":1', '"v":2'))).toBeNull();
  });

  it('局已結束的存檔不接受（只存進行中的局）', () => {
    expect(parseRun(saved((r) => (r.status = 'won')))).toBeNull();
    expect(parseRun(saved((r) => (r.status = 'lost')))).toBeNull();
  });

  const bad: [string, (r: any) => void][] = [
    ['夜數超出範圍', (r) => (r.night = 99)],
    ['夜數為 0', (r) => (r.night = 0)],
    ['夜數不是整數', (r) => (r.night = 1.5)],
    ['缺少名冊', (r) => delete r.roster],
    ['名冊是空的', (r) => (r.roster = [])],
    ['鎮民編號重複', (r) => (r.roster[1].id = r.roster[0].id)],
    ['鎮民職業不明', (r) => (r.roster[0].kind = 'wizard')],
    ['鎮民血量為 0', (r) => (r.roster[0].hp = 0)],
    ['鎮民血量超過上限', (r) => (r.roster[0].hp = r.roster[0].maxHp + 1)],
    ['鎮民血量不是數字', (r) => (r.roster[0].hp = '120')],
    ['戰力倍率離譜', (r) => (r.roster[0].powerMul = 99)],
    ['資源為負', (r) => (r.resources.food = -1)],
    ['資源不是整數', (r) => (r.resources.wood = 1.5)],
    ['缺少資源欄位', (r) => delete r.resources.iron],
    ['鐘樓血量為 0', (r) => (r.bellHp = 0)],
    ['鐘樓血量超過上限', (r) => (r.bellHp = 99999)],
    ['地圖長度不對', (r) => r.defense.tiles.pop()],
    ['地圖格子值不合法', (r) => (r.defense.tiles[0] = 9)],
    ['鐘樓位置不是鐘樓', (r) => (r.defense.tiles[7 * W + 10] = 0)],
    ['耐久長度不對', (r) => r.defense.hp.pop()],
    ['耐久為負', (r) => (r.defense.hp[0] = -5)],
    ['工作不存在', (r) => (r.jobs[1] = 'fly')],
    ['工作指向不存在的鎮民', (r) => (r.jobs[999] = 'rest')],
    ['今日路障索引超出範圍', (r) => (r.placedToday = [99999])],
    ['統計為負', (r) => (r.kills = -1)],
    ['陣亡名單格式錯誤', (r) => (r.fallen = [{ name: 1, night: 1 }])],
    ['災厄不存在', (r) => (r.disaster = 'dragons')],
    ['nightStarted 不是布林', (r) => (r.nightStarted = 'yes')],
    ['夜數上限離譜', (r) => (r.maxNights = 1000)],
  ];
  for (const [name, mutate] of bad) {
    it(`壞存檔會被拒絕：${name}`, () => {
      expect(parseRun(saved(mutate))).toBeNull();
    });
  }

  it('沒改動的合法存檔可以通過（確認上面的拒絕不是因為範本本身有問題）', () => {
    expect(parseRun(saved())).not.toBeNull();
  });
});

describe('整局統計', () => {
  const nightOf = (run: Run, mutate?: (g: ReturnType<typeof startNight>) => void) => {
    const g = startNight(run);
    g.nightLength = 5;
    g.spawnTimer = 1000;
    mutate?.(g);
    update(g, 6);
    return g;
  };

  it('累計擊殺與城防被破壞的數量', () => {
    const run = createRun(1);
    const g1 = nightOf(run, (g) => {
      g.kills = 10;
      g.breaches = 2;
    });
    settleNight(run, g1);
    const g2 = nightOf(run, (g) => {
      g.kills = 5;
      g.breaches = 1;
    });
    settleNight(run, g2);
    expect(run.kills).toBe(15);
    expect(run.breaches).toBe(3);
  });

  it('記錄陣亡者與陣亡的夜晚', () => {
    const run = createRun(1);
    const g1 = nightOf(run, (g) => (g.villagers.find((v) => v.id === 2)!.alive = false));
    settleNight(run, g1);
    const g2 = nightOf(run, (g) => (g.villagers.find((v) => v.id === 3)!.alive = false));
    settleNight(run, g2);
    expect(run.fallen).toEqual([
      { name: '瑪莎', night: 1 },
      { name: '芬恩', night: 2 },
    ]);
  });

  it('結算後 nightStarted 一律歸零，避免讀檔時重打已結算的夜晚', () => {
    const run = createRun(1);
    run.nightStarted = true;
    settleNight(run, nightOf(run));
    expect(run.nightStarted).toBe(false);
  });
});
