const { callDeepseek, callDeepseekStream } = require('./deepseek');
const { buildSentryPrompt, buildChatPrompt } = require('./prompts');
const { buildContext, markUserActive, getTimeContext, getActiveWindowTitle, getIdleMinutes, isWorkContext } = require('./events');
const { getCurrentMood, triggerEvent, getProactiveInterval } = require('./mood');
const {
  saveMessage, getRecentConversations, getTodayMessageCount,
  getLastPetMessageTime
} = require('./memory');
const { getPetWindow } = require('./window');

let schedulerTimer = null;
let cooldownUntil = null;
let isMuted = false;
let lastErrorMsg = null;
let chatMessageCallback = null;

function onChatMessage(cb) {
  chatMessageCallback = cb;
}

function broadcastMessage(role, content) {
  if (chatMessageCallback) {
    chatMessageCallback({ role, content });
  }
}

function getLastError() {
  return lastErrorMsg;
}

function formatError(err) {
  const msg = err.message || String(err);
  if (msg.includes('API Key') || msg.includes('401')) {
    return `DeepSeek API Key 无效或未配置。\n请在 electron/deepseek.js 中设置 API_KEY。`;
  }
  if (msg.includes('402') || msg.includes('余额')) {
    return `DeepSeek 账户余额不足，请充值后再试。`;
  }
  if (msg.includes('429') || msg.includes('频率')) {
    return `请求太频繁了，稍等一下再试～`;
  }
  if (msg.includes('fetch') || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) {
    return `无法连接到 DeepSeek API，请检查网络连接。\n（${msg}）`;
  }
  if (msg.includes('timed out') || msg.includes('AbortError')) {
    return `DeepSeek API 响应超时（30秒）。\n（${msg}）`;
  }
  if (msg.includes('empty response')) {
    return `API 返回了空内容。\n（${msg}）`;
  }
  return `出错了：${msg}`;
}

async function generateReply(userMessage) {
  markUserActive();
  const sentiment = detectPraiseScold(userMessage);
  if (sentiment) triggerEvent(sentiment);
  triggerEvent('user_interaction');
  saveMessage('user', userMessage);
  broadcastMessage('user', userMessage);

  const conversations = getRecentConversations(10);
  const context = { time: new Date().toLocaleString('zh-CN'), activeWindow: getActiveWindowTitle() };
  const prompt = buildChatPrompt(conversations, getCurrentMood(), context);

  let reply = null;
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      reply = await callDeepseek(prompt, { temperature: 0.8, maxTokens: 150 });
      if (reply) break;
    } catch (err) {
      lastError = err;
      if (attempt === 0) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  if (!reply) {
    lastErrorMsg = formatError(lastError || new Error('unknown'));
    console.error('Chat reply failed:', lastErrorMsg);
    return lastErrorMsg;
  }

  lastErrorMsg = null;
  saveMessage('pet', reply);
  broadcastMessage('pet', reply);

  const petWindow = getPetWindow();
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('update-mood', getCurrentMood());
  }

  return reply;
}

async function generateReplyStreaming(userMessage, chatWindow) {
  markUserActive();
  const sentiment = detectPraiseScold(userMessage);
  if (sentiment) triggerEvent(sentiment);
  triggerEvent('user_interaction');
  saveMessage('user', userMessage);

  const conversations = getRecentConversations(10);
  const context = { time: new Date().toLocaleString('zh-CN'), activeWindow: getActiveWindowTitle() };
  const prompt = buildChatPrompt(conversations, getCurrentMood(), context);

  let reply = null;
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      reply = await callDeepseekStream(prompt, { temperature: 0.8, maxTokens: 150 },
        (_token, fullText) => {
          if (chatWindow && !chatWindow.isDestroyed()) {
            chatWindow.webContents.send('chat-token', fullText);
          }
        }
      );
      if (reply) break;
    } catch (err) {
      lastError = err;
      if (attempt === 0) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  if (!reply) {
    lastErrorMsg = formatError(lastError || new Error('unknown'));
    console.error('Streaming chat reply failed:', lastErrorMsg);
    return lastErrorMsg;
  }

  lastErrorMsg = null;
  saveMessage('pet', reply);
  broadcastMessage('pet', reply);

  const petWindow = getPetWindow();
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('update-mood', getCurrentMood());
  }

  return reply;
}

function setMuted(muted) {
  isMuted = muted;
}

function getNextInterval() {
  const range = getProactiveInterval();
  const minutes = range.min + Math.random() * (range.max - range.min);
  return Math.round(minutes * 60 * 1000);
}

function scheduleNextCheck() {
  if (schedulerTimer) clearTimeout(schedulerTimer);
  const delay = getNextInterval();
  schedulerTimer = setTimeout(proactiveCheck, delay);
}

function extractJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {}
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {}
  }
  return null;
}

async function proactiveCheck() {
  const timeCtx = getTimeContext();
  const idleMin = getIdleMinutes();

  // --- Mood updates based on time / idle (always run) ---
  if (timeCtx.isLateNight) {
    triggerEvent('late_night');
  } else if (timeCtx.isMorning) {
    triggerEvent('morning');
  }

  if (idleMin > 15) {
    triggerEvent('long_idle');
  }

  if (isWorkContext() && idleMin < 5) {
    triggerEvent('long_work');
  }

  // Random periodic drift
  triggerEvent('tick');

  // --- Speak gate ---
  if (timeCtx.isLateNight || isMuted) {
    scheduleNextCheck();
    return;
  }

  if (cooldownUntil && Date.now() < cooldownUntil) {
    scheduleNextCheck();
    return;
  }

  try {
    const context = buildContext({
      todayMessageCount: getTodayMessageCount(),
      recentConversations: formatRecentConvForSentry(),
      minutesSinceLastSpeak: getMinutesSinceLastSpeak()
    }, getCurrentMood());

    const sentryPrompt = buildSentryPrompt(context);
    const rawResponse = await callDeepseek(sentryPrompt, {
      temperature: 0.3,
      maxTokens: 80,
      format: 'json'
    });

    const decision = extractJson(rawResponse) || { should_speak: false };

    if (decision.should_speak && decision.message) {
      await showProactiveMessage(decision.message);
    }

    lastErrorMsg = null;
  } catch (err) {
    lastErrorMsg = formatError(err);
    console.error('Proactive check error:', lastErrorMsg);
  }

  scheduleNextCheck();
}

async function showProactiveMessage(text) {
  const petWindow = getPetWindow();
  if (!petWindow || petWindow.isDestroyed()) return;

  petWindow.webContents.send('show-bubble', text);
  saveMessage('pet', text);
  broadcastMessage('pet', text);

  const mood = triggerEvent('user_interaction');
  petWindow.webContents.send('update-mood', mood);

  cooldownUntil = Date.now() + 2 * 60 * 1000;
}

async function triggerProactiveMessage() {
  markUserActive();
  triggerEvent('user_interaction');

  const context = buildContext({
    todayMessageCount: getTodayMessageCount(),
    recentConversations: formatRecentConvForSentry(),
    minutesSinceLastSpeak: getMinutesSinceLastSpeak()
  }, getCurrentMood());

  const sentryPrompt = buildSentryPrompt(context);
  let decision;

  try {
    const rawResponse = await callDeepseek(sentryPrompt, {
      temperature: 0.8,
      maxTokens: 80,
      format: 'json'
    });
    decision = extractJson(rawResponse) || { should_speak: true, message: '嘿！有什么新鲜事吗？' };
    lastErrorMsg = null;
  } catch (err) {
    lastErrorMsg = formatError(err);
    console.error('Force speak failed:', lastErrorMsg);
    decision = { should_speak: true, message: `唔...${lastErrorMsg}` };
  }

  if (decision.message) {
    await showProactiveMessage(decision.message);
  }
}

function formatRecentConvForSentry() {
  const conversations = getRecentConversations(5);
  if (conversations.length === 0) return '（尚无对话）';
  return conversations.map(c => `[${c.role === 'user' ? '用户' : '宠物'}]: ${c.content.substring(0, 60)}`).join('\n');
}

function detectPraiseScold(text) {
  const praiseKeywords = ['好棒', '厉害', '可爱', '乖', '谢谢', '不错', '真棒', '厉害了', '靠谱', '牛', '赞'];
  const scoldKeywords = ['烦', '滚', '闭嘴', '别吵', '讨厌', '无聊', '笨', '傻', '吵死了', '别说了'];

  if (praiseKeywords.some(k => text.includes(k))) return 'user_praises';
  if (scoldKeywords.some(k => text.includes(k))) return 'user_scolds';
  return null;
}

function getMinutesSinceLastSpeak() {
  const lastTime = getLastPetMessageTime();
  if (!lastTime) return 999;
  const diff = Date.now() - new Date(lastTime).getTime();
  return Math.floor(diff / 60000);
}

function startScheduler() {
  schedulerTimer = setTimeout(proactiveCheck, 60000);
}

function stopScheduler() {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
}

module.exports = {
  startScheduler, stopScheduler, setMuted,
  triggerProactiveMessage, generateReply, generateReplyStreaming,
  scheduleNextCheck, getLastError, onChatMessage
};
