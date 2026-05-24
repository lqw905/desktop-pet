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
let isBubbleEnabled = true;
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
  const fastSentiment = detectSentimentFast(userMessage);
  if (fastSentiment) triggerEvent(fastSentiment);
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

  // 异步 LLM 情绪分析（不阻塞回复）
  analyzeSentimentLLM(userMessage, conversations).then(llmSentiment => {
    if (llmSentiment) triggerEvent(llmSentiment);
  });

  return reply;
}

async function generateReplyStreaming(userMessage, chatWindow) {
  markUserActive();
  const fastSentiment = detectSentimentFast(userMessage);
  if (fastSentiment) triggerEvent(fastSentiment);
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

  // 异步 LLM 情绪分析（不阻塞回复）
  analyzeSentimentLLM(userMessage, conversations).then(llmSentiment => {
    if (llmSentiment) triggerEvent(llmSentiment);
  });

  return reply;
}

function setMuted(muted) {
  isMuted = muted;
}

function setBubbleEnabled(enabled) {
  isBubbleEnabled = enabled;
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

  saveMessage('pet', text);
  broadcastMessage('pet', text);

  if (isBubbleEnabled) {
    petWindow.webContents.send('show-bubble', text);
  }

  const mood = triggerEvent('user_interaction');
  petWindow.webContents.send('update-mood', mood);

  cooldownUntil = Date.now() + 1 * 60 * 1000;
}

const QUICK_GREETINGS = [
  '嘿！你来啦~',
  '嗯？叫我吗？',
  '在呢在呢！',
  '哈喽~',
  '诶？怎么啦？',
  '我一直都在哦~',
  '来啦来啦！',
  '有什么好玩的吗？',
  '今天过得怎么样？',
  '我在想你呢~',
  '嘿嘿，被你发现了',
  '叮咚！你的小伴已上线~',
];

function getRandomGreeting() {
  return QUICK_GREETINGS[Math.floor(Math.random() * QUICK_GREETINGS.length)];
}

async function triggerProactiveMessage() {
  markUserActive();
  triggerEvent('user_interaction');

  // 立即显示本地问候语，不用等 API 响应
  const quickGreeting = getRandomGreeting();
  showBubbleOnly(quickGreeting);

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
    // API 失败了也不怕，本地问候语已经显示了
    return;
  }

  // 用 AI 生成的内容替换本地问候语
  if (decision.message) {
    await showProactiveMessage(decision.message);
  }
}

// 只显示气泡，不保存消息、不触发广播（用于即时反馈）
function showBubbleOnly(text) {
  const petWindow = getPetWindow();
  if (!petWindow || petWindow.isDestroyed()) return;
  if (isBubbleEnabled) {
    petWindow.webContents.send('show-bubble', text);
  }
}

function formatRecentConvForSentry() {
  const conversations = getRecentConversations(5);
  if (conversations.length === 0) return '（尚无对话）';
  return conversations.map(c => `[${c.role === 'user' ? '用户' : '宠物'}]: ${c.content.substring(0, 60)}`).join('\n');
}

// 本地快速关键词检测（即时、无网络延迟）
const SENTIMENT_KEYWORDS = {
  user_praises:       ['好棒', '厉害', '可爱', '乖', '谢谢', '不错', '真棒', '牛', '赞', '靠谱', '厉害了', '你好聪明', '牛逼', '好厉害'],
  user_scolds:        ['烦', '滚', '闭嘴', '别吵', '讨厌', '笨', '傻', '吵死了', '别说了', '走开', '别烦我'],
  user_happy:         ['哈哈', '嘿嘿', '嘻嘻', '笑死', '开心', '好玩', '有趣', '有意思', '哈哈哈', 'hhhh', 'www'],
  user_sad:           ['难过', '伤心', '哭', '难受', '郁闷', '不开心', '心累', '崩溃', '好累', '唉', 'emo'],
  user_angry:         ['气死', '生气', '愤怒', '火大', '离谱', '无语', '恶心', '垃圾'],
  user_affectionate:  ['抱抱', '摸摸', '贴贴', '亲亲', '想你', '喜欢', '爱你', '宝贝', '小伴', '乖乖'],
};

function detectSentimentFast(text) {
  for (const [event, keywords] of Object.entries(SENTIMENT_KEYWORDS)) {
    if (keywords.some(k => text.includes(k))) return event;
  }
  return null;
}

// LLM 深度情绪分析（异步、不阻塞回复）
async function analyzeSentimentLLM(userMessage, conversations) {
  const recent = conversations.slice(-4).map(c =>
    `[${c.role === 'user' ? '用户' : '宠物'}]: ${c.content.substring(0, 100)}`
  ).join('\n');

  const prompt = `分析用户最后一条消息的情绪。只输出一个词。

对话记录：
${recent}

情绪选项：happy(开心), angry(生气), sad(难过), affectionate(撒娇亲近), neutral(中性)

只输出一个词：`;

  try {
    const result = await callDeepseek(prompt, { temperature: 0, maxTokens: 5 });
    const sentiment = (result || '').trim().toLowerCase();

    const mapping = {
      'happy': 'user_happy',
      'angry': 'user_angry',
      'sad': 'user_sad',
      'affectionate': 'user_affectionate',
      'neutral': null,
    };

    return mapping[sentiment] || null;
  } catch {
    return null;
  }
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
  startScheduler, stopScheduler, setMuted, setBubbleEnabled,
  triggerProactiveMessage, generateReply, generateReplyStreaming,
  scheduleNextCheck, getLastError, onChatMessage
};
