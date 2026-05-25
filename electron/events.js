const { execFileSync, execSync } = require('child_process');
const path = require('path');

const PET_WINDOW_TITLES = ['Chat with Pet', 'Desktop Pet'];

let idleStartTime = null;
let idleChecked = false;
let cachedWindowTitle = null;
let cachedWindowAt = 0;
let lastUserWindow = null;

function getActiveWindowTitle() {
  const now = Date.now();

  // Only run the detection if cache expired
  if (!cachedWindowTitle || now - cachedWindowAt >= 20000) {
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
  }

  // Ignore pet's own windows — return the last real user window instead
  if (cachedWindowTitle && PET_WINDOW_TITLES.some(t => cachedWindowTitle.includes(t))) {
    return lastUserWindow;
  }

  // Remember this as the last real user window
  if (cachedWindowTitle) {
    lastUserWindow = cachedWindowTitle;
  }

  return cachedWindowTitle;
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
  const activeWindow = getActiveWindowTitle();

  return {
    time: `${timeCtx.weekday} ${timeCtx.time}`,
    idleMinutes: idleMin,
    period: timeCtx.period,
    isLateNight: timeCtx.isLateNight,
    isMorning: timeCtx.isMorning,
    isWeekend: timeCtx.isWeekend,
    isWorkContext: isWorkContext(),
    activeWindow,
    mood,
    ...conversationContext
  };
}

module.exports = { getTimeContext, getIdleMinutes, markUserActive, isWorkContext, buildContext, getActiveWindowTitle };
