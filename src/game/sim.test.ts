import { describe, expect, it } from 'vitest';
import { BELL, createGame, findPath, orderMove, passable, update } from './sim';

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
