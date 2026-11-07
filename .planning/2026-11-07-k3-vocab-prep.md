# 計劃：kids-vocab 為 K3 新詞庫做代碼預備

> 檔案：`/root/.openclaw/workspace/projects/kids-vocab/`
> 日期：2026-11-07（Asia/Taipei）
> 分支：`feature/k3-vocab`（由最新 `origin/master` 建立）
> 線上版本：https://lonely87513.github.io/kids-vocab/
> 技術棧：純靜態 HTML / CSS / JS（單一 `index.html`，內聯所有樣式與腳本）

---

## 1. 背景與目標

Nathan 日後會為小朋友加入 **K3 新詞庫**（內容尚未提供）。本次工作只做「代碼層預備」：

- **不加入任何 K3 詞彙內容**
- **不建立空白的 K3 類別**
- 只將原本寫死於 `K2` 的類別判斷邏輯，改造成與年級無關的通用判斷

目標：日後新增 `📚 K3…中文` / `🅰️ K3…英文` 類別時，**不需要再修改任何程式碼**，新類別即可自動獲得現有的全部功能：

| 功能 | 對應程式碼 | 依賴的判斷 |
|---|---|---|
| 數量滑桿（題數選擇） | `initFlashcards` / `initQuiz` / `switchQuizCategory` | 學習類別判斷 |
| 認字卡正面顯示中文字 | `renderCard` | 中文類別判斷 |
| TTS 讀音（粵語 / 英文） | `renderCard` / `renderQuiz` / `initMatching` | 中／英文類別判斷 |
| 估估吓（選擇題）出題方向 | `renderQuiz` | 中／英文類別判斷 |
| 配對遊戲文字卡語言 | `initMatching` | 英文類別判斷 |

---

## 2. 今次改動摘要

### 2.1 `index.html`：類別判斷邏輯通用化

新增三個通用 helper（取代原本只針對 K2 的寫死判斷）：

```js
// 類別名稱包含 K1 / K2 / K3 … 等年級標記即屬學習類別
const LEARNING_CATEGORY_RE = /(?:^|[^A-Za-z0-9])K[0-9]+/;

function isLearningCategory(cat) {          // 學習類別？（K2 / K3 / 日後 K4 …）
    if (!cat) return false;
    return LEARNING_CATEGORY_RE.test(cat);
}
function isEnglishCategory(cat) {           // 英文類別？
    if (!cat) return false;
    return isLearningCategory(cat) && cat.includes('英文');
}
function isChineseCategory(cat) {           // 中文類別？
    if (!cat) return false;
    return isLearningCategory(cat) && cat.includes('中文');
}
```

保留原有三個函式作為**向後相容 wrapper**，內部改為 delegate 至新的通用 helper，同時維持原有語意不變：

```js
function isK2Category(cat) {
    if (!cat) return false;
    return isLearningCategory(cat) && (cat.includes('K2第二段') || cat.includes('K2第三段'));
}
function isK2English(cat) { /* 同上，delegate 至 isEnglishCategory */ }
function isK2Chinese(cat) { /* 同上，delegate 至 isChineseCategory */ }
```

**呼叫點替換**（共 7 處）：

| 位置 | 改動前 | 改動後 |
|---|---|---|
| `initFlashcards` | `isK2Category(...)` | `isLearningCategory(...)` |
| `initQuiz` | `isK2Category(...)` | `isLearningCategory(...)` |
| `switchQuizCategory` | `isK2Category(...)` | `isLearningCategory(...)` |
| `renderCard` | `isK2English` / `isK2Chinese` | `isEnglishCategory` / `isChineseCategory` |
| `showFinishScreen` | `isK2English(...)` | `isEnglishCategory(...)` |
| `renderQuiz` | `isK2English` / `isK2Chinese` | `isEnglishCategory` / `isChineseCategory` |
| `initMatching` | `isK2English(...)` | `isEnglishCategory(...)` |

> 註：三處原本名為 `isLearningCategory` 的**區域變數**會與新的同名函式產生時序（TDZ）衝突，故一律改為 `isLearningCat`。

**未改動的項目**：UI 版面、字體大小、顏色、遊戲邏輯、詞庫資料、HTML 結構，全部保持原狀。

### 2.2 `scripts/validate-vocab.mjs`：詞庫驗證腳本（新增）

用途：在加入新詞庫之前，先以程式檢查資料完整性，避免缺欄位、重複字或空字串等問題被帶到線上版本。

執行方式：

```bash
node scripts/validate-vocab.mjs
```

結束代碼：`0` = 全部通過；`1` = 發現問題（並列出問題清單）。

檢查項目：

1. **各類別詞彙數量** — 列出每個類別的字數與總數
2. **同一類別內 `chinese` 重複** — 列出重複字與出現次數
3. **缺少欄位** — 列出類別、索引與缺少的欄位（`chinese` / `emoji` / `english`）
4. **`english` 為空字串** — 列出類別與索引
5. **類別名稱統計** — 標示各類別是否屬學習類別、是否含 K 級別標記、中文或英文
6. （附加資訊）**讀默句子資料** `dictationSentences` 的句數統計

技術細節：

- 只使用 Node.js 內建模組（`fs` / `vm` / `url` / `path`），**無需 npm dependency**
- 以「括號配對掃描」抽取 `const vocabulary = { ... };`，並正確跳過字串常值與註解，不會因為資料塊內出現 `};` 字面而提早截斷
- 以 `vm.runInNewContext` 將資料塊解析成 JavaScript 物件，**唯讀**、不修改 `index.html`
- 類別判斷邏輯在腳本內獨立複寫一份（而非直接引用 `index.html`），避免自我驗證

### 2.3 `.planning/2026-11-07-k3-vocab-prep.md`：本文件（新增）

---

## 3. 日後加入 K3 詞庫的標準流程

1. **取得原始資料** — Nathan 傳送圖片或文字（K3 中文詞表 / K3 英文詞表）
2. **OCR / 轉錄** — 由圖片抽取文字，核對字形（繁體字、粵語用字）
3. **整理為統一結構** — 每個詞彙轉為一個物件，三個欄位缺一不可：

   ```js
   { chinese: '日', emoji: '☀️', english: 'Sun/Day' }
   ```

   - `chinese`：中文詞（必填）
   - `emoji`：對應 emoji（必填）
   - `english`：英文對照（必填，不可以留空字串）

4. **加入新類別** — 在 `index.html` 的 `const vocabulary = { ... }` 內新增類別，命名沿用現有慣例：

   ```js
   '📚 K3第二段中文': [ /* ... */ ],
   '🅰️ K3第二段英文': [ /* ... */ ],
   ```

   命名規則（必須符合，否則通用 helper 不會生效）：

   | 規則 | 說明 | 例子 |
   |---|---|---|
   | 包含年級標記 | 必須有 `K` + 數字 | `K3` |
   | 語言標記 | 中文類別須含「中文」，英文類別須含「英文」 | `📚 K3第二段中文` |
   | 建議格式 | 前置符號 + `K3` + 段別 + 語言 | `📚 K3第二段中文` / `🅰️ K3第三段英文` |

   > 只要類別名稱帶有 `K3` 這類年級標記並標明「中文」或「英文」，現有的數量滑桿、認字卡正面顯示中文字、TTS 讀音、估估吓、配對功能會自動生效，**不需要修改任何程式碼**。

5. **執行驗證腳本**：

   ```bash
   node scripts/validate-vocab.mjs
   ```

   必須以結束代碼 `0` 通過；若出現重複字或缺欄位，先修正資料再繼續。

6. **本地驗證** — 在瀏覽器開啟 `index.html`（或用本地伺服器），逐項確認：

   - 新類別分頁（認字卡 / 估估吓 / 配對）出現
   - 數量滑桿顯示並可正確限制題數
   - 認字卡正面顯示中文詞、翻面顯示英文詞
   - 點擊讀音按鈕可正常發聲（中文用 `zh-HK`，英文用 `en`）
   - 估估吓出題方向正確（中文類別問中文，英文類別問英文）
   - 配對遊戲文字卡顯示正確語言
   - 既有 5 個類別的行為**完全沒有變化**

7. **提交** — 在 `feature/k3-vocab` 分支（或 Nathan 指定的路徑）建立一個 atomic commit：

   ```bash
   git add index.html scripts/validate-vocab.mjs .planning/
   git commit -m "feat: add K3 vocabulary sets (Chinese + English)"
   ```

8. **推送與部署** — 經主 session 審核後推送至 `master`，等待 GitHub Pages 自動部署完成，再到線上版本複核第 6 步的項目。

---

## 4. 驗證清單（本次代碼預備已完成）

| # | 驗證項目 | 方法 | 結果 |
|---|---|---|---|
| 1 | `index.html` 內 `<script>` 語法正確 | 抽出 script 內容成臨時 `.js` 後執行 `node --check` | ✅ 通過（單一 script 區塊） |
| 2 | 詞庫驗證腳本可正常執行 | `node scripts/validate-vocab.mjs` | ✅ 成功解析 4 個類別、220 個詞彙；並偵測到 8 項**既有**重複字問題 |
| 3 | 既有 5 個類別行為完全不變 | 載入 `origin/master` 舊版 helper 與新版 helper 逐一比對 | ✅ 15 個測試案例全部一致 |
| 4 | 向後相容 wrapper 語意不變 | `isK2Category` / `isK2English` / `isK2Chinese` 新舊逐項比對 | ✅ 15 個測試案例全部一致 |
| 5 | K3 類別可被通用 helper 自動支援 | 以 5 個假想 K3 類別名測試 | ✅ 全部符合預期 |
| 6 | 改動範圍受控 | `git diff --stat`、`git status` | ✅ 僅 `index.html` + 兩個新增檔案 |

### 本次驗證所發現的既有資料問題（**非本次改動造成**，待 Nathan 決定是否處理）

`node scripts/validate-vocab.mjs` 在 `origin/master` 舊版檔案上執行結果完全相同（同樣 8 項），證明這些重複字在改動前已存在：

| 類別 | 重複字 | 出現次數 |
|---|---|---|
| `📚 K2第二段中文` | 高樓 | 2 |
| `🅰️ K2第二段英文` | 一、七、八、九、十、我、係 | 各 2 |

> 註：`🅰️ K2第二段英文` 內的重複字，可能是同一個中文詞對應了兩個不同英文（例如一／一 individual 與 one），屬「教學上合理但技術上重複」的情況。是否合併或保留，須由 Nathan 決定；本次不擅自修改詞庫資料。

---

## 5. 已知限制

1. **類別名稱格式必須符合約定** — 通用 helper 依賴「年級標記 + 語言標記」。若日後 K3 類別命名為不含 `K3` 的名稱（例如 `📚 第三段中文`），將不會被視為學習類別，數量滑桿等功能不會出現。
2. **`isK2Category` 等 wrapper 維持 K2 專屬語意** — 這是刻意的：確保舊有呼叫點（含日後可能的自訂字詞流程）行為完全不變。K3 類別請改用 `isLearningCategory` / `isEnglishCategory` / `isChineseCategory`。
3. **驗證腳本只檢查 `vocabulary` 資料塊** — `dictationSentences`（讀默句子）目前只有句數統計，並未做逐句欄位驗證（其資料結構為 `sentence` / `hint`，與詞庫不同）。
4. **本次未做瀏覽器端自動化測試** — 驗證以靜態語法檢查與 helper 等價比對為主；UI 行為需由第 6 步的本地瀏覽器驗證覆蓋。
5. **本次未推送** — 分支 `feature/k3-vocab` 只在本地，推送與部署由主 session 審核後決定。
