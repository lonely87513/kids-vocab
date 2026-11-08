# 開發筆記：K2/K3 兩層分類 + 認字卡結果截圖

> 檔案：`/root/.openclaw/workspace/projects/kids-vocab/`
> 日期：2026-11-08（Asia/Taipei）
> 分支：`main`
> 版本：`v.2026-11-08-001`
> 技術棧：純靜態 HTML / CSS / JS（單一 `index.html`，內聯所有樣式與腳本，無框架、無 CDN、無 build step）

---

## 1. 目標

1. **A — 兩層分類**：把原本平鋪的分類選擇，改為「學段 → 語言 → 分類」三行式選擇器，四個遊戲共用同一份實作。
2. **B — 認字卡結果截圖**：一輪完成後可輸出 4:5 的結果圖，方便家長／老師分享。
3. 內建分類 key、詞彙資料、既有遊戲行為**一律不得改動**。

---

## 2. A — 兩層分類

### 2.1 單一真相來源

分類結構集中在 `index.html` 的 `CATEGORY_TREE`：

```js
const CATEGORY_TREE = {
    'K2': {
        '中文': ['📚 K2第二段中文', '📚 K2第三段中文'],
        '英文': ['🅰️ K2第二段英文', '🅰️ K2第三段英文']
    },
    'K3': {
        '中文': ['📚 K3第一段中文生字', '📚 K3第一段中文詞語', '📚 K3第一段中文默寫',
                '📚 K3第一段中文相反詞', '📖 K3第一段認讀句子'],
        '英文': ['🅰️ K3第一段英文', '📖 Unit 2']
    }
};
```

- 內建 11 個分類（詞彙 9 個 + 讀默句子 2 個）全部列於樹內，key 與資料未動。
- 未列入樹內者（使用者自訂字詞）歸入 `⭐ 其他`，其語言依名稱自動判斷：
  `guessLangFromCategoryName()` → 名含「英文」→ 英文；名含「中文」→ 中文；否則 → 其他。

### 2.2 Helper

| 函式 | 用途 |
|------|------|
| `getCategoryTree()` | 回傳有序結構 `[{ grade, langs: [{ lang, categories }] }]`，`⭐ 其他` 一律保留（即使暫時沒有自訂分類） |
| `getCategoriesFor(gradeKey, langKey)` | 回傳該學段＋語言底下的分類陣列 |
| `resolveCategoryLocation(cat)` | 回傳某分類所屬的 `{ grade, lang }` |
| `renderCategoryTabs(containerId, options)` | 四個遊戲共用的三行式頁籤繪製函式 |

### 2.3 選取狀態（module 級）

```js
let selectedGrade = 'K2';        // 認字卡／估估吓／配對（共用 currentCategory）
let selectedLang  = '中文';
let dictSelectedGrade = 'K3';    // 句子讀默（獨立 dictCategory）
let dictSelectedLang  = '英文';
let activeGameKey = 'flashcards'; // 供測試介面 currentGrade()/currentLang() 使用
```

- 重新進入遊戲（`showGame()`）時保留上一次選擇。
- 切換學段／語言後，若原本選中的分類不在新組合內 → 自動改選該組合中**第一個可用**分類；
  若該組合在此遊戲完全沒有可用內容，則保留原選擇並以 toast 提示。

### 2.4 三行式 UI

```
┌─────────────────────────────────────────────┐
│ 學段   [K2]  [K3]  [⭐ 其他]                │  ← 暖色底、大按鈕、高度 46px
│ 語言   [中文] [英文]                         │  ← 冷色底、高度 44px、動態顯示
│ 分類   [📚 K2第二段中文] [📚 K2第三段中文] …  │  ← 保留 .category-tab 樣式 + 橫向捲動
└─────────────────────────────────────────────┘
```

- 未選中按鈕改用柔和底色 + 深色文字，選中按鈕用高對比漸層，避免「看起來都像選中」。
- 窄屏（≤600px）保持橫向捲動，闊屏（≥900px）自動換行置中。
- `scrollActiveTabIntoView()` 維持不變，切換學段／語言後仍然生效。

### 2.5 跨遊戲一致性

四個遊戲（`fc-tabs` / `quiz-tabs` / `match-tabs` / `dict-tabs`）全部改用 `renderCategoryTabs()`，
不再各自重複一份頁籤程式碼（原本共 4 份近乎相同的迴圈）。

某個分類若不屬於目前遊戲（例如在認字卡頁籤看到 `📖 Unit 2`）：

- 該 chip 會以虛線 + 淡化樣式顯示，並於 `title` 標示「其他遊戲專用」；
- 點擊後自動切換到對應的遊戲並選取該分類，同時以 toast 說明。

---

## 3. B — 認字卡結果截圖

### 3.1 觸發與版面

- 按鈕位置：與既有 `fc-review-btn` 同一區域（`#fc-export-btn`），觸控目標 48px。
- 顯示時機：`showFinishScreen()`（進度 100%、文字「完成!」）。
- 隱藏時機：`initFlashcards()`、`startFlashcards()`、`reviewWrongCards()`（`resetFlashcardResultUI()`）。

### 3.2 繪圖

- `<canvas>` 2D 手繪，**沒有引入任何外部 library**（無 CDN、無 html2canvas）。
- 邏輯尺寸 1080 × 1350（4:5），`RESULT_CANVAS_SCALE = 2` → 實際輸出 2160 × 2700。
- 字體堆疊：`PingFang TC / Hiragino Sans GB / Microsoft JhengHei / Noto Sans CJK TC / WenQuanYi Zen Hei / Noto Color Emoji`。
- 防溢出機制：
  - `fitFontSize()` — 依 `measureText()` 逐級縮字（標題、分類名稱、錯題中英文）。
  - `wrapCanvasText()` — 逐字量度自動換行（分類名稱最多兩行）。
  - 錯題每列固定欄位（emoji / 中文 / 英文）並限制字級下限，避免文字互相重疊。

### 3.3 內容與規則

| 項目 | 規則 |
|------|------|
| 標題 | 🃏 認字卡結果 |
| 日期時間 | `YYYY年M月D日 HH:mm` |
| 學習分類 | 目前分類名稱（例：📚 K3第一段中文生字） |
| 成績 | ✅ 答對 N／❌ 答錯 M＋正確率百分比 |
| 星星 | ≥90% → 3 粒；≥70% → 2 粒；其餘 → 1 粒 |
| 錯題清單 | emoji＋中文＋英文，最多 10 題；超出於標題右側顯示「…等 N 題」 |
| 底部 | 🎮 孖寶學字詞 · Kids Vocab |

### 3.4 輸出流程

```
點擊「📸 輸出結果截圖」
   ├─ renderResultCanvas() → canvas.toDataURL('image/png') → lastResultPng
   ├─ dataUrlToBlob()（同步轉換，確保 iOS 的使用者手勢限制）
   ├─ navigator.share + File（canShare 為 true）→ 分享面板；使用者取消 → 結果預覽
   ├─ 否則 <a download="認字卡結果-YYYY-MM-DD.png"> 下載
   └─ 下載失敗 → <img> 結果預覽＋「長按圖片即可儲存到相簿 📷」
```

所有分支都有 toast 提示，不會靜靜失敗。

### 3.5 測試介面

```js
window.__kidsVocab = {
    renderResultCanvas, lastResultPng, currentGrade(), currentLang(),
    selectedCategory(), flashcardWords(), resultStats(), setResultForTest(),
    vocabulary, categoryTree(), getCategoriesFor(), resolveCategoryLocation()
};
```

---

## 4. 驗證

### 4.1 自動驗證：`node verify-grouping.mjs`

- 自動啟動 `python3 -m http.server 8126 --bind 127.0.0.1`（如已在運行則沿用）。
- 41 項檢查全部通過：頁籤結構、學段／語言切換、跨遊戲一致性、資料來源正確性、
  完成畫面按鈕、PNG 產生、星星規則、資料無損、console/pageerror = 0。
- 截圖輸出至 `.shots/`：
  `group-fc-k2-zh.png`、`group-fc-k3-en.png`、`group-mobile-390.png`、
  `group-flashcard-done.png`、`group-result-image.png`（另加 `group-result-overflow.png` 作版面壓力測試）。

### 4.2 詞庫驗證：`node scripts/validate-vocab.mjs`

> **注意（既有問題，非本次引入）**
> 驗證腳本在 `HEAD`（改動前）已經失敗，共 8 項重複字：
> `📚 K2第二段中文` 的「高樓」，以及 `🅰️ K2第二段英文` 的「一／七／八／九／十／我／係」。
>
> 這些重複字屬於既有教材內容（例如「一」同時對應 `one` 與 `a`），而本次任務明確要求
> 「分類資料不得更動、不得刪除字詞」，因此**未修改資料**，只以程式比對確認資料與
> `git HEAD` **逐字相同**，`validate-vocab.mjs` 的輸出亦與改動前完全一致（退出碼同為 1）。
> 如需修正，應另開一項任務與家長確認教材內容。

---

## 5. 已知限制 / 後續建議

1. `validate-vocab.mjs` 的重複字檢查未區分「同字不同義」（例如 `一` = one / a），
   建議日後加入 `chinese + english` 複合鍵比對，並與家長確認是否真的需要重複條目。
2. 結果圖為 2 倍渲染（2160 × 2700），PNG 約 1.7MB；如需更輕量可改為 1.5 倍或輸出 JPEG。
3. `navigator.share` 在桌面瀏覽器多數不支援，實際會走下載流程；iOS Safari 支援分享。
4. 句子讀默在 K2 學段沒有句子內容，會顯示 toast 提示；如日後新增 K2 讀默句子，只需在
   `CATEGORY_TREE` 補上分類名稱即可，無需修改其他程式碼。
5. 自訂分類以 `localStorage` 儲存，跨裝置不會同步（既有行為）。
