#!/usr/bin/env node
/**
 * kids-vocab — Oral 口語（K3 英文）自動驗證
 * ---------------------------------------------------------------------------
 * 驗證內容：
 *   1. console error = 0、pageerror = 0
 *   2. 主選單有「🗣️ Oral 口語」按鈕；點擊後 #oral 顯示、其他 .game-area 隱藏
 *   3. 題庫：兩個分部都有題目；D 區 26 個高頻生字答案覆蓋率 100%；
 *      每題格式正確（q 剛好一個空格 _____、a 為單一英文字、zh / full 非空、
 *      full 內含答案）
 *   4. 開始 → 顯示 6 個選字按鈕；揀錯 → 分數 ❌ +1 且正確答案高亮綠色；
 *      揀啱 → 分數 ✅ +1；完成畫面顯示錯題清單（你的答案 / 正確答案 / 中文提示）
 *   5. 390px 手機寬度無橫向溢出（documentElement.scrollWidth <= 391）
 *   6. 輸出截圖到 .shots/（oral-*.png）
 *
 * 執行方式：node verify-oral.mjs
 * 結束代碼：0 = 全部通過；1 = 有項目失敗
 */

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = __dirname;
const SHOT_DIR = path.join(PROJECT_DIR, '.shots');
const PORT = 8128;
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

/** 點擊 #oral-bank 內文字等於指定值的選字按鈕 */
async function clickOption(page, text) {
    return page.evaluate(t => {
        const btn = [...document.querySelectorAll('#oral-bank .option-btn')].find(b => b.textContent.trim() === t);
        if (!btn) return false;
        btn.click();
        return true;
    }, text);
}

/** 讀取目前題目的狀態 */
async function oralState(page) {
    return page.evaluate(() => window.getOralDebugState());
}

async function main() {
    console.log('kids-vocab Oral 口語（K3 英文）— 自動驗證');
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

        // ============ 1. 選單入口 ============
        const menuBtn = await page.evaluate(() => {
            const b = document.querySelector('.menu button.btn-oral');
            return b ? { text: b.textContent.trim(), visible: !!b.offsetParent } : null;
        });
        check('1.1 主選單有「🗣️ Oral 口語」按鈕', !!menuBtn && menuBtn.text.includes('Oral 口語'), JSON.stringify(menuBtn));

        await page.click('button.btn-oral');
        await page.waitForTimeout(300);
        const areaState = await page.evaluate(() => {
            const areas = [...document.querySelectorAll('.game-area')];
            return {
                oralActive: document.getElementById('oral').classList.contains('active'),
                oralVisible: !!document.getElementById('oral').offsetParent,
                othersHidden: areas.filter(a => a.id !== 'oral').every(a => !a.classList.contains('active') && !a.offsetParent),
                activeIds: areas.filter(a => a.classList.contains('active')).map(a => a.id)
            };
        });
        check('1.2 點擊後 #oral 顯示', areaState.oralActive && areaState.oralVisible, JSON.stringify(areaState));
        check('1.3 其他 .game-area 全部隱藏', areaState.othersHidden, `同時顯示：${JSON.stringify(areaState.activeIds)}`);

        const segTabs = await page.evaluate(() => [...document.querySelectorAll('#oral-seg .category-tab')].map(b => b.textContent.trim()));
        check('1.4 分部切換器有兩個 chip（D 段 / E 段）', segTabs.length === 2 && segTabs.some(t => t.includes('D. 高頻生字')) && segTabs.some(t => t.includes('E. 口語對話')), JSON.stringify(segTabs));

        // ============ 2. 題庫 ============
        const bank = await page.evaluate(() => {
            const q = window.oralQuestions;
            const words = window.ORAL_SIGHT_WORDS;
            const segments = Object.keys(q);
            const out = { segments, counts: {}, bad: [], covered: [], missing: [], wordCount: words.length };
            for (const seg of segments) {
                const list = q[seg];
                out.counts[seg] = list.length;
                for (const item of list) {
                    const blanks = (String(item.q).match(/_____/g) || []).length;
                    const problems = [];
                    if (blanks !== 1) problems.push(`空格數=${blanks}`);
                    if (!item.a || !String(item.a).trim()) problems.push('答案為空');
                    if (/\s/.test(String(item.a || '').trim())) problems.push('答案不是單一英文字');
                    if (!item.zh || !String(item.zh).trim()) problems.push('中文提示為空');
                    if (!item.full || !String(item.full).trim()) problems.push('完整句子為空');
                    if (String(item.full || '').toLowerCase().indexOf(String(item.a || '').toLowerCase()) === -1) problems.push('full 不含答案');
                    if (problems.length) out.bad.push({ seg, q: item.q, problems });
                }
            }
            const dAnswers = new Set(q['D. 高頻生字'].map(i => String(i.a).trim().toLowerCase()));
            out.covered = words.filter(w => dAnswers.has(String(w).trim().toLowerCase()));
            out.missing = words.filter(w => !dAnswers.has(String(w).trim().toLowerCase()));
            return out;
        });
        check('2.1 題庫有兩個分部，而且都有題目', bank.segments.length === 2 && Object.values(bank.counts).every(n => n > 0), JSON.stringify(bank.counts));
        check('2.2 D 區 26 個高頻生字答案覆蓋率 = 100%', bank.missing.length === 0 && bank.covered.length === bank.wordCount, `覆蓋 ${bank.covered.length}/${bank.wordCount}，欠：${JSON.stringify(bank.missing)}`);
        check('2.3 每題格式正確（q 一個空格 / a 單一英文字 / zh / full 非空）', bank.bad.length === 0, `問題題目：${JSON.stringify(bank.bad.slice(0, 5))}`);
        check('2.4 E 區題數在 20–26 之間', bank.counts['E. 口語對話'] >= 20 && bank.counts['E. 口語對話'] <= 26, `${bank.counts['E. 口語對話']} 題`);
        check('2.5 D 區題數足夠（≥26）', bank.counts['D. 高頻生字'] >= 26, `${bank.counts['D. 高頻生字']} 題`);

        // ============ 3. 題數滑桿 / 預覽 ============
        const slider = await page.evaluate(() => {
            const s = document.getElementById('oral-quantity-slider');
            return { min: s.min, max: s.max, value: s.value, display: document.getElementById('oral-quantity-display').textContent.trim(), preview: document.getElementById('oral-preview').textContent.trim() };
        });
        check('3.1 題數滑桿上限 = 分部題數', Number(slider.max) === bank.counts['D. 高頻生字'], JSON.stringify(slider));
        check('3.2 顯示「N 題 / 共 M 題」', /\d+ 題 \/ 共 \d+ 題/.test(slider.display), slider.display);
        check('3.3 未開始前顯示預覽（分部名 + 題數）', slider.preview.includes('高頻生字') && /\d+/.test(slider.preview), slider.preview);

        // 改題數 → 回到未開始狀態
        await page.evaluate(() => {
            const s = document.getElementById('oral-quantity-slider');
            s.value = '3';
            s.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.waitForTimeout(200);
        const afterQty = await page.evaluate(() => ({
            display: document.getElementById('oral-quantity-display').textContent.trim(),
            playHidden: document.getElementById('oral-play').style.display === 'none',
            startVisible: document.getElementById('oral-start-wrap').style.display !== 'none'
        }));
        check('3.4 改題數後回到未開始狀態', afterQty.playHidden && afterQty.startVisible && afterQty.display.startsWith('3 題'), JSON.stringify(afterQty));

        // 切換到 E 段
        await page.evaluate(() => {
            const b = [...document.querySelectorAll('#oral-seg .category-tab')].find(x => x.textContent.includes('E. 口語對話'));
            if (b) b.click();
        });
        await page.waitForTimeout(250);
        const segE = await page.evaluate(() => ({
            max: document.getElementById('oral-quantity-slider').max,
            display: document.getElementById('oral-quantity-display').textContent.trim(),
            preview: document.getElementById('oral-preview').textContent.trim()
        }));
        check('3.5 切換到 E 段：滑桿上限與預覽同步', Number(segE.max) === bank.counts['E. 口語對話'] && segE.preview.includes('E. 口語對話'), JSON.stringify(segE));
        // 切回 D 段
        await page.evaluate(() => {
            const b = [...document.querySelectorAll('#oral-seg .category-tab')].find(x => x.textContent.includes('D. 高頻生字'));
            if (b) b.click();
        });
        await page.waitForTimeout(250);

        // ============ 4. 開始作答 ============
        await page.click('#oral-start-btn');
        await page.waitForTimeout(300);
        const startState = await page.evaluate(() => ({
            optionCount: document.querySelectorAll('#oral-bank .option-btn').length,
            progress: document.getElementById('oral-progress').textContent.trim(),
            question: document.getElementById('oral-question').textContent.trim(),
            hasBlank: !!document.querySelector('#oral-question .oral-blank'),
            hint: document.getElementById('oral-hint').textContent.trim(),
            score: document.getElementById('oral-score').textContent.trim(),
            playVisible: document.getElementById('oral-play').style.display !== 'none'
        }));
        check('4.1 開始後顯示 6 個選字按鈕', startState.optionCount === 6, `選項數 ${startState.optionCount}`);
        check('4.2 題目卡顯示句子（空格以底色標示）', startState.hasBlank && startState.question.length > 0, startState.question);
        check('4.3 中文提示有顯示', startState.hint.includes('💡'), startState.hint);
        check('4.4 進度條顯示 i/N', /^1\/3$/.test(startState.progress), startState.progress);
        check('4.5 分數初始為 ✅ 0 | ❌ 0', startState.score === '✅ 0 | ❌ 0', startState.score);
        await page.screenshot({ path: path.join(SHOT_DIR, 'oral-question.png'), fullPage: true });

        // --- 揀錯 ---
        let st = await oralState(page);
        const wrongText = st.options.find(o => o.toLowerCase() !== String(st.answer).toLowerCase());
        const clickedWrong = await clickOption(page, wrongText);
        await page.waitForTimeout(250);
        const wrongState = await page.evaluate(() => {
            const btns = [...document.querySelectorAll('#oral-bank .option-btn')];
            return {
                score: document.getElementById('oral-score').textContent.trim(),
                encourage: document.getElementById('oral-encourage').textContent.trim(),
                correctCount: btns.filter(b => b.classList.contains('correct')).length,
                wrongCount: btns.filter(b => b.classList.contains('wrong')).length,
                disabled: btns.every(b => b.disabled),
                nextVisible: document.getElementById('oral-next-wrap').style.display !== 'none',
                lastSound: window.__kidsVocab ? window.__kidsVocab.lastSound : null
            };
        });
        check('4.6 揀錯 → 分數 ❌ +1', clickedWrong && wrongState.score.includes('❌ 1'), wrongState.score);
        check('4.7 揀錯 → 正確答案按鈕高亮（.correct）', wrongState.correctCount === 1 && wrongState.wrongCount === 1, `correct=${wrongState.correctCount} wrong=${wrongState.wrongCount}`);
        check('4.8 揀錯 → 顯示「❌ 睇答案」提示', wrongState.encourage.includes('睇答案'), wrongState.encourage);
        check('4.9 揀錯 → 所有選字按鈕鎖定、下一題鈕出現', wrongState.disabled && wrongState.nextVisible, JSON.stringify(wrongState));
        await page.screenshot({ path: path.join(SHOT_DIR, 'oral-wrong.png'), fullPage: true });

        // --- 下一題 → 揀啱 ---
        await page.click('#oral-next');
        await page.waitForTimeout(250);
        st = await oralState(page);
        check('4.10 下一題 → 進度變 2/3', st.current === 1, `current=${st.current}`);
        const rightText = st.options.find(o => o.toLowerCase() === String(st.answer).toLowerCase());
        await clickOption(page, rightText);
        await page.waitForTimeout(250);
        const rightState = await page.evaluate(() => {
            const btns = [...document.querySelectorAll('#oral-bank .option-btn')];
            return {
                score: document.getElementById('oral-score').textContent.trim(),
                encourage: document.getElementById('oral-encourage').textContent.trim(),
                correctCount: btns.filter(b => b.classList.contains('correct')).length,
                fadedCount: btns.filter(b => b.classList.contains('faded')).length,
                question: document.getElementById('oral-question').textContent.trim(),
                lastSound: window.__kidsVocab ? window.__kidsVocab.lastSound : null
            };
        });
        check('4.11 揀啱 → 分數 ✅ +1', rightState.score.includes('✅ 1'), rightState.score);
        check('4.12 揀啱 → 該按鈕變綠、其餘變淡', rightState.correctCount === 1 && rightState.fadedCount === 5, `correct=${rightState.correctCount} faded=${rightState.fadedCount}`);
        check('4.13 揀啱 → 顯示「✅ 啱！下一題」', rightState.encourage.includes('啱'), rightState.encourage);
        await page.screenshot({ path: path.join(SHOT_DIR, 'oral-correct.png'), fullPage: true });

        // --- 手機 390px 無橫向溢出（作答中） ---
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(300);
        const mobile = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            optionHeights: [...document.querySelectorAll('#oral-bank .option-btn')].map(b => b.getBoundingClientRect().height)
        }));
        check('4.14 手機 390px 無橫向溢出', mobile.scrollWidth <= 391, `scrollWidth=${mobile.scrollWidth} clientWidth=${mobile.clientWidth}`);
        check('4.15 手機 390px 選字按鈕觸控目標 ≥44px', mobile.optionHeights.every(h => h >= 44), JSON.stringify(mobile.optionHeights));
        await page.screenshot({ path: path.join(SHOT_DIR, 'oral-mobile-390.png'), fullPage: true });
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.waitForTimeout(250);

        // --- 答完最後一題 → 完成畫面 ---
        await page.click('#oral-next');
        await page.waitForTimeout(250);
        st = await oralState(page);
        await clickOption(page, st.options.find(o => o.toLowerCase() === String(st.answer).toLowerCase()));
        await page.waitForTimeout(250);
        await page.click('#oral-next');
        await page.waitForTimeout(300);
        const finish = await page.evaluate(() => {
            const el = document.getElementById('oral-finish');
            const review = document.getElementById('oral-review');
            return {
                visible: el.style.display !== 'none',
                playHidden: document.getElementById('oral-play').style.display === 'none',
                text: el.textContent.replace(/\s+/g, ' ').trim(),
                reviewExists: !!review,
                reviewText: review ? review.textContent.replace(/\s+/g, ' ').trim() : '',
                hasScore: /✅\s*2\s*\|\s*❌\s*1/.test(el.textContent),
                hasPercent: /\d+%/.test(el.textContent),
                hasStars: el.textContent.includes('⭐'),
                hasReplay: el.textContent.includes('再玩一次')
            };
        });
        check('4.16 最後一題後顯示完成畫面', finish.visible && finish.playHidden, JSON.stringify({ visible: finish.visible, playHidden: finish.playHidden }));
        check('4.17 完成畫面顯示分數 / 百分比 / 星星', finish.hasScore && finish.hasPercent && finish.hasStars, finish.text.slice(0, 120));
        check('4.18 完成畫面有錯題清單（你的答案 / 正確答案 / 中文提示）', finish.reviewExists && finish.reviewText.includes('你的答案') && finish.reviewText.includes('正確答案') && finish.reviewText.includes('中文提示'), finish.reviewText.slice(0, 200));
        check('4.19 完成畫面有「🔁 再玩一次」按鈕', finish.hasReplay, '');
        await page.screenshot({ path: path.join(SHOT_DIR, 'oral-finish.png'), fullPage: true });

        // --- 再玩一次 ---
        await page.evaluate(() => {
            const b = [...document.querySelectorAll('#oral-finish button')].find(x => x.textContent.includes('再玩一次'));
            if (b) b.click();
        });
        await page.waitForTimeout(300);
        const replay = await page.evaluate(() => ({
            playVisible: document.getElementById('oral-play').style.display !== 'none',
            score: document.getElementById('oral-score').textContent.trim(),
            options: document.querySelectorAll('#oral-bank .option-btn').length
        }));
        check('4.20 「再玩一次」重新開始（分數歸零、6 個選字）', replay.playVisible && replay.score === '✅ 0 | ❌ 0' && replay.options === 6, JSON.stringify(replay));

        // ============ 5. console / pageerror ============
        check('5.1 console error = 0', consoleErrors.length === 0, consoleErrors.join(' | '));
        check('5.2 pageerror = 0', pageErrors.length === 0, pageErrors.join(' | '));

    } catch (err) {
        console.error('❌ 驗證過程發生例外：', err);
        check('例外處理', false, String(err && err.message ? err.message : err));
    } finally {
        await browser.close();
        if (server) { try { server.kill('SIGTERM'); } catch (e) { /* ignore */ } }
    }

    const passed = results.filter(r => r.ok).length;
    const failed = results.length - passed;
    console.log('='.repeat(64));
    console.log(`結果：${passed}/${results.length} 通過${failed ? `，${failed} 項失敗` : ''}`);
    console.log('截圖目錄：' + SHOT_DIR);
    process.exit(failed ? 1 : 0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
