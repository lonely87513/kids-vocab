#!/usr/bin/env node
/**
 * kids-vocab 兩層分類 + 認字卡結果截圖 — 自動驗證腳本
 * ---------------------------------------------------------------------------
 * 驗證內容：
 *   1. console error = 0、pageerror = 0
 *   2. fc-tabs 三行結構（學段 / 語言 / 分類），預設 K2/中文 只有兩個分類
 *   3. 切到 K3/英文 → 分類列見「🅰️ K3第一段英文」與「📖 Unit 2」
 *   4. 切換分類後 flashcardWords 確實來自新分類
 *   5. quiz-tabs / match-tabs / dict-tabs 同樣有三行結構
 *   6. 認字卡答完整輪 → 出現「📸 輸出結果截圖」按鈕
 *   7. 點擊按鈕 → 產生 PNG（lastResultPng 為 dataURL 且長度 > 10KB）
 *   8. 詞彙資料與 git HEAD 完全一致（資料無損）+ validate-vocab.mjs 結果一致
 *   9. 輸出 5 張截圖到 .shots/
 *
 * 執行方式：node verify-grouping.mjs
 * 結束代碼：0 = 全部通過；1 = 有項目失敗
 */

import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = __dirname;
const SHOT_DIR = path.join(PROJECT_DIR, '.shots');
const PORT = 8126;
const BASE_URL = `http://127.0.0.1:${PORT}/index.html`;

// ---------- Playwright 載入（優先本機 node_modules，否則用 /tmp/cube-verify） ----------
const require = createRequire(import.meta.url);
function loadPlaywright() {
    const candidates = [
        'playwright',
        '/tmp/cube-verify/node_modules/playwright',
        '/tmp/cube-verify/node_modules/playwright-core'
    ];
    for (const c of candidates) {
        try { return require(c); } catch (e) { /* 試下一個 */ }
    }
    throw new Error('找不到 playwright 模組（已嘗試：' + candidates.join(', ') + '）');
}
const { chromium, devices } = loadPlaywright();

// ---------- 小工具 ----------
const results = [];
function check(name, ok, detail = '') {
    results.push({ name, ok: Boolean(ok), detail });
    console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
    return ok;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function serverAlive() {
    return new Promise(resolve => {
        const req = http.get(`http://127.0.0.1:${PORT}/index.html`, res => {
            res.resume();
            resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(1500, () => { req.destroy(); resolve(false); });
    });
}

// ---------- 驗證詞彙資料無損（與 git HEAD 逐字比較）----------
function extractDataBlocks(src) {
    const out = {};
    for (const name of ['vocabulary', 'dictationSentences']) {
        const marker = new RegExp(`const\\s+${name}\\s*=\\s*\\{`);
        const m = marker.exec(src);
        if (!m) { out[name] = null; continue; }
        const start = src.indexOf('{', m.index);
        let depth = 0, i = start;
        const n = src.length;
        while (i < n) {
            const ch = src[i];
            if (ch === "'" || ch === '"' || ch === '`') {
                const q = ch; i++;
                while (i < n) { if (src[i] === '\\') { i += 2; continue; } if (src[i] === q) break; i++; }
                i++; continue;
            }
            if (ch === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
            if (ch === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
            if (ch === '{') depth++;
            else if (ch === '}') { depth--; if (depth === 0) { out[name] = src.slice(start, i + 1); break; } }
            i++;
        }
    }
    return out;
}

function validateVocabOutput() {
    try {
        const out = execFileSync(process.execPath, [path.join(PROJECT_DIR, 'scripts/validate-vocab.mjs')], {
            cwd: PROJECT_DIR, encoding: 'utf8'
        });
        return { code: 0, out };
    } catch (err) {
        return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
    }
}

function validateVocabHeadOutput() {
    const tmpDir = '/tmp/kv_validate_head';
    try {
        execFileSync('rm', ['-rf', tmpDir]);
        mkdirSync(tmpDir, { recursive: true });
        execFileSync('mkdir', ['-p', path.join(tmpDir, 'scripts')]);
        const headHtml = execFileSync('git', ['show', 'HEAD:index.html'], { cwd: PROJECT_DIR, encoding: 'utf8' });
        const headScript = execFileSync('git', ['show', 'HEAD:scripts/validate-vocab.mjs'], { cwd: PROJECT_DIR, encoding: 'utf8' });
        writeFileSync(path.join(tmpDir, 'index.html'), headHtml);
        writeFileSync(path.join(tmpDir, 'scripts/validate-vocab.mjs'), headScript);
        try {
            const out = execFileSync(process.execPath, [path.join(tmpDir, 'scripts/validate-vocab.mjs')], { cwd: tmpDir, encoding: 'utf8' });
            return { code: 0, out };
        } catch (err) {
            return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
        }
    } catch (e) {
        return { code: -1, out: `無法驗證 HEAD 版本：${e.message}` };
    }
}

// ---------- 主流程 ----------
async function main() {
    console.log('kids-vocab 兩層分類 + 結果截圖 — 自動驗證');
    console.log('='.repeat(64));
    console.log(`專案目錄：${PROJECT_DIR}`);

    if (!existsSync(SHOT_DIR)) mkdirSync(SHOT_DIR, { recursive: true });

    // --- 伺服器 ---
    let server = null;
    if (await serverAlive()) {
        console.log(`ℹ️ 伺服器已在 http://127.0.0.1:${PORT} 運行，沿用現有服務`);
    } else {
        console.log(`ℹ️ 啟動測試伺服器：python3 -m http.server ${PORT} --bind 127.0.0.1`);
        server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
            cwd: PROJECT_DIR, stdio: 'ignore', detached: false
        });
        let ready = false;
        for (let i = 0; i < 40; i++) {
            await sleep(250);
            if (await serverAlive()) { ready = true; break; }
        }
        if (!ready) { console.error('❌ 伺服器無法啟動'); process.exit(1); }
    }

    const browser = await chromium.launch({ args: ['--font-render-hinting=none'] });
    const consoleErrors = [];
    const pageErrors = [];

    const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        deviceScaleFactor: 1,
        acceptDownloads: true
    });
    const page = await context.newPage();
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => pageErrors.push(String(err && err.message ? err.message : err)));

    try {
        await page.goto(BASE_URL, { waitUntil: 'load' });
        await page.waitForTimeout(300);

        // ============ 1. 進入認字卡遊戲 ============
        await page.click('button.btn-flashcards');
        await page.waitForTimeout(200);

        // ============ 2. fc-tabs 三行結構 ============
        const fcRows = await page.$$eval('#fc-tabs > .cat-row', rows => rows.map(r => ({
            row: r.dataset.row,
            grade: [...r.querySelectorAll('.cat-grade-btn')].map(b => b.textContent.trim()),
            lang: [...r.querySelectorAll('.cat-lang-btn')].map(b => b.textContent.trim()),
            cats: [...r.querySelectorAll('.category-tab')].map(b => b.textContent.trim())
        })));
        const gradeRow = fcRows.find(r => r.row === 'grade');
        const langRow = fcRows.find(r => r.row === 'lang');
        const catRow = fcRows.find(r => r.row === 'categories');
        check('2.1 fc-tabs 有三行（學段／語言／分類）', fcRows.length === 3, `實際 ${fcRows.length} 行`);
        check('2.2 第一行有 K2 / K3', !!gradeRow && gradeRow.grade.includes('K2') && gradeRow.grade.includes('K3'), JSON.stringify(gradeRow && gradeRow.grade));
        check('2.2b 第一行有 ⭐ 其他', !!gradeRow && gradeRow.grade.includes('⭐ 其他'), JSON.stringify(gradeRow && gradeRow.grade));
        check('2.3 第二行有 中文 / 英文', !!langRow && langRow.lang.includes('中文') && langRow.lang.includes('英文'), JSON.stringify(langRow && langRow.lang));
        check('2.4 第三行只列 K2/中文 兩個分類',
            !!catRow && catRow.cats.length === 2 && catRow.cats.includes('📚 K2第二段中文') && catRow.cats.includes('📚 K2第三段中文'),
            JSON.stringify(catRow && catRow.cats));

        // 學段按鈕觸控目標 ≥44px
        const gradeBtnHeight = await page.$eval('#fc-tabs .cat-grade-btn', el => el.getBoundingClientRect().height);
        check('2.5 學段按鈕高度 ≥44px', gradeBtnHeight >= 44, `${gradeBtnHeight.toFixed(1)}px`);

        // ============ 3. 切到 K3/英文 ============
        await page.click('#fc-tabs .cat-grade-btn[data-grade="K3"]');
        await page.waitForTimeout(150);
        await page.click('#fc-tabs .cat-lang-btn[data-lang="英文"]');
        await page.waitForTimeout(200);
        const k3EnCats = await page.$$eval('#fc-tabs .cat-row-cats .category-tab', els => els.map(e => e.textContent.trim()));
        check('3.1 K3/英文 第三行見 🅰️ K3第一段英文', k3EnCats.includes('🅰️ K3第一段英文'), JSON.stringify(k3EnCats));
        check('3.2 K3/英文 第三行見 📖 Unit 2', k3EnCats.includes('📖 Unit 2'), JSON.stringify(k3EnCats));

        // 3.3 ⭐ 其他（未有自訂分類時仍應有按鈕，且不應當機）
        await page.click('#fc-tabs .cat-grade-btn[data-grade="⭐ 其他"]');
        await page.waitForTimeout(250);
        const otherState = await page.evaluate(() => ({
            grade: window.__kidsVocab.currentGrade(),
            cats: [...document.querySelectorAll('#fc-tabs .cat-row-cats .category-tab')].map(e => e.textContent.trim()),
            emptyHint: (document.querySelector('#fc-tabs .cat-row-cats') || {}).textContent || ''
        }));
        check('3.3 ⭐ 其他 可選且不會當機', otherState.grade === '⭐ 其他', `grade=${otherState.grade}`);
        await page.click('#fc-tabs .cat-grade-btn[data-grade="K3"]');
        await page.waitForTimeout(150);
        await page.click('#fc-tabs .cat-lang-btn[data-lang="英文"]');
        await page.waitForTimeout(200);

        // ============ 4. 切換分類後 flashcardWords 來自新分類 ============
        await page.click('#fc-tabs .cat-row-cats .category-tab[data-category="🅰️ K3第一段英文"]');
        await page.waitForTimeout(250);
        const catCheck = await page.evaluate(() => ({
            cat: window.__kidsVocab.selectedCategory(),
            grade: window.__kidsVocab.currentGrade(),
            lang: window.__kidsVocab.currentLang(),
            quantityText: document.getElementById('fc-quantity-display').textContent
        }));
        check('4.1 切換分類後 currentCategory = 🅰️ K3第一段英文', catCheck.cat === '🅰️ K3第一段英文', catCheck.cat);
        check('4.3 currentGrade / currentLang = K3 / 英文', catCheck.grade === 'K3' && catCheck.lang === '英文', `${catCheck.grade} / ${catCheck.lang}`);

        // 學習分類需先設定題目數量再開始，開始後才會產生 flashcardWords
        await page.$eval('#fc-quantity-slider', el => {
            el.value = '3';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.click('#fc-start-btn');
        await page.waitForTimeout(300);
        const wordsCheck = await page.evaluate(() => {
            const cat = window.__kidsVocab.selectedCategory();
            const words = window.__kidsVocab.flashcardWords();
            const pool = window.__kidsVocab.vocabulary[cat] || [];
            const key = w => `${w.chinese}|${w.english}|${w.emoji}`;
            const poolKeys = new Set(pool.map(key));
            return {
                cat,
                count: words.length,
                allFromCat: words.length > 0 && words.every(w => poolKeys.has(key(w)))
            };
        });
        check('4.2 flashcardWords 全部來自新分類', wordsCheck.allFromCat, `${wordsCheck.count} 張卡，來源 ${wordsCheck.cat}`);

        // ============ 5. 其他三個遊戲同樣有三行結構 ============
        for (const [btn, tabId, label] of [
            ['button.btn-quiz', 'quiz-tabs', '估估吓'],
            ['button.btn-matching', 'match-tabs', '配對'],
            ['button.btn-dictation', 'dict-tabs', '句子讀默']
        ]) {
            await page.click(btn);
            await page.waitForTimeout(200);
            const rows = await page.$$eval(`#${tabId} > .cat-row`, rs => rs.map(r => r.dataset.row));
            const hasGrade = await page.$$eval(`#${tabId} .cat-grade-btn`, bs => bs.length >= 2);
            const hasLang = await page.$$eval(`#${tabId} .cat-lang-btn`, bs => bs.length >= 1);
            const hasCat = await page.$$eval(`#${tabId} .category-tab`, bs => bs.length >= 1);
            check(`5.${label} ${tabId} 有三行結構`, rows.length === 3 && hasGrade && hasLang && hasCat, `rows=${JSON.stringify(rows)}`);
        }

        // 5.4 點擊其他遊戲專屬的分類 → 自動切換到對應遊戲
        await page.click('button.btn-dictation');
        await page.waitForTimeout(200);
        await page.click('#dict-tabs .cat-row-cats .category-tab[data-category="🅰️ K3第一段英文"]');
        await page.waitForTimeout(300);
        const switched = await page.evaluate(() => ({
            flashcardsActive: document.getElementById('flashcards').classList.contains('active'),
            category: window.__kidsVocab.selectedCategory()
        }));
        check('5.4 點擊其他遊戲專屬分類會自動切換到對應遊戲',
            switched.flashcardsActive === true && switched.category === '🅰️ K3第一段英文',
            JSON.stringify(switched));

        // ============ 6. 認字卡完成畫面 + 輸出按鈕 ============
        // （第 4 步已開始一輪 3 題的認字卡）
        await page.click('button.btn-flashcards');
        await page.waitForTimeout(200);
        await page.click('#fc-tabs .cat-grade-btn[data-grade="K3"]');
        await page.waitForTimeout(120);
        await page.click('#fc-tabs .cat-lang-btn[data-lang="英文"]');
        await page.waitForTimeout(120);
        await page.click('#fc-tabs .cat-row-cats .category-tab[data-category="🅰️ K3第一段英文"]');
        await page.waitForTimeout(200);

        const exportVisibleBefore = await page.$eval('#fc-export-btn', el => getComputedStyle(el).display !== 'none');
        check('6.1 未完成時「輸出結果截圖」按鈕隱藏', exportVisibleBefore === false);

        // 設定題目數量 = 3 並開始
        await page.$eval('#fc-quantity-slider', el => {
            el.value = '3';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.click('#fc-start-btn');
        await page.waitForTimeout(250);

        // 答題：✅、❌、✅（2 對 1 錯 → 正確率 67% → 1 粒星）
        const answers = ['markCorrect()', 'markWrong()', 'markCorrect()'];
        for (const fn of answers) {
            const btn = await page.$(`#fc-buttons button[onclick="${fn}"]`);
            if (!btn) { check('6.2 答題按鈕存在', false, fn); break; }
            await btn.click();
            await page.waitForTimeout(180);
        }
        await page.waitForTimeout(300);

        const exportVisibleAfter = await page.$eval('#fc-export-btn', el => getComputedStyle(el).display !== 'none');
        const exportText = await page.$eval('#fc-export-btn', el => el.textContent.trim());
        const progressText = await page.$eval('#fc-progress', el => el.textContent.trim());
        check('6.2 完成後「輸出結果截圖」按鈕出現', exportVisibleAfter === true);
        check('6.3 按鈕文字正確', exportText.includes('📸 輸出結果截圖'), exportText);
        check('6.4 進度顯示 100% / 完成!', progressText.includes('完成'), progressText);
        const exportBtnBox = await page.$eval('#fc-export-btn button', el => {
            const r = el.getBoundingClientRect();
            return { w: r.width, h: r.height };
        });
        check('6.5 輸出按鈕觸控目標 ≥44px', exportBtnBox.h >= 44, `${exportBtnBox.w.toFixed(0)}×${exportBtnBox.h.toFixed(0)}`);

        // ============ 7. 點擊輸出 → 產生 PNG ============
        const downloadPromise = page.waitForEvent('download', { timeout: 4000 }).catch(() => null);
        await page.click('#fc-export-btn button');
        await page.waitForTimeout(1200);
        const download = await downloadPromise;
        if (download) {
            console.log(`   ↳ 已觸發下載：${download.suggestedFilename()}`);
        }
        const pngInfo = await page.evaluate(() => {
            const png = window.__kidsVocab.lastResultPng;
            return {
                isDataUrl: typeof png === 'string' && png.startsWith('data:image/png;base64,'),
                length: typeof png === 'string' ? png.length : 0,
                stats: window.__kidsVocab.resultStats(),
                previewShown: getComputedStyle(document.getElementById('fc-result-preview')).display !== 'none'
            };
        });
        check('7.1 lastResultPng 為 PNG dataURL', pngInfo.isDataUrl === true);
        check('7.2 lastResultPng 長度 > 10KB', pngInfo.length > 10240, `${(pngInfo.length / 1024).toFixed(1)}KB`);
        check('7.3 成績統計正確（2 對 1 錯 → 67% → 1 粒星）',
            pngInfo.stats.accuracy === 67 && pngInfo.stats.stars === 1, JSON.stringify(pngInfo.stats));
        check('7.4 結果預覽（長按儲存備案）已顯示', pngInfo.previewShown === true);

        // 7.5 星星規則（≥90% 三粒、≥70% 兩粒、其餘一粒）
        const starRules = await page.evaluate(() => {
            const api = window.__kidsVocab;
            const cases = [[9, 1, 90, 3], [7, 3, 70, 2], [6, 4, 60, 1], [10, 0, 100, 3]];
            return cases.map(([c, w, acc, stars]) => {
                api.setResultForTest(c, w, []);
                const s = api.resultStats();
                return { c, w, acc, stars, realAcc: s.accuracy, realStars: s.stars, ok: s.accuracy === acc && s.stars === stars };
            });
        });
        check('7.5 星星規則正確（≥90%→3、≥70%→2、其餘→1）', starRules.every(r => r.ok), JSON.stringify(starRules.map(r => `${r.c}/${r.w}:${r.realAcc}%/${r.realStars}★`)));
        await page.evaluate(() => {
            const api = window.__kidsVocab;
            api.setResultForTest(2, 1, (api.vocabulary['🅰️ K3第一段英文'] || []).slice(0, 1));
        });

        // ============ 8. 詞彙資料無損 + validate-vocab 結果一致 ============
        const curHtml = readFileSync(path.join(PROJECT_DIR, 'index.html'), 'utf8');
        const headHtml = execFileSync('git', ['show', 'HEAD:index.html'], { cwd: PROJECT_DIR, encoding: 'utf8' });
        const curBlocks = extractDataBlocks(curHtml);
        const headBlocks = extractDataBlocks(headHtml);
        check('8.1 vocabulary 資料與 git HEAD 完全一致', curBlocks.vocabulary === headBlocks.vocabulary);
        check('8.2 dictationSentences 資料與 git HEAD 完全一致', curBlocks.dictationSentences === headBlocks.dictationSentences);

        const now = validateVocabOutput();
        const before = validateVocabHeadOutput();
        const sameProblem = (a, b) => {
            const pick = s => (s.split('\n').filter(l => l.trim().startsWith('❌') || l.includes('驗證通過') || l.includes('驗證失敗')).join('\n'));
            return pick(a.out) === pick(b.out);
        };
        check('8.3 validate-vocab.mjs 結果與改動前一致（資料無損）', sameProblem(now, before), `改動前 code=${before.code} / 改動後 code=${now.code}`);
        console.log(`   ↳ validate-vocab.mjs：改動前 ${before.code === 0 ? '通過' : '失敗（既有問題）'}，改動後 ${now.code === 0 ? '通過' : '失敗（既有問題）'}`);

        // ============ 9. 截圖 ============
        // 9.1 K2/中文 三行頁籤（桌面）
        await page.click('#fc-tabs .cat-grade-btn[data-grade="K2"]');
        await page.waitForTimeout(150);
        await page.click('#fc-tabs .cat-lang-btn[data-lang="中文"]');
        await page.waitForTimeout(200);
        const fcBox = await page.$eval('#fc-tabs', el => {
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
        });
        await page.screenshot({
            path: path.join(SHOT_DIR, 'group-fc-k2-zh.png'),
            clip: { x: Math.max(0, fcBox.x - 8), y: Math.max(0, fcBox.y - 8), width: Math.min(1280, fcBox.width + 16), height: fcBox.height + 16 }
        });
        check('9.1 已輸出 group-fc-k2-zh.png', existsSync(path.join(SHOT_DIR, 'group-fc-k2-zh.png')));

        // 9.2 K3/英文 三行頁籤（桌面）
        await page.click('#fc-tabs .cat-grade-btn[data-grade="K3"]');
        await page.waitForTimeout(150);
        await page.click('#fc-tabs .cat-lang-btn[data-lang="英文"]');
        await page.waitForTimeout(200);
        const fcBox2 = await page.$eval('#fc-tabs', el => {
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
        });
        await page.screenshot({
            path: path.join(SHOT_DIR, 'group-fc-k3-en.png'),
            clip: { x: Math.max(0, fcBox2.x - 8), y: Math.max(0, fcBox2.y - 8), width: Math.min(1280, fcBox2.width + 16), height: fcBox2.height + 16 }
        });
        check('9.2 已輸出 group-fc-k3-en.png', existsSync(path.join(SHOT_DIR, 'group-fc-k3-en.png')));

        // 9.5 結果圖本身（由 renderResultCanvas() 輸出）
        const resultPng = await page.evaluate(() => {
            window.__kidsVocab.renderResultCanvas();
            return window.__kidsVocab.lastResultPng;
        });
        writeFileSync(path.join(SHOT_DIR, 'group-result-image.png'), Buffer.from(resultPng.split(',')[1], 'base64'));
        check('9.5 已輸出 group-result-image.png', existsSync(path.join(SHOT_DIR, 'group-result-image.png')));

        // 9.6 額外驗證：12 題錯題（全部列出，唔再截斷為 10 題）
        const overflowPng = await page.evaluate(() => {
            const api = window.__kidsVocab;
            const pool = api.vocabulary['🅰️ K3第一段英文'] || [];
            api.setResultForTest(8, 12, pool.slice(0, 12));
            api.renderResultCanvas();
            return api.lastResultPng;
        });
        writeFileSync(path.join(SHOT_DIR, 'group-result-overflow.png'), Buffer.from(overflowPng.split(',')[1], 'base64'));
        check('9.7 已輸出 group-result-overflow.png（12 題錯題完整列出）', existsSync(path.join(SHOT_DIR, 'group-result-overflow.png')));

        // 9.6b 錯題清單必須列出全部錯題（畫布高度隨題數增長）
        const rows12 = await page.evaluate(() => {
            const api = window.__kidsVocab;
            const pool = api.vocabulary['🅰️ K3第一段英文'] || [];
            api.setResultForTest(8, 12, pool.slice(0, 12));
            const c = api.renderResultCanvas();
            return { rows: api.lastResultRows, height: c ? c.height : 0 };
        });
        check('9.6b 12 題錯題全部列入清單', rows12.rows === 12, JSON.stringify(rows12));

        const rows20 = await page.evaluate(() => {
            const api = window.__kidsVocab;
            const pool = api.vocabulary['🅰️ K3第一段英文'] || [];
            api.setResultForTest(25, 20, pool.slice(0, 20));
            const c = api.renderResultCanvas();
            return { rows: api.lastResultRows, height: c ? c.height : 0, png: api.lastResultPng };
        });
        writeFileSync(path.join(SHOT_DIR, 'group-result-20wrong.png'), Buffer.from(rows20.png.split(',')[1], 'base64'));
        check('9.6c 20 題錯題全部列入清單', rows20.rows === 20, JSON.stringify({ rows: rows20.rows }));
        check('9.6d 畫布高度隨錯題數增長（20 題 > 12 題）', rows20.height > rows12.height, `12題=${rows12.height} 20題=${rows20.height}`);

        // 9.4 完成畫面截圖（重新做一輪）
        await page.click('button.btn-flashcards');
        await page.waitForTimeout(200);
        await page.click('#fc-tabs .cat-grade-btn[data-grade="K3"]');
        await page.waitForTimeout(150);
        await page.click('#fc-tabs .cat-lang-btn[data-lang="英文"]');
        await page.waitForTimeout(150);
        await page.click('#fc-tabs .cat-row-cats .category-tab[data-category="🅰️ K3第一段英文"]');
        await page.waitForTimeout(200);
        await page.$eval('#fc-quantity-slider', el => {
            el.value = '3';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.click('#fc-start-btn');
        await page.waitForTimeout(250);
        for (const fn of ['markCorrect()', 'markWrong()', 'markCorrect()']) {
            const btn = await page.$(`#fc-buttons button[onclick="${fn}"]`);
            if (btn) { await btn.click(); await page.waitForTimeout(200); }
        }
        await page.waitForTimeout(350);
        await page.$eval('#fc-export-btn', el => el.scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(SHOT_DIR, 'group-flashcard-done.png'), fullPage: false });
        check('9.4 已輸出 group-flashcard-done.png', existsSync(path.join(SHOT_DIR, 'group-flashcard-done.png')));
        await page.close();

        // 9.3 手機版（iPhone 13）
        const iphone = devices['iPhone 13'] || { viewport: { width: 390, height: 844 } };
        const mobileCtx = await browser.newContext({
            viewport: iphone.viewport,
            userAgent: iphone.userAgent,
            deviceScaleFactor: 2,
            isMobile: true,
            hasTouch: true,
            acceptDownloads: true
        });
        const mobilePage = await mobileCtx.newPage();
        const mobileConsoleErrors = [];
        const mobilePageErrors = [];
        mobilePage.on('console', m => { if (m.type() === 'error') mobileConsoleErrors.push(m.text()); });
        mobilePage.on('pageerror', e => mobilePageErrors.push(String(e && e.message ? e.message : e)));
        await mobilePage.goto(BASE_URL, { waitUntil: 'load' });
        await mobilePage.waitForTimeout(300);
        await mobilePage.click('button.btn-flashcards');
        await mobilePage.waitForTimeout(250);
        await mobilePage.click('#fc-tabs .cat-grade-btn[data-grade="K3"]');
        await mobilePage.waitForTimeout(150);
        await mobilePage.click('#fc-tabs .cat-lang-btn[data-lang="英文"]');
        await mobilePage.waitForTimeout(250);
        const mobileState = await mobilePage.evaluate(() => ({
            grade: (document.querySelector('#fc-tabs .cat-grade-btn.active') || {}).dataset?.grade,
            lang: (document.querySelector('#fc-tabs .cat-lang-btn.active') || {}).dataset?.lang,
            cats: [...document.querySelectorAll('#fc-tabs .cat-row-cats .category-tab')].map(e => e.textContent.trim()),
            rows: [...document.querySelectorAll('#fc-tabs > .cat-row')].map(r => r.dataset.row)
        }));
        check('9.3b 手機版三行結構 + K3/英文 選中狀態正確',
            mobileState.rows.length === 3 && mobileState.grade === 'K3' && mobileState.lang === '英文' &&
            mobileState.cats.includes('🅰️ K3第一段英文') && mobileState.cats.includes('📖 Unit 2'),
            JSON.stringify(mobileState));
        const mobileBox = await mobilePage.$eval('#fc-tabs', el => {
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
        });
        await mobilePage.screenshot({
            path: path.join(SHOT_DIR, 'group-mobile-390.png'),
            fullPage: false,
            clip: { x: 0, y: Math.max(0, mobileBox.y - 6), width: 390, height: Math.min(844 - Math.max(0, mobileBox.y - 6), mobileBox.height + 12) }
        });
        check('9.3 已輸出 group-mobile-390.png', existsSync(path.join(SHOT_DIR, 'group-mobile-390.png')));
        check('9.4 手機版 console error = 0 / pageerror = 0',
            mobileConsoleErrors.length === 0 && mobilePageErrors.length === 0,
            `console=${mobileConsoleErrors.length}, pageerror=${mobilePageErrors.length}`);

        await mobileCtx.close();

        // ============ 9.8 自訂字詞 → ⭐ 其他 的自動語言判斷 ============
        const customCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const customPage = await customCtx.newPage();
        const customErrors = [];
        customPage.on('pageerror', e => customErrors.push(String(e && e.message ? e.message : e)));
        await customPage.addInitScript(() => {
            localStorage.setItem('kidsVocab_customWords', JSON.stringify([
                { category: '我的中文分類', chinese: '測試中', emoji: '🧪', english: 'test-cn' },
                { category: '我的英文分類', chinese: '測試英', emoji: '🧪', english: 'test-en' },
                { category: '我的其他分類', chinese: '測試他', emoji: '🧪', english: 'test-other' }
            ]));
        });
        await customPage.goto(BASE_URL, { waitUntil: 'load' });
        await customPage.waitForTimeout(300);
        await customPage.click('button.btn-flashcards');
        await customPage.waitForTimeout(250);
        await customPage.click('#fc-tabs .cat-grade-btn[data-grade="⭐ 其他"]');
        await customPage.waitForTimeout(250);
        const customLangBtns = await customPage.$$eval('#fc-tabs .cat-lang-btn', els => els.map(e => e.textContent.trim()));
        const customMap = {};
        for (const lang of customLangBtns) {
            await customPage.click(`#fc-tabs .cat-lang-btn[data-lang="${lang}"]`);
            await customPage.waitForTimeout(200);
            customMap[lang] = await customPage.$$eval('#fc-tabs .cat-row-cats .category-tab', els => els.map(e => e.textContent.trim()));
        }
        const customOk = customMap['中文']?.includes('我的中文分類')
            && customMap['英文']?.includes('我的英文分類')
            && customMap['其他']?.includes('我的其他分類');
        check('9.8 ⭐ 其他：自訂分類按名稱自動判斷語言（中文／英文／其他）', customOk, JSON.stringify(customMap));
        check('9.8b 自訂分類流程無 pageerror', customErrors.length === 0, customErrors.join(' | '));
        await customCtx.close();

        // ============ 總結 ============
        check('1. console error = 0', consoleErrors.length === 0, consoleErrors.join(' | ').slice(0, 300));
        check('1b. pageerror = 0', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));
    } finally {
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
        if (server) { try { server.kill('SIGTERM'); } catch (e) {} }
    }

    const passed = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok);
    console.log('='.repeat(64));
    console.log(`驗證結果：${passed}/${results.length} 通過`);
    if (failed.length) {
        console.log('失敗項目：');
        failed.forEach(f => console.log(`  ❌ ${f.name}${f.detail ? ' — ' + f.detail : ''}`));
    }
    console.log(`截圖目錄：${SHOT_DIR}`);
    process.exit(failed.length ? 1 : 0);
}

main().catch(err => {
    console.error('❌ 驗證腳本異常：', err);
    process.exit(1);
});
