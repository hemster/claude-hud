import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync, exec } from 'node:child_process';
import { dim, RESET } from '../colors.js';
import { getAdaptiveBarWidth } from '../../utils/terminal.js';
// Custom element: Portkey (LLM gateway) monthly + daily budget gauges.
// Renders only when the active Claude config dir contains a portkey-usage.sh
// refresh script. Data comes from two files OUTSIDE this repo:
//   portkey-cache.json — written by portkey-usage.sh, holds cost/budget/today stats
//   portkey-usage.sh   — refresh script (owns the API credentials; never in repo)
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const BRAND_BLUE = '\x1b[38;2;7;112;227m'; // #0770e3
const EVA_PURPLE = '\x1b[38;2;123;47;190m'; // #7B2FBE
const BRIGHT_BLUE = '\x1b[38;2;0;191;255m'; // #00BFFF
function getDailyColor(percent) {
    if (percent >= 125)
        return EVA_PURPLE;
    if (percent >= 75)
        return BRIGHT_BLUE;
    return CYAN;
}
function dailyBar(percent, width) {
    const safeWidth = Math.max(0, Math.round(width));
    const safePercent = Math.min(200, Math.max(0, percent));
    const filled = Math.round((safePercent / 200) * safeWidth);
    const empty = safeWidth - filled;
    const color = getDailyColor(safePercent);
    return `${color}${'█'.repeat(filled)}${DIM}${'░'.repeat(empty)}${RESET}`;
}
const CACHE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes — show stale data while refresh runs
const CACHE_REFRESH_MS = 1 * 60 * 1000; // 1 minute — trigger API refresh
function getConfigDir() {
    return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}
function getCachePath() {
    return path.join(getConfigDir(), 'portkey-cache.json');
}
function getScriptPath() {
    return path.join(getConfigDir(), 'portkey-usage.sh');
}
function readCache() {
    try {
        const cachePath = getCachePath();
        if (!fs.existsSync(cachePath))
            return null;
        const raw = fs.readFileSync(cachePath, 'utf-8');
        const data = JSON.parse(raw);
        const ageMs = Date.now() - (data.timestamp * 1000);
        if (ageMs > CACHE_MAX_AGE_MS)
            return null;
        return data;
    }
    catch {
        return null;
    }
}
function isCacheStale() {
    try {
        const cachePath = getCachePath();
        if (!fs.existsSync(cachePath))
            return true;
        const stat = fs.statSync(cachePath);
        return (Date.now() - stat.mtimeMs) > CACHE_REFRESH_MS;
    }
    catch {
        return true;
    }
}
// Sync refresh — blocks until data is available (used when no cache exists)
function syncRefresh() {
    try {
        const scriptPath = getScriptPath();
        if (!fs.existsSync(scriptPath))
            return;
        execSync(scriptPath, { timeout: 5000, stdio: 'ignore' });
    }
    catch {
        // silent
    }
}
// Async refresh — non-blocking (used when stale cache can still be shown)
function asyncRefresh() {
    try {
        const scriptPath = getScriptPath();
        if (!fs.existsSync(scriptPath))
            return;
        exec(scriptPath, { timeout: 15000 });
    }
    catch {
        // silent
    }
}
export function renderPortkeyLine(ctx) {
    // Opt-in per config dir: render only where a portkey-usage.sh refresh
    // script is present. Config dirs without the script never show this element.
    if (!fs.existsSync(getScriptPath())) {
        return null;
    }
    const colors = ctx.config?.colors;
    let data = readCache();
    if (!data) {
        // No usable cache — sync refresh to get data now
        syncRefresh();
        data = readCache();
    }
    else if (isCacheStale()) {
        // Have displayable data but it's stale — refresh in background
        asyncRefresh();
    }
    if (!data || typeof data.cost !== 'number' || typeof data.budget !== 'number') {
        return null;
    }
    const cost = data.cost;
    const budget = data.budget;
    const percent = Math.min(100, Math.round((cost / budget) * 100));
    const barWidth = getAdaptiveBarWidth();
    const pkColor = percent >= 90 ? '\x1b[31m' : percent >= 75 ? '\x1b[33m' : BRAND_BLUE;
    const filled = Math.round((percent / 100) * barWidth);
    const empty = barWidth - filled;
    const bar = `${pkColor}${'█'.repeat(filled)}${DIM}${'░'.repeat(empty)}${RESET}`;
    const costStr = `$${cost.toFixed(2)}/${budget}`;
    const percentStr = `${pkColor}${percent}%${RESET}`;
    // Daily budget = remaining budget / remaining days (including today)
    const now = new Date();
    const totalDaysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const remainingDays = totalDaysInMonth - now.getDate() + 1; // +1 includes today
    const remainingBudget = Math.max(0, budget - cost);
    const dailyBudget = remainingBudget / remainingDays;
    const todayCost = data.today_cost || 0;
    const dailyPct = Math.round((todayCost / dailyBudget) * 100);
    const dailyColor = dailyPct >= 90 ? '\x1b[31m' : dailyPct >= 75 ? '\x1b[33m' : BRAND_BLUE;
    const dailyFilled = Math.round((Math.min(100, dailyPct) / 100) * barWidth);
    const dailyEmpty = barWidth - dailyFilled;
    const dailyBarStr = `${dailyColor}${'█'.repeat(dailyFilled)}${DIM}${'░'.repeat(dailyEmpty)}${RESET}`;
    const dailyCostStr = `$${todayCost.toFixed(2)}/${dailyBudget.toFixed(0)}`;
    const dailyPctStr = `${dailyColor}${dailyPct}%${RESET}`;
    // Today vs avg daily
    const todayReqs = data.today_requests || 0;
    const todayTokens = data.today_tokens || 0;
    const avgReqs = data.avg_daily_requests || 1;
    const avgTokens = data.avg_daily_tokens || 1;
    const reqPct = Math.round((todayReqs / avgReqs) * 100);
    const tokPct = Math.round((todayTokens / avgTokens) * 100);
    const miniBar = 6;
    const fmtNum = (n) => n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
    const fmtAvg = (n) => n >= 1000000 ? `${(n / 1000000).toFixed(0)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : `${n}`;
    const reqBar = dailyBar(reqPct, miniBar);
    const tokBar = dailyBar(tokPct, miniBar);
    const monthlyPart = `💸 ${bar} ${percentStr} (${costStr})`;
    const dailyBudgetPart = `${dailyBarStr} ${dailyPctStr} (${dailyCostStr})`;
    const reqPctColor = getDailyColor(reqPct);
    const tokPctColor = getDailyColor(tokPct);
    const todayPart = `👅 ${reqBar} ${reqPctColor}${reqPct}%${RESET} ${fmtNum(todayReqs)}/${fmtAvg(avgReqs)} reqs ${dim('|')} 🧠 ${tokBar} ${tokPctColor}${tokPct}%${RESET} ${fmtNum(todayTokens)}/${fmtAvg(avgTokens)} tokens`;
    return `${monthlyPart} │ ${dailyBudgetPart}\n${todayPart}`;
}
//# sourceMappingURL=portkey.js.map