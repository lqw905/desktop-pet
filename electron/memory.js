const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function getEnvBool(key, defaultValue) {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return value !== 'false' && value !== '0';
}

function getEnvInt(key, defaultValue) {
  const value = Number.parseInt(process.env[key], 10);
  return Number.isFinite(value) && value > 0 ? value : defaultValue;
}

function getDefaultSettings() {
  return {
    memoryEnabled: getEnvBool('MEMORY_ENABLED', true),
    saveRawMessages: getEnvBool('SAVE_RAW_MESSAGES', true),
    maxConversations: getEnvInt('MAX_CONVERSATIONS', 100),
    chatContextMessages: getEnvInt('CHAT_CONTEXT_MESSAGES', 4),
    sentryContextMessages: getEnvInt('SENTRY_CONTEXT_MESSAGES', 3),
    summaryMaxChars: getEnvInt('SUMMARY_MAX_CHARS', 1200),
    summaryUpdateEvery: getEnvInt('SUMMARY_UPDATE_EVERY', 10)
  };
}

function createDefaultData() {
  return {
    version: 1,
    settings: getDefaultSettings(),
    profile: {
      userName: '',
      preferences: [],
      facts: [],
      currentProjects: []
    },
    summary: {
      content: '',
      updated_at: null,
      lastSummarizedMessageId: 0
    },
    conversations: [],
    memories: {},
    moodHistory: []
  };
}

let dataPath = null;
let data = createDefaultData();

// Auto-increment ID
let nextId = 1;

function initDatabase() {
  dataPath = path.join(app.getPath('userData'), 'pet-data.json');
  const currentSettings = getDefaultSettings();

  if (currentSettings.memoryEnabled && fs.existsSync(dataPath)) {
    try {
      const raw = fs.readFileSync(dataPath, 'utf-8');
      const parsed = JSON.parse(raw);
      data = {
        ...createDefaultData(),
        ...parsed,
        settings: currentSettings,
        profile: {
          ...createDefaultData().profile,
          ...(parsed.profile || {})
        },
        summary: {
          ...createDefaultData().summary,
          ...(parsed.summary || {})
        }
      };
      // Ensure all keys exist
      data.conversations = data.conversations || [];
      data.memories = data.memories || {};
      data.moodHistory = data.moodHistory || [];

      // Find max ID
      const maxConvId = data.conversations.reduce((max, c) => Math.max(max, c.id || 0), 0);
      nextId = maxConvId + 1;
    } catch {
      // Corrupted file, start fresh
      data = createDefaultData();
    }
  } else {
    data = createDefaultData();
  }

  // Clean old conversations on init
  cleanOldConversations(data.settings.maxConversations);
  saveData();

  return true;
}

function saveData() {
  if (!dataPath || !data.settings.memoryEnabled) return;
  try {
    const persistData = {
      ...data,
      conversations: data.settings.saveRawMessages ? data.conversations : []
    };
    fs.writeFileSync(dataPath, JSON.stringify(persistData, null, 2));
  } catch (err) {
    console.error('Failed to save data:', err.message);
  }
}

// --- Conversations ---
function saveMessage(role, content) {
  const msg = {
    id: nextId++,
    role,
    content,
    created_at: new Date().toISOString()
  };
  data.conversations.push(msg);
  cleanOldConversations(data.settings.maxConversations);
  saveData();
  return msg;
}

function getRecentConversations(limit = 10) {
  const all = data.conversations;
  return all.slice(-limit);
}

function getMemorySettings() {
  return { ...data.settings };
}

function getMemorySummary() {
  return data.summary?.content || '';
}

function setMemorySummary(content) {
  data.summary = {
    content: String(content || '').slice(0, data.settings.summaryMaxChars),
    updated_at: new Date().toISOString(),
    lastSummarizedMessageId: data.conversations.at(-1)?.id || data.summary.lastSummarizedMessageId || 0
  };
  saveData();
  return data.summary;
}

function getProfile() {
  return {
    userName: data.profile.userName || '',
    preferences: data.profile.preferences || [],
    facts: data.profile.facts || [],
    currentProjects: data.profile.currentProjects || []
  };
}

function setProfile(profile = {}) {
  data.profile = {
    userName: typeof profile.userName === 'string' ? profile.userName.slice(0, 80) : data.profile.userName || '',
    preferences: Array.isArray(profile.preferences) ? profile.preferences.slice(0, 12) : data.profile.preferences || [],
    facts: Array.isArray(profile.facts) ? profile.facts.slice(0, 20) : data.profile.facts || [],
    currentProjects: Array.isArray(profile.currentProjects) ? profile.currentProjects.slice(0, 8) : data.profile.currentProjects || []
  };
  saveData();
  return getProfile();
}

function shouldUpdateSummary() {
  if (!data.settings.memoryEnabled) return false;
  const lastMessageId = data.conversations.at(-1)?.id || 0;
  const lastSummarized = data.summary.lastSummarizedMessageId || 0;
  return lastMessageId - lastSummarized >= data.settings.summaryUpdateEvery;
}

function getTodayMessageCount() {
  const today = new Date().toISOString().slice(0, 10);
  return data.conversations.filter(c => c.created_at.startsWith(today)).length;
}

function getLastPetMessageTime() {
  const petMsgs = data.conversations.filter(c => c.role === 'pet');
  if (petMsgs.length === 0) return null;
  return petMsgs[petMsgs.length - 1].created_at;
}

// --- Memories ---
function setMemory(key, value) {
  data.memories[key] = {
    value,
    updated_at: new Date().toISOString()
  };
  saveData();
}

function getMemory(key) {
  const m = data.memories[key];
  return m ? m.value : null;
}

// --- Mood History ---
function saveMood(mood, reason = null) {
  const entry = {
    id: data.moodHistory.length + 1,
    mood,
    reason,
    created_at: new Date().toISOString()
  };
  data.moodHistory.push(entry);
  saveData();
  return entry;
}

function getLastMood() {
  if (data.moodHistory.length === 0) return 'happy';
  return data.moodHistory[data.moodHistory.length - 1].mood;
}

function getLastMoodReason() {
  if (data.moodHistory.length === 0) return null;
  return data.moodHistory[data.moodHistory.length - 1].reason;
}

// --- Cleanup ---
function cleanOldConversations(keepCount = 500) {
  if (data.conversations.length > keepCount) {
    data.conversations = data.conversations.slice(-keepCount);
    saveData();
  }
}

function clearMemory() {
  data.conversations = [];
  data.memories = {};
  data.moodHistory = [];
  data.profile = createDefaultData().profile;
  data.summary = createDefaultData().summary;
  nextId = 1;
  saveData();
}

function closeDatabase() {
  saveData();
  data = createDefaultData();
  dataPath = null;
}

module.exports = {
  initDatabase, saveData, closeDatabase,
  saveMessage, getRecentConversations, getTodayMessageCount, getLastPetMessageTime,
  setMemory, getMemory,
  saveMood, getLastMood, getLastMoodReason,
  cleanOldConversations,
  getMemorySettings, getMemorySummary, setMemorySummary,
  getProfile, setProfile, shouldUpdateSummary, clearMemory
};
