#!/usr/bin/env node
/**
 * kids-vocab — 音效 + 反義配對 自動驗證
 * ---------------------------------------------------------------------------
 * 驗證內容：
 *   1. console error = 0、pageerror = 0
 *   2. 音效開關：預設開、click 變關（localStorage 寫入 false）、再 click 回復
 *   3. 估估吓：答錯 → lastSound = 'wrong'；答對 → lastSound = 'correct'
 *   4. 反義配對棋盤：14 張卡、卡面冇 emoji、啱 → 兩張卡 matched（消失）+ 音效 correct、
 *      錯 → 音效 wrong + 兩張卡仍在、全部配對完 → 完成 modal
 *   5. 認字卡揀「相反詞」會自動轉到配對遊戲
 *   6. 詞庫資料與 git HEAD 完全一致 + validate-vocab.mjs 輸出一致
 *   7. 輸出截圖到 .shots/
 *
 * 執行方式：node verify-sound-antonym.mjs
 * 結束代碼：0 = 全部通過；1 = 有項目失敗
 */

import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = __dirname;
const SHOT_DIR = path.join(PROJECT_DIR, '.shots');
const PORT = 8127;
const BASE_URL = `http://127.0.0.1:${PORT}/index.html`;

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
const { chromium } = loadPlaywright();

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

// ---------- 詞庫資料無損（與 git HEAD 逐字比較）----------
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

function runValidate(dir) {
    try {
        const out = execFileSync(process.execPath, [path.join(dir, 'scripts/validate-vocab.mjs')], {
            cwd: dir, encoding: 'utf8'
        });
        return { code: 0, out };
    } catch (err) {
        return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
    }
}

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

async function main() {
    console.log('kids-vocab 音效 + 反義配對 — 自動驗證');
    console.log('='.repeat(64));

    if (!existsSync(SHOT_DIR)) mkdirSync(SHOT_DIR, { recursive: true });

    let server = null;
    if (!(await serverAlive())) {
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

    const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
    const consoleErrors = [];
    const pageErrors = [];
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => pageErrors.push(String(err && err.message ? err.message : err)));

    try {
        await page.goto(BASE_URL, { waitUntil: 'load' });
        await page.waitForTimeout(300);

        // ============ 1. 音效開關 ============
        const toggleInfo = await page.evaluate(() => {
            const b = document.getElementById('sound-toggle');
            return b ? { text: b.textContent.trim(), pressed: b.getAttribute('aria-pressed'), enabled: window.__kidsVocab.soundEnabled } : null;
        });
        check('1.1 音效開關按鈕存在且預設開啟', !!toggleInfo && toggleInfo.enabled === true && toggleInfo.pressed === 'true', JSON.stringify(toggleInfo));
        await page.click('#sound-toggle');
        await page.waitForTimeout(150);
        const offState = await page.evaluate(() => ({
            enabled: window.__kidsVocab.soundEnabled,
            stored: localStorage.getItem('kidsVocab_soundEnabled'),
            text: document.getElementById('sound-toggle').textContent.trim()
        }));
        check('1.2 關閉後 soundEnabled=false 且寫入 localStorage', offState.enabled === false && offState.stored === 'false', JSON.stringify(offState));
        await page.click('#sound-toggle');
        await page.waitForTimeout(150);
        const onState = await page.evaluate(() => ({
            enabled: window.__kidsVocab.soundEnabled,
            stored: localStorage.getItem('kidsVocab_soundEnabled')
        }));
        check('1.3 再按一次回復開啟', onState.enabled === true && onState.stored === 'true', JSON.stringify(onState));

        // ============ 2. 估估吓音效 ============
        await page.click('button.btn-quiz');
        await page.waitForTimeout(400);
        const opts = await page.evaluate(() => [...document.querySelectorAll('#quiz-options .option-btn')].map(b => {
            const m = /checkAnswer\(this,\s*'([^']*)',\s*'([^']*)'\)/.exec(b.getAttribute('onclick') || '');
            return m ? { ans: m[1], correct: m[2], text: b.textContent.trim() } : null;
        }).filter(Boolean));
        check('2.1 估估吓有可作答選項', opts.length >= 2, `選項數 ${opts.length}`);
        const wrongOpt = opts.find(o => o.ans !== o.correct);
        const rightOpt = opts.find(o => o.ans === o.correct);
        if (wrongOpt) {
            await page.evaluate(t => {
                const btn = [...document.querySelectorAll('#quiz-options .option-btn')].find(b => b.textContent.trim() === t);
                if (btn) btn.click();
            }, wrongOpt.text);
            await page.waitForTimeout(250);
            const s1 = await page.evaluate(() => window.__kidsVocab.lastSound);
            check('2.2 答錯 → 音效 wrong', s1 === 'wrong', `lastSound=${s1}`);
        } else {
            check('2.2 答錯 → 音效 wrong', false, '搵唔到錯誤選項');
        }
        if (rightOpt) {
            await page.evaluate(t => {
                const btn = [...document.querySelectorAll('#quiz-options .option-btn')].find(b => b.textContent.trim() === t);
                if (btn) btn.click();
            }, rightOpt.text);
            await page.waitForTimeout(250);
            const s2 = await page.evaluate(() => window.__kidsVocab.lastSound);
            check('2.3 答對 → 音效 correct', s2 === 'correct', `lastSound=${s2}`);
        } else {
            check('2.3 答對 → 音效 correct', false, '搵唔到正確選項');
        }
        await page.waitForTimeout(1200);

        // ============ 3. 反義配對棋盤 ============
        await page.click('button.btn-matching');
        await page.waitForTimeout(300);
        // 切到 K3 → 中文 → 相反詞
        await page.evaluate(() => {
            const g = [...document.querySelectorAll('#match-tabs .cat-grade-btn')].find(b => b.textContent.trim() === 'K3');
            if (g) g.click();
        });
        await page.waitForTimeout(250);
        await page.evaluate(() => {
            const l = [...document.querySelectorAll('#match-tabs .cat-lang-btn')].find(b => b.textContent.trim() === '中文');
            if (l) l.click();
        });
        await page.waitForTimeout(250);
        await page.evaluate(() => {
            const c = [...document.querySelectorAll('#match-tabs .category-tab')].find(b => b.textContent.includes('相反詞'));
            if (c) c.click();
        });
        await page.waitForTimeout(400);

        const board = await page.evaluate(() => {
            const cards = [...document.querySelectorAll('#match-grid .antonym-card')];
            return {
                count: cards.length,
                words: cards.map(c => c.textContent.trim()),
                title: document.getElementById('match-title').textContent.trim(),
                hint: (document.getElementById('antonym-hint') || {}).textContent || '',
                remaining: (document.getElementById('antonym-remaining') || {}).textContent || '',
                matchingActive: document.getElementById('matching').classList.contains('active'),
                pairs: window.__kidsVocab.antonymPairs()
            };
        });
        check('3.1 相反詞分類顯示反義配對棋盤（14 張卡）', board.count === 14 && board.matchingActive, `卡數 ${board.count}`);
        check('3.2 標題改為「反義配對」', board.title === '反義配對', board.title);
        check('3.3 提示行存在', board.hint.includes('相反') && board.remaining.includes('7'), `${board.hint} / ${board.remaining}`);
        const emojiCards = board.words.filter(w => EMOJI_RE.test(w));
        check('3.4 卡面完全冇 emoji', emojiCards.length === 0, `有 emoji 的卡：${JSON.stringify(emojiCards)}`);
        check('3.5 相反詞配對為 7 對', Array.isArray(board.pairs) && board.pairs.length === 7, `對數 ${board.pairs && board.pairs.length}`);
        await page.screenshot({ path: path.join(SHOT_DIR, 'antonym-board-desktop.png'), fullPage: true });

        // 答錯一對
        const wrongPair = await page.evaluate(() => {
            const cards = [...document.querySelectorAll('#match-grid .antonym-card')];
            const a = cards[0];
            const b = cards.find(c => c.dataset.pair !== a.dataset.pair);
            a.click();
            b.click();
            return { a: a.dataset.word, b: b.dataset.word };
        });
        await page.waitForTimeout(250);
        const wrongState = await page.evaluate(() => ({
            lastSound: window.__kidsVocab.lastSound,
            stillThere: document.querySelectorAll('#match-grid .antonym-card:not(.matched)').length
        }));
        check('3.6 揀錯 → 音效 wrong 而且兩張卡唔會消失',
            wrongState.lastSound === 'wrong' && wrongState.stillThere === 14,
            `lastSound=${wrongState.lastSound} 剩 ${wrongState.stillThere} 張（揀咗 ${wrongPair.a} + ${wrongPair.b}）`);

        // 答啱一對 → 兩張卡消去
        const firstPair = board.pairs[0];
        const rightState = await page.evaluate(pair => {
            const cards = [...document.querySelectorAll('#match-grid .antonym-card')];
            const a = cards.find(c => c.dataset.word === pair[0]);
            const b = cards.find(c => c.dataset.word === pair[1]);
            a.click();
            b.click();
            return {
                aMatched: a.classList.contains('matched'),
                bMatched: b.classList.contains('matched')
            };
        }, firstPair);
        await page.waitForTimeout(400);
        const afterRight = await page.evaluate(() => ({
            lastSound: window.__kidsVocab.lastSound,
            left: document.querySelectorAll('#match-grid .antonym-card:not(.matched)').length,
            score: document.getElementById('match-score').textContent.trim(),
            remaining: (document.getElementById('antonym-remaining') || {}).textContent || ''
        }));
        check('3.7 揀啱 → 音效 correct + 兩張卡 matched（消失）',
            afterRight.lastSound === 'correct' && rightState.aMatched && rightState.bMatched,
            JSON.stringify(rightState));
        check('3.8 分數 +1、剩餘組數更新',
            afterRight.score.includes('1') && afterRight.left === 12 && afterRight.remaining.includes('6'),
            `${afterRight.score} / ${afterRight.remaining} / 剩 ${afterRight.left} 張`);

        // 完成餘下全部配對
        await page.evaluate(pairs => {
            pairs.forEach(pair => {
                const cards = [...document.querySelectorAll('#match-grid .antonym-card:not(.matched)')];
                const a = cards.find(c => c.dataset.word === pair[0]);
                const b = cards.find(c => c.dataset.word === pair[1]);
                if (a && b) { a.click(); b.click(); }
            });
        }, board.pairs.slice(1));
        await page.waitForTimeout(900);
        const modalVisible = await page.evaluate(() => {
            const m = document.getElementById('completion-modal');
            return m ? getComputedStyle(m).display !== 'none' : false;
        });
        check('3.9 全部配對完成 → 完成 modal', modalVisible);
        await page.screenshot({ path: path.join(SHOT_DIR, 'antonym-board-complete.png'), fullPage: true });

        // 關閉 modal，切去另一分類 → 回復一般圖文配對
        await page.evaluate(() => {
            const b = [...document.querySelectorAll('#completion-modal button')].find(x => x.textContent.includes('再玩一次'));
            if (b) b.click();
        });
        await page.waitForTimeout(300);
        await page.evaluate(() => {
            const c = [...document.querySelectorAll('#match-tabs .category-tab')].find(b => b.textContent.includes('生字'));
            if (c) c.click();
        });
        await page.waitForTimeout(400);
        const backToNormal = await page.evaluate(() => ({
            antonymCards: document.querySelectorAll('#match-grid .antonym-card').length,
            normalCards: document.querySelectorAll('#match-grid .matching-card').length,
            title: document.getElementById('match-title').textContent.trim()
        }));
        check('3.10 切去其他分類 → 回復一般圖文配對',
            backToNormal.antonymCards === 0 && backToNormal.normalCards > 0 && backToNormal.title.includes('圖文配對'),
            JSON.stringify(backToNormal));

        // ============ 4. 認字卡揀相反詞 → 自動轉去配對 ============
        await page.evaluate(() => {
            const c = [...document.querySelectorAll('#match-tabs .category-tab')].find(b => b.textContent.includes('相反詞'));
            if (c) c.click();
        });
        await page.waitForTimeout(400);
        await page.click('button.btn-flashcards');
        await page.waitForTimeout(500);
        const fcRedirect = await page.evaluate(() => ({
            matchingActive: document.getElementById('matching').classList.contains('active'),
            fcActive: document.getElementById('flashcards').classList.contains('active'),
            cards: document.querySelectorAll('#match-grid .antonym-card').length,
            toast: (document.getElementById('kv-toast') || {}).textContent || ''
        }));
        check('4.1 認字卡揀相反詞 → 自動轉到反義配對',
            fcRedirect.matchingActive && !fcRedirect.fcActive && fcRedirect.cards === 14,
            JSON.stringify(fcRedirect));

        // ============ 5. 手機版 ============
        const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
        const mpage = await mobile.newPage();
        const mErrors = [];
        mpage.on('pageerror', e => mErrors.push(String(e && e.message ? e.message : e)));
        await mpage.goto(BASE_URL, { waitUntil: 'load' });
        await mpage.waitForTimeout(300);
        await mpage.click('button.btn-matching');
        await mpage.waitForTimeout(300);
        await mpage.evaluate(() => {
            const g = [...document.querySelectorAll('#match-tabs .cat-grade-btn')].find(b => b.textContent.trim() === 'K3');
            if (g) g.click();
        });
        await mpage.waitForTimeout(250);
        await mpage.evaluate(() => {
            const l = [...document.querySelectorAll('#match-tabs .cat-lang-btn')].find(b => b.textContent.trim() === '中文');
            if (l) l.click();
        });
        await mpage.waitForTimeout(250);
        await mpage.evaluate(() => {
            const c = [...document.querySelectorAll('#match-tabs .category-tab')].find(b => b.textContent.includes('相反詞'));
            if (c) c.click();
        });
        await mpage.waitForTimeout(500);
        const mobileBoard = await mpage.evaluate(() => {
            const cards = [...document.querySelectorAll('#match-grid .antonym-card')];
            const cols = cards.length ? getComputedStyle(cards[0].parentElement).gridTemplateColumns.split(' ').length : 0;
            const overflow = document.documentElement.scrollWidth > window.innerWidth + 2;
            return { count: cards.length, cols, overflow };
        });
        check('5.1 手機 390px：14 張卡、3 欄、無橫向溢出',
            mobileBoard.count === 14 && mobileBoard.cols === 3 && !mobileBoard.overflow,
            JSON.stringify(mobileBoard));
        await mpage.screenshot({ path: path.join(SHOT_DIR, 'antonym-board-mobile-390.png'), fullPage: true });
        check('5.2 手機版 pageerror = 0', mErrors.length === 0, mErrors.join(' | '));
        await mobile.close();

        // ============ 6. 詞庫資料無損 ============
        const headHtml = execFileSync('git', ['show', 'HEAD:index.html'], { cwd: PROJECT_DIR, encoding: 'utf8' });
        const nowHtml = readFileSync(path.join(PROJECT_DIR, 'index.html'), 'utf8');
        const headData = extractDataBlocks(headHtml);
        const nowData = extractDataBlocks(nowHtml);
        check('6.1 vocabulary 資料與 git HEAD 逐字一致', headData.vocabulary === nowData.vocabulary);
        check('6.2 dictationSentences 資料與 git HEAD 逐字一致', headData.dictationSentences === nowData.dictationSentences);

        const tmpDir = '/tmp/kv_validate_head2';
        execFileSync('rm', ['-rf', tmpDir]);
        mkdirSync(path.join(tmpDir, 'scripts'), { recursive: true });
        writeFileSync(path.join(tmpDir, 'index.html'), headHtml);
        const headScript = execFileSync('git', ['show', 'HEAD:scripts/validate-vocab.mjs'], { cwd: PROJECT_DIR, encoding: 'utf8' });
        writeFileSync(path.join(tmpDir, 'scripts/validate-vocab.mjs'), headScript);
        const headValidate = runValidate(tmpDir);
        const nowValidate = runValidate(PROJECT_DIR);
        // 「資料來源」一行包含檔案路徑，比較前先正規化
        const normalize = s => String(s).split('\n').filter(l => !l.startsWith('資料來源：')).join('\n');
        check('6.3 validate-vocab.mjs 輸出與改動前一致（退出碼與內容）',
            headValidate.code === nowValidate.code && normalize(headValidate.out) === normalize(nowValidate.out),
            `HEAD code=${headValidate.code} / 現在 code=${nowValidate.code}`);

        // ============ 7. console / pageerror ============
        check('7.1 console error = 0', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
        check('7.2 pageerror = 0', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

    } catch (err) {
        check('✖️ 執行過程冇拋錯', false, String(err && err.stack ? err.stack.split('\n').slice(0, 3).join(' / ') : err));
    } finally {
        await browser.close().catch(() => {});
        if (server) server.kill('SIGTERM');
    }

    const passed = results.filter(r => r.ok).length;
    console.log('='.repeat(64));
    console.log(`結果：${passed}/${results.length} 通過`);
    if (passed !== results.length) {
        console.log('失敗項目：');
        results.filter(r => !r.ok).forEach(r => console.log(`  ❌ ${r.name} — ${r.detail}`));
        process.exit(1);
    }
    process.exit(0);
}

main();
