const { execFileSync, execSync } = require('child_process');
const path = require('path');

const PET_WINDOW_TITLES = ['Chat with Pet', 'Desktop Pet'];
const PET_WINDOW_APPS = ['Electron'];
const ACTIVE_WINDOW_CACHE_MS = 5000;
const MAX_RECENT_WINDOWS = 5;

let idleStartTime = null;
let idleChecked = false;
let cachedWindowTitle = null;
let cachedWindowInfo = null;
let cachedWindowAt = 0;
let lastUserWindow = null;
let lastUserWindowInfo = null;
let recentWindows = [];

function parseActiveWindow(rawTitle) {
  const raw = String(rawTitle || '').trim();
  if (!raw) return null;
  const separator = raw.indexOf(' - ');
  if (separator === -1) {
    return {
      raw,
      app: raw,
      title: '',
      activityType: classifyActivity(raw, '')
    };
  }
  const app = raw.slice(0, separator).trim();
  const title = raw.slice(separator + 3).trim();
  return {
    raw,
    app,
    title,
    activityType: classifyActivity(app, title)
  };
}

function classifyActivity(app, title) {
  const text = `${app} ${title}`.toLowerCase();
  const rules = [
    ['coding', ['cursor', 'visual studio code', 'vscode', 'webstorm', 'intellij', 'xcode', 'sublime', 'atom']],
    ['terminal', ['terminal', 'iterm', 'warp', 'hyper']],
    ['browser', ['chrome', 'safari', 'firefox', 'edge', 'arc', 'browser']],
    ['writing', ['word', 'pages', 'notes', 'notion', 'obsidian', 'typora', 'markdown']],
    ['design', ['figma', 'sketch', 'photoshop', 'illustrator']],
    ['files', ['finder']],
    ['chat', ['wechat', '微信', 'slack', 'discord', 'telegram', 'messages', 'qq']],
    ['media', ['music', 'spotify', 'youtube', 'vlc', 'quicktime']]
  ];
  const match = rules.find(([, keywords]) => keywords.some(keyword => text.includes(keyword)));
  return match ? match[0] : 'unknown';
}

function isPetWindow(rawTitle) {
  return rawTitle && PET_WINDOW_TITLES.some(t => rawTitle.includes(t));
}

function isPetWindowInfo(info) {
  if (!info) return false;
  return isPetWindow(info.raw) || PET_WINDOW_APPS.includes(info.app);
}

function rememberActiveWindow(info) {
  if (!info) return;
  const previous = recentWindows[recentWindows.length - 1];
  if (previous && previous.raw === info.raw) {
    previous.at = Date.now();
    return;
  }

  recentWindows.push({ ...info, at: Date.now() });
  recentWindows = recentWindows.slice(-MAX_RECENT_WINDOWS);
}

function getRecentWindowSwitches() {
  const cutoff = Date.now() - 60 * 1000;
  return recentWindows.filter(item => item.at >= cutoff).length;
}

function getActiveWindowTitle() {
  return getActiveWindowContext().activeWindow;
}

function getActiveWindowContext() {
  const now = Date.now();

  // Only run the detection if cache expired
  if (!cachedWindowInfo || now - cachedWindowAt >= ACTIVE_WINDOW_CACHE_MS) {
    try {
      if (process.platform === 'win32') {
        const scriptPath = path.join(__dirname, 'get-window.ps1');
        cachedWindowTitle = execSync(`chcp 65001 >nul && powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`, {
          timeout: 3000,
          encoding: 'utf-8',
          windowsHide: true
        }).trim() || null;
      } else if (process.platform === 'darwin') {
        cachedWindowTitle = execFileSync('osascript', [
          '-e', 'tell application "System Events"',
          '-e', 'set frontApp to name of first application process whose frontmost is true',
          '-e', 'tell process frontApp',
          '-e', 'try',
          '-e', 'set winTitle to name of front window',
          '-e', 'on error',
          '-e', 'set winTitle to ""',
          '-e', 'end try',
          '-e', 'end tell',
          '-e', 'end tell',
          '-e', 'if winTitle is "" then',
          '-e', 'return frontApp',
          '-e', 'else',
          '-e', 'return frontApp & " - " & winTitle',
          '-e', 'end if'
        ], {
          timeout: 3000,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore']
        }).trim() || null;
      } else {
        cachedWindowTitle = null;
      }
    } catch {
      cachedWindowTitle = null;
    }
    cachedWindowAt = now;
    cachedWindowInfo = parseActiveWindow(cachedWindowTitle);
  }

  // Ignore pet's own windows — return the last real user window instead
  if (isPetWindowInfo(cachedWindowInfo)) {
    return {
      activeWindow: lastUserWindow,
      activeApp: lastUserWindowInfo?.app || null,
      activeWindowTitle: lastUserWindowInfo?.title || null,
      activityType: lastUserWindowInfo?.activityType || 'unknown',
      recentWindowSwitches: getRecentWindowSwitches(),
      recentApps: recentWindows.map(item => item.app).filter(Boolean)
    };
  }

  // Remember this as the last real user window
  if (cachedWindowTitle && cachedWindowInfo) {
    lastUserWindow = cachedWindowTitle;
    lastUserWindowInfo = cachedWindowInfo;
    rememberActiveWindow(cachedWindowInfo);
  }

  return {
    activeWindow: cachedWindowTitle,
    activeApp: cachedWindowInfo?.app || null,
    activeWindowTitle: cachedWindowInfo?.title || null,
    activityType: cachedWindowInfo?.activityType || 'unknown',
    recentWindowSwitches: getRecentWindowSwitches(),
    recentApps: recentWindows.map(item => item.app).filter(Boolean)
  };
}

/**
 * Get current time context
 */
function getTimeContext() {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0=Sun, 6=Sat
  const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];

  let period;
  if (hour >= 6 && hour < 9) period = 'morning';
  else if (hour >= 9 && hour < 12) period = 'work_morning';
  else if (hour >= 12 && hour < 14) period = 'noon';
  else if (hour >= 14 && hour < 18) period = 'work_afternoon';
  else if (hour >= 18 && hour < 22) period = 'evening';
  else period = 'night';

  return {
    time: now.toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    weekday: `周${weekdayNames[day]}`,
    hour,
    period,
    isLateNight: hour >= 23 || hour < 6,
    isMorning: hour >= 6 && hour < 9,
    isWeekend: day === 0 || day === 6
  };
}

/**
 * Get idle time in minutes.
 * On Windows: uses a simple heuristic based on last user interaction timestamp.
 * In a future iteration: use powerMonitor or native addon for precise idle time.
 */
function getIdleMinutes() {
  // Store the last time we know the user was active
  // This gets updated when user sends messages or interacts with the pet
  if (!idleStartTime) {
    idleStartTime = Date.now();
  }
  return Math.floor((Date.now() - idleStartTime) / 60000);
}

/**
 * Mark user as active (called on any user interaction)
 */
function markUserActive() {
  idleStartTime = Date.now();
}

/**
 * Detect if this is a "long work session" context
 * Returns true if it's working hours on a weekday and user has been active recently
 */
function isWorkContext() {
  const ctx = getTimeContext();
  const hour = ctx.hour;
  return !ctx.isWeekend && (ctx.period === 'work_morning' || ctx.period === 'work_afternoon');
}

/**
 * Build a complete context object for the sentry prompt
 */
function buildContext(conversationContext, mood) {
  const timeCtx = getTimeContext();
  const idleMin = getIdleMinutes();
  const windowContext = getActiveWindowContext();

  return {
    time: `${timeCtx.weekday} ${timeCtx.time}`,
    idleMinutes: idleMin,
    period: timeCtx.period,
    isLateNight: timeCtx.isLateNight,
    isMorning: timeCtx.isMorning,
    isWeekend: timeCtx.isWeekend,
    isWorkContext: isWorkContext(),
    ...windowContext,
    mood,
    ...conversationContext
  };
}

module.exports = { getTimeContext, getIdleMinutes, markUserActive, isWorkContext, buildContext, getActiveWindowTitle, getActiveWindowContext };
