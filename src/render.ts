// 畫面繪製：只讀取遊戲狀態，不修改它。
import { BARRICADE_HP, BELL, Game, H, RING, VILLAGER_STATS, W, WALL_HP } from './game/sim';

export const TILE = 40;

const VILLAGER_COLOR = { militia: '#4f8fd9', archer: '#57b36a', healer: '#e3c04f' } as const;
const VILLAGER_GLYPH = { militia: '民', archer: '弓', healer: '醫' } as const;

function bar(ctx: CanvasRenderingContext2D, cx: number, top: number, w: number, ratio: number, color: string) {
  ctx.fillStyle = '#000a';
  ctx.fillRect(cx - w / 2, top, w, 4);
  ctx.fillStyle = color;
  ctx.fillRect(cx - w / 2, top, w * Math.max(0, ratio), 4);
}

function unit(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, glyph: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#111';
  ctx.font = `bold ${Math.round(r * 1.15)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, x, y + 1);
}

export function render(ctx: CanvasRenderingContext2D, g: Game, selectedId: number | null, daylight = false): void {
  // 地圖
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = g.tiles[y * W + x];
      const inside = x > 5 && x < 14 && y > 3 && y < 11;
      ctx.fillStyle =
        t === 1 ? '#6b6f7a' : t === 4 ? '#9a7a45' : t === 3 ? '#7a5a3c' : inside ? '#3b3f35' : (x + y) % 2 ? '#24331f' : '#263622';
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      if (t === 1 || t === 3 || t === 4) {
        ctx.strokeStyle = '#0006';
        ctx.strokeRect(x * TILE + 0.5, y * TILE + 0.5, TILE - 1, TILE - 1);
      }
      if (t === 4) {
        // 路障：交叉木條
        ctx.strokeStyle = '#4a3410';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x * TILE + 6, y * TILE + 6);
        ctx.lineTo((x + 1) * TILE - 6, (y + 1) * TILE - 6);
        ctx.moveTo((x + 1) * TILE - 6, y * TILE + 6);
        ctx.lineTo(x * TILE + 6, (y + 1) * TILE - 6);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
      // 受損的城牆與路障顯示耐久條
      if (t === 1 || t === 4) {
        const max = t === 1 ? WALL_HP : BARRICADE_HP;
        const hp = g.structHp[y * W + x];
        if (hp < max) bar(ctx, (x + 0.5) * TILE, y * TILE + 3, TILE - 10, hp / max, '#e8c34f');
      }
    }
  }

  // 白天：用虛線框出城牆環上開著的缺口（可以封堵的位置）
  if (daylight) {
    ctx.strokeStyle = '#ffe9a8';
    ctx.setLineDash([5, 4]);
    for (const i of RING) {
      if (g.tiles[i] !== 0) continue;
      ctx.strokeRect((i % W) * TILE + 3, Math.floor(i / W) * TILE + 3, TILE - 6, TILE - 6);
    }
    ctx.setLineDash([]);
  }

  // 鐘樓
  const bx = (BELL.x + 0.5) * TILE;
  const by = (BELL.y + 0.5) * TILE;
  ctx.fillStyle = '#c9a24a';
  ctx.fillRect(BELL.x * TILE + 4, BELL.y * TILE + 4, TILE - 8, TILE - 8);
  ctx.fillStyle = '#111';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('鐘', bx, by + 1);

  // 被選取鎮民的射程與目的地
  const sel = g.villagers.find((v) => v.id === selectedId && v.alive);
  if (sel) {
    ctx.strokeStyle = '#fff5';
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(sel.x * TILE, sel.y * TILE, VILLAGER_STATS[sel.kind].range * TILE, 0, Math.PI * 2);
    ctx.stroke();
    if (sel.path.length > 0) {
      ctx.beginPath();
      ctx.moveTo(sel.x * TILE, sel.y * TILE);
      for (const p of sel.path) ctx.lineTo(p.x * TILE, p.y * TILE);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // 敵人
  for (const e of g.enemies) {
    unit(ctx, e.x * TILE, e.y * TILE, 11, '#b0503f', '屍');
    if (e.hp < e.maxHp) bar(ctx, e.x * TILE, e.y * TILE - 18, 22, e.hp / e.maxHp, '#e0553f');
  }

  // 鎮民
  for (const v of g.villagers) {
    if (!v.alive) continue;
    const x = v.x * TILE;
    const y = v.y * TILE;
    if (v.id === selectedId) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 17, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    unit(ctx, x, y, 14, VILLAGER_COLOR[v.kind], VILLAGER_GLYPH[v.kind]);
    bar(ctx, x, y - 22, 28, v.hp / v.maxHp, '#6fdc6f');
  }

  // 攻擊與治療特效
  for (const fx of g.effects) {
    ctx.strokeStyle = fx.kind === 'heal' ? '#8dffb0' : fx.kind === 'shot' ? '#ffe9a8' : '#ffffff';
    ctx.lineWidth = fx.kind === 'hit' ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(fx.x1 * TILE, fx.y1 * TILE);
    ctx.lineTo(fx.x2 * TILE, fx.y2 * TILE);
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  // 夜色：越接近黎明越亮
  // 白天不加夜色，並略微提亮
  if (daylight) {
    ctx.fillStyle = 'rgba(255, 244, 200, 0.08)';
    ctx.fillRect(0, 0, W * TILE, H * TILE);
    return;
  }
  const dark = 0.35 * (1 - g.time / g.nightLength);
  ctx.fillStyle = `rgba(10, 14, 40, ${Math.max(0, dark)})`;
  ctx.fillRect(0, 0, W * TILE, H * TILE);
}
