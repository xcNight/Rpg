# 最後一夜

西方奇幻 Roguelike 守城遊戲：帶領邊境小鎮撐過七個夜晚。目前為戰鬥雛形（守一夜）。

完整設計請見 [docs/design.md](docs/design.md)。

## 開始遊玩

```bash
npm install
npm run dev
```

## 操作

- 點選鎮民（或按數字鍵 1 到 4），再點地面下令移動
- 鎮民會自動攻擊射程內的敵人；民兵會追擊駐守點附近的敵人
- 空白鍵暫停，暫停時仍可下令
- 守住鐘樓直到黎明

## 指令

| 指令 | 用途 |
|---|---|
| `npm run dev` | 啟動開發伺服器 |
| `npm test` | 執行單元測試 |
| `npm run build` | 型別檢查並建置到 `dist/` |
| `npm run build:single` | 建置並合併成單一檔案 `dist/single.html` |

測試用網址參數（使用時不讀也不寫存檔）：

- `?night=7`：直接從第 7 夜（首領戰）開始
- `?disaster=wolves`：指定災厄（`undead`、`wolves`、`siege`）
