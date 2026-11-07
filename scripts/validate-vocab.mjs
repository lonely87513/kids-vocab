#!/usr/bin/env node
/**
 * kids-vocab 詞庫驗證工具
 * ---------------------------------------------------------------------------
 * 用途：讀取 index.html 內的 `const vocabulary = { ... };` 資料塊，檢查
 *       每一個詞彙類別的資料完整性，避免日後加入新類別（例如 K3）時
 *       靜靜地出現缺欄位、重複字或空字串等問題。
 *
 * 執行方式：node scripts/validate-vocab.mjs
 * 結束代碼：0 = 全部檢查通過；1 = 發現問題
 *
 * 設計約束：
 *   - 只使用 Node.js 內建模組（fs / vm / url / path），無需 npm dependency
 *   - 只讀取檔案，絕不修改 index.html
 *   - 抽取資料塊時使用「括號配對掃描」，並正確跳過字串常值與註解，
 *     不會因為資料塊內出現 `};` 字面而提早截斷
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.resolve(__dirname, '..', 'index.html');

/** 從原始碼的某個位置開始掃描配對括號，回傳完整的物件字面值文字。 */
function extractBalancedLiteral(src, startIdx) {
  let depth = 0;
  let i = startIdx;
  const n = src.length;

  while (i < n) {
    const ch = src[i];

    // 字串常值：跳過內容（處理跳脫字元）
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) break;
        i += 1;
      }
      i += 1; // 跳過收尾引號
      continue;
    }

    // 行註解
    if (ch === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i += 1;
      continue;
    }

    // 區塊註解
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }

    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(startIdx, i + 1);
    }

    i += 1;
  }

  return null;
}

/** 在原始碼中找出 `const <name> = {`，並回傳該物件字面值文字。 */
function extractObjectLiteral(src, name) {
  const marker = new RegExp(`const\\s+${name}\\s*=\\s*\\{`);
  const match = marker.exec(src);
  if (!match) return null;

  const braceIdx = src.indexOf('{', match.index);
  return extractBalancedLiteral(src, braceIdx);
}

/** 與 index.html 內一致的類別判斷邏輯（獨立複寫一份，避免自我驗證）。 */
const LEARNING_CATEGORY_RE = /(?:^|[^A-Za-z0-9])K[0-9]+/;
const isLearningCategory = (cat) => Boolean(cat) && LEARNING_CATEGORY_RE.test(cat);
const isEnglishCategory = (cat) => Boolean(cat) && isLearningCategory(cat) && cat.includes('英文');
const isChineseCategory = (cat) => Boolean(cat) && isLearningCategory(cat) && cat.includes('中文');

const problems = [];
const pad = (str, width) => {
  // 以「顯示寬度」計算：CJK 字元佔 2 格
  let w = 0;
  for (const ch of String(str)) {
    w += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch)
      ? 2
      : 1;
  }
  return str + ' '.repeat(Math.max(0, width - w));
};

function main() {
  console.log('kids-vocab 詞庫驗證工具');
  console.log('='.repeat(60));
  console.log(`資料來源：${HTML_PATH}`);

  let html;
  try {
    html = readFileSync(HTML_PATH, 'utf8');
  } catch (err) {
    console.error(`❌ 無法讀取 index.html：${err.message}`);
    process.exit(1);
  }

  // ---------- 解析 vocabulary ----------
  const literal = extractObjectLiteral(html, 'vocabulary');
  if (!literal) {
    console.error('❌ 找不到 `const vocabulary = { ... };` 資料塊');
    process.exit(1);
  }

  let vocabulary;
  try {
    vocabulary = vm.runInNewContext(`(${literal})`, Object.create(null), { timeout: 5000 });
  } catch (err) {
    console.error(`❌ 解析 vocabulary 失敗：${err.message}`);
    process.exit(1);
  }

  const categories = Object.keys(vocabulary);
  console.log(`已解析類別數目：${categories.length}`);
  console.log('');

  // ---------- 檢查 1：各類別詞彙數量 ----------
  console.log('【檢查 1】各類別詞彙數量');
  let totalWords = 0;
  for (const cat of categories) {
    const list = Array.isArray(vocabulary[cat]) ? vocabulary[cat] : [];
    totalWords += list.length;
    console.log(`  ${pad(cat, 28)} ${String(list.length).padStart(4)} 個`);
    if (!Array.isArray(vocabulary[cat])) {
      problems.push(`類別「${cat}」不是陣列`);
    }
  }
  console.log(`  ${pad('合計', 28)} ${String(totalWords).padStart(4)} 個`);
  console.log('');

  // ---------- 檢查 2：同一類別內 chinese 重複 ----------
  console.log('【檢查 2】同一類別內 chinese 重複檢查');
  let dupCount = 0;
  for (const cat of categories) {
    const list = Array.isArray(vocabulary[cat]) ? vocabulary[cat] : [];
    const counter = new Map();
    list.forEach((item) => {
      const key = item && typeof item.chinese === 'string' ? item.chinese : null;
      if (key === null) return;
      counter.set(key, (counter.get(key) || 0) + 1);
    });
    const dups = [...counter.entries()].filter(([, n]) => n > 1);
    if (dups.length > 0) {
      dupCount += dups.length;
      for (const [word, n] of dups) {
        console.log(`  ❌ 「${cat}」重複字「${word}」出現 ${n} 次`);
        problems.push(`類別「${cat}」的重複字「${word}」出現 ${n} 次`);
      }
    }
  }
  if (dupCount === 0) console.log('  ✅ 未發現重複字');
  console.log('');

  // ---------- 檢查 3：缺少欄位 ----------
  console.log('【檢查 3】缺少欄位檢查（chinese / emoji / english）');
  let missingCount = 0;
  categories.forEach((cat) => {
    const list = Array.isArray(vocabulary[cat]) ? vocabulary[cat] : [];
    list.forEach((item, idx) => {
      const missing = [];
      for (const field of ['chinese', 'emoji', 'english']) {
        if (!item || typeof item !== 'object' || !(field in item) || item[field] === null || item[field] === undefined) {
          missing.push(field);
        }
      }
      // chinese / emoji 為空白字串亦視為資料不完整
      if (item && typeof item === 'object') {
        for (const field of ['chinese', 'emoji']) {
          if (typeof item[field] === 'string' && item[field].trim() === '') missing.push(`${field}(空白)`);
        }
      }
      if (missing.length > 0) {
        missingCount += 1;
        console.log(`  ❌ 類別「${cat}」索引 ${idx}：缺少 ${missing.join('、')}`);
        problems.push(`類別「${cat}」索引 ${idx} 缺少 ${missing.join('、')}`);
      }
    });
  });
  if (missingCount === 0) console.log('  ✅ 所有項目欄位完整');
  console.log('');

  // ---------- 檢查 4：english 空字串 ----------
  console.log('【檢查 4】english 空字串檢查');
  let emptyEnCount = 0;
  categories.forEach((cat) => {
    const list = Array.isArray(vocabulary[cat]) ? vocabulary[cat] : [];
    list.forEach((item, idx) => {
      if (!item || typeof item !== 'object') return;
      if (typeof item.english === 'string' && item.english.trim() === '') {
        emptyEnCount += 1;
        console.log(`  ❌ 類別「${cat}」索引 ${idx}：english 為空字串`);
        problems.push(`類別「${cat}」索引 ${idx} 的 english 為空字串`);
      }
    });
  });
  if (emptyEnCount === 0) console.log('  ✅ 未發現 english 空字串');
  console.log('');

  // ---------- 檢查 5：類別名稱統計 ----------
  console.log('【檢查 5】類別名稱統計');
  for (const cat of categories) {
    const tags = [];
    tags.push(isLearningCategory(cat) ? '學習類別' : '非學習類別');
    if (cat.includes('K2')) tags.push('含 K2');
    if (/K[0-9]+/.test(cat)) tags.push('含 K 級別標記');
    if (isChineseCategory(cat)) tags.push('中文');
    if (isEnglishCategory(cat)) tags.push('英文');
    if (cat.includes('中文') && !isChineseCategory(cat)) tags.push('含「中文」但非學習類別');
    if (cat.includes('英文') && !isEnglishCategory(cat)) tags.push('含「英文」但非學習類別');
    console.log(`  ${pad(cat, 28)} ${tags.join('、')}`);
  }
  console.log('');

  // ---------- 附加資訊：讀默（dictation）句子資料 ----------
  const dictLiteral = extractObjectLiteral(html, 'dictationSentences');
  if (dictLiteral) {
    console.log('【附加資訊】讀默句子資料（dictationSentences）');
    try {
      const dict = vm.runInNewContext(`(${dictLiteral})`, Object.create(null), { timeout: 5000 });
      for (const cat of Object.keys(dict)) {
        const list = Array.isArray(dict[cat]) ? dict[cat] : [];
        const bad = list.filter((s) => !s || typeof s.sentence !== 'string' || s.sentence.trim() === '').length;
        console.log(`  ${pad(cat, 28)} ${String(list.length).padStart(4)} 句${bad > 0 ? `（${bad} 句缺 sentence）` : ''}`);
      }
    } catch {
      console.log('  （讀默資料解析失敗，略過）');
    }
    console.log('');
  }

  // ---------- 總結 ----------
  console.log('='.repeat(60));
  if (problems.length === 0) {
    console.log('✅ 驗證通過：未發現任何問題。');
    process.exit(0);
  }
  console.log(`❌ 驗證失敗：共發現 ${problems.length} 項問題。`);
  problems.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
  process.exit(1);
}

// 直接啟動時才執行；被匯入時不執行
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
