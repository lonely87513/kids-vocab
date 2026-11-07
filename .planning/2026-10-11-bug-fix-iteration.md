# Plan: Kids-vocab Bug-fix Iteration (3 hours)

> Author: Cin Nam (陳近南)
> Date: 2026-10-11 00:46 Asia/Taipei (16:46 UTC)
> Target: `/root/.openclaw/workspace/projects/kids-vocab/`
> Live: `https://lonely87513.github.io/kids-vocab/`
> Stack: 純 static HTML / CSS / JS (single index.html, 76KB)
> Master branch synced with remote

---

## 1. Context

- 5 歲小朋友學中英文 vocab game
- 主要功能：認字卡、估估吓 (選擇題)、配對、自訂字詞
- 已有 commit history（最近 2026-10 期間多次更新 K2 詞庫）
- 76KB index.html 內聯所有 CSS / JS
- 已 live 喺 GitHub Pages

**已知 issues（從 filesystem 一眼睇到）**
- ❌ `index.html.bak` 同 `index.html.old` 兩個 36KB identical backup files 留喺 repo — 應該刪除
- ❌ `.github/` 內可能有 stale workflows
- 需要 full code review 揾其他 bugs

---

## 2. Strategy (3-hour iteration)

### Phase 1: Initial Audit (15-20 min)
- **Subagent #1:** Full code review，output bug list categorized by severity
- **Subagent #2:** 跑 smoke test（如果可以 headless browser）or static analysis

### Phase 2: Critical + Major Fixes (90-120 min)
- 每次 fix 一個獨立 commit
- 大型 fix → spawn isolated subagent
- 細小 fix → main session 直接 edit

### Phase 3: Minor / Cleanup (30-45 min)
- Backup files 移除
- Console.log / debug code 清除
- Code style 一致性

### Phase 4: Verify + Summary (15-20 min)
- Syntax check
- Live URL byte-equal verify
- 完整改動摘要 send 畀 Nathan

### Stop Conditions
- 3 小時到
- 冇 critical/major bug 剩
- 全部 bugs 已 fix

---

## 3. Bug Categories

| 類別 | 影響 | Fix SLA |
|------|------|---------|
| **Critical** | 阻礙基本功能 / 數據 loss / 安全問題 | 即時 fix |
| **Major** | 明顯 UX 問題 / 跨瀏覽器 break | Phase 2 fix |
| **Minor** | Code smell / 優化 / 清理 | Phase 3 fix |
| **Trivial** | Typo / whitespace | 一齊 fix |

---

## 4. Subagent Pattern

每次 spawn subagent：
- 嚴格 scope（one bug, one commit）
- 唔 push（main session push）
- Atomic commit message
- 詳細 verification (syntax + smoke test)
- 詳細 report

---

## 5. Files Changed (預估)

| Path | Action | Priority |
|------|--------|----------|
| `index.html` | fix multiple bugs | 1 |
| `index.html.bak` | DELETE | 3 |
| `index.html.old` | DELETE | 3 |
| `.github/workflows/*` | 可能清理 | 3 |
| `.planning/*` | new files (tracking) | n/a |

---

## 6. Commit Strategy

- One commit per fix
- Conventional Commits format: `fix: ...` / `chore: ...` / `refactor: ...`
- Main session 收集幾個 commit 然後 push
- 或每個 fix 完即刻 push（視乎 progress）

---

## 7. Final Summary Template

Send 畀 Nathan：
```
📊 Kids-vocab Bug-fix Iteration Summary (3h)

🔴 Critical fixes: N
🟠 Major fixes: N
🟡 Minor fixes: N
🟢 Trivial fixes: N

Total commits: N
Final live URL: ✓ byte-equal

## Each fix
1. [SHA] [severity] [description]
2. ...

## Verification
- Local: N bytes
- Live: N bytes (byte-equal)
```

---

## 8. Next Step

[ ] Subagent #1: Full code review + bug audit
[ ] Main session: Evaluate findings, prioritize, dispatch fixes
[ ] Iteratively fix (subagent chain)
[ ] Final summary
