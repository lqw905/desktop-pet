const { callDeepseek, callDeepseekStream } = require('./deepseek');
const { buildSentryPrompt, buildChatPrompt } = require('./prompts');
const { buildContext, markUserActive, getTimeContext, getActiveWindowContext, getIdleMinutes, isWorkContext } = require('./events');
const { getCurrentMood, triggerEvent, getProactiveInterval } = require('./mood');
const {
  saveMessage, getRecentConversations, getTodayMessageCount,
  getLastPetMessageTime, getMemorySettings, getMemorySummary,
  getProfile, shouldReviewMemory, getMessagesForMemoryReview,
  markMemoryReviewed, applyMemoryReview, getMemoryContextItems,
  getCurrentPersonaId, getCurrentPersona
} = require('./memory');
const { getPetWindow } = require('./window');

let schedulerTimer = null;
let cooldownUntil = null;
let isMuted = false;
let isBubbleEnabled = true;
let lastErrorMsg = null;
let chatMessageCallback = null;
let isUpdatingMemory = false;
let lastMemoryUpdateErrorAt = 0;

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
    return `AI API Key 无效或未配置。\n请在 .env 中设置 AI_API_KEY。`;
  }
  if (msg.includes('402') || msg.includes('余额')) {
    return `AI 账户余额不足，请充值后再试。`;
  }
  if (msg.includes('429') || msg.includes('频率')) {
    return `请求太频繁了，稍等一下再试～`;
  }
  if (msg.includes('fetch') || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) {
    return `无法连接到 AI API，请检查网络连接。\n（${msg}）`;
  }
  if (msg.includes('timed out') || msg.includes('AbortError')) {
    return `AI API 响应超时（30秒）。\n（${msg}）`;
  }
  if (msg.includes('empty response')) {
    return `API 返回了空内容。\n（${msg}）`;
  }
  return `出错了：${msg}`;
}

function cleanPetReply(text, persona = getCurrentPersona()) {
  let cleaned = String(text || '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n');

  if (!persona?.preserveExpressiveStyle) {
    cleaned = cleaned
      .replace(/^\s*(呜+|哇+|呀+)[，,、\s]*/g, '')
      .replace(/^\s*主人[，,！!。.\s]*/g, '')
      .replace(/主人/g, '你');
  }

  return cleaned.trim();
}

function normalizeReplyForCompare(text) {
  return String(text || '')
    .replace(/<\s*br\s*\/?\s*>/gi, '')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/[\s，,。.!！?？、~～…（）()"'“”‘’：:；;]/g, '')
    .toLowerCase();
}

function getLastPetReply(conversations = []) {
  return [...conversations].reverse().find(message => message.role === 'pet')?.content || '';
}

function isRepeatedPetReply(reply, conversations = []) {
  const current = normalizeReplyForCompare(reply);
  const previous = normalizeReplyForCompare(getLastPetReply(conversations));
  return !!current && current === previous;
}

async function retryRepeatedReply(reply, prompt, conversations, persona) {
  const cleaned = cleanPetReply(reply, persona);
  if (!isRepeatedPetReply(cleaned, conversations)) return cleaned;

  const retryPrompt = `${prompt}

重要：你刚才重复了上一条宠物回复。不要再说“${getLastPetReply(conversations)}”。
请重新阅读“当前用户刚说”，换一个内容直接回应。`;

  const retry = await callDeepseek(retryPrompt, { temperature: 0.9, maxTokens: 150 });
  const retryCleaned = cleanPetReply(retry, persona);
  return isRepeatedPetReply(retryCleaned, conversations) ? cleaned : retryCleaned;
}

async function generateReply(userMessage) {
  markUserActive();
  const fastSentiment = detectSentimentFast(userMessage);
  if (fastSentiment) triggerEvent(fastSentiment);
  triggerEvent('user_interaction');
  saveMessage('user', userMessage);
  broadcastMessage('user', userMessage);

  const settings = getMemorySettings();
  const conversations = getRecentConversations(settings.chatContextMessages);
  const windowContext = getActiveWindowContext();
  const context = {
    personaId: getCurrentPersonaId(),
    persona: getCurrentPersona(),
    currentUserMessage: userMessage,
    time: new Date().toLocaleString('zh-CN'),
    ...windowContext,
    memorySummary: getMemorySummary(),
    profile: getProfile(),
    memoryItems: getMemoryContextItems()
  };
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

  reply = await retryRepeatedReply(reply, prompt, conversations, context.persona);
  lastErrorMsg = null;
  saveMessage('pet', reply);
  broadcastMessage('pet', reply);
  maybeUpdateLongTermMemory().catch(() => {});

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

  const settings = getMemorySettings();
  const conversations = getRecentConversations(settings.chatContextMessages);
  const windowContext = getActiveWindowContext();
  const context = {
    personaId: getCurrentPersonaId(),
    persona: getCurrentPersona(),
    currentUserMessage: userMessage,
    time: new Date().toLocaleString('zh-CN'),
    ...windowContext,
    memorySummary: getMemorySummary(),
    profile: getProfile(),
    memoryItems: getMemoryContextItems()
  };
  const prompt = buildChatPrompt(conversations, getCurrentMood(), context);

  let reply = null;
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      reply = await callDeepseekStream(prompt, { temperature: 0.8, maxTokens: 150 },
        (_token, fullText) => {
          if (chatWindow && !chatWindow.isDestroyed()) {
            chatWindow.webContents.send('chat-token', cleanPetReply(fullText, context.persona));
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

  reply = await retryRepeatedReply(reply, prompt, conversations, context.persona);
  lastErrorMsg = null;
  saveMessage('pet', reply);
  broadcastMessage('pet', reply);
  maybeUpdateLongTermMemory().catch(() => {});

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
      personaId: getCurrentPersonaId(),
      persona: getCurrentPersona(),
      todayMessageCount: getTodayMessageCount(),
      recentConversations: formatRecentConvForSentry(),
      minutesSinceLastSpeak: getMinutesSinceLastSpeak(),
      memorySummary: getMemorySummary()
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
  text = cleanPetReply(text);

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
    personaId: getCurrentPersonaId(),
    persona: getCurrentPersona(),
    todayMessageCount: getTodayMessageCount(),
    recentConversations: formatRecentConvForSentry(),
    minutesSinceLastSpeak: getMinutesSinceLastSpeak(),
    memorySummary: getMemorySummary()
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
  const settings = getMemorySettings();
  const conversations = getRecentConversations(settings.sentryContextMessages);
  if (conversations.length === 0) return '（尚无对话）';
  return conversations.map(c => `[${c.role === 'user' ? '用户' : '宠物'}]: ${c.content.substring(0, 60)}`).join('\n');
}

async function maybeUpdateLongTermMemory() {
  const settings = getMemorySettings();
  if (!settings.memoryEnabled || !shouldReviewMemory() || isUpdatingMemory) return;
  if (Date.now() - lastMemoryUpdateErrorAt < 10 * 60 * 1000) return;

  const messages = getMessagesForMemoryReview(Math.max(settings.memoryReviewEvery, 10));
  if (messages.length === 0) return;

  if (!hasMemorySignal(messages)) {
    markMemoryReviewed(messages.at(-1)?.id);
    return;
  }

  isUpdatingMemory = true;
  try {
    const existingSummary = getMemorySummary();
    const existingProfile = getProfile();
    const existingMemories = getMemoryContextItems();
    const recentText = messages.map(m =>
      `[${m.role === 'user' ? '用户' : '宠物'}]: ${m.content.substring(0, 220)}`
    ).join('\n');

    const prompt = `你是桌宠“小伴”的长期记忆审查器。你的任务不是总结聊天，而是判断哪些信息未来陪伴主人时值得长期记住。

保存倾向：
- 凡是涉及主人的个人信息、习惯、喜好、厌恶、性格、沟通方式、项目目标、长期边界、与桌宠的互动偏好，都倾向保存
- 即使只出现一次，只要是明确偏好或稳定事实，也可以保存
- 不要保存 API Key、密码、token、cookie、身份证、详细地址、财务、医疗等高敏信息，除非主人明确要求“记住”
- 不要保存一次性错误日志、临时命令输出、大段代码原文
- 相似记忆要合并成更短更稳定的表达

记忆类型只能使用：
profile_identity, preference, dislike, habit, personality, communication_style, work_context, emotional_pattern, boundary, relationship, fact

敏感度：
low=普通偏好/项目上下文；medium=性格/习惯/情绪模式；high=身份位置健康财务等高敏信息

输出要求：
- 只输出 JSON，不要解释
- 每条 memoryItems.content 不超过 80 个中文字符
- evidence 不超过 40 个中文字符
- summaryPatch 不超过 ${settings.summaryMaxChars} 个中文字符

旧长期摘要：
${existingSummary || '（无）'}

旧用户画像：
${JSON.stringify(existingProfile)}

已有关键记忆：
${existingMemories.map(m => `- ${m.type}: ${m.content}`).join('\n') || '（无）'}

待审查对话：
${recentText}

JSON 格式：
{
  "shouldPersist": true或false,
  "reason": "判断理由",
  "sourceMessageIds": [消息id],
  "memoryItems": [
    {
      "type": "communication_style",
      "content": "主人偏好先看方案，再决定是否改代码。",
      "evidence": "用户说先给方案",
      "confidence": 0.95,
      "sensitivity": "low",
      "sourceMessageIds": [1,2]
    }
  ],
  "profilePatch": {
    "identity": {},
    "userName": "",
    "preferences": [],
    "dislikes": [],
    "habits": [],
    "personality": [],
    "communicationStyle": [],
    "boundaries": [],
    "facts": [],
    "currentProjects": []
  },
  "summaryPatch": "长期摘要补丁"
}`;

    const raw = await callDeepseek(prompt, {
      temperature: 0.2,
      maxTokens: 900,
      format: 'json'
    });
    const parsed = extractJson(raw);
    applyMemoryReview(parsed || { shouldPersist: false, reason: 'LLM 未返回有效审查结果' }, messages.at(-1)?.id);
    lastMemoryUpdateErrorAt = 0;
  } catch (err) {
    lastMemoryUpdateErrorAt = Date.now();
    console.error('Long-term memory update failed:', err.message || String(err));
  } finally {
    isUpdatingMemory = false;
  }
}

function hasMemorySignal(messages) {
  const text = messages
    .filter(m => m.role === 'user')
    .map(m => m.content)
    .join('\n');
  if (!text) return false;
  const patterns = [
    /记住|别忘|以后|下次|每次|总是|不要|别再|希望|喜欢|不喜欢|讨厌/,
    /我叫|我是|我的名字|称呼我|叫我|主人/,
    /我习惯|我一般|我经常|我通常|我比较|我在意|我偏好/,
    /先.*方案|先.*解释|直接.*操作|直接.*改|少废话|简短|详细/,
    /性格|习惯|喜好|偏好|隐私|边界|风格/,
    /项目|长期|目标|正在做|计划|工作流/
  ];
  return patterns.some(pattern => pattern.test(text));
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
  scheduleNextCheck, getLastError, onChatMessage,
  // 导出用于测试
  extractJson, formatError, cleanPetReply, normalizeReplyForCompare,
  isRepeatedPetReply, detectSentimentFast, hasMemorySignal,
  getRandomGreeting, QUICK_GREETINGS, SENTIMENT_KEYWORDS
};
