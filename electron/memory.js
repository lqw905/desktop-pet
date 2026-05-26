const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const {
  DEFAULT_PERSONA_ID,
  getPersonas,
  getPersona,
  isBuiltinPersonaId,
  normalizeCustomPersona,
  toPublicPersona
} = require('./personas');

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
    chatContextMessages: getEnvInt('CHAT_CONTEXT_MESSAGES', 10),
    sentryContextMessages: getEnvInt('SENTRY_CONTEXT_MESSAGES', 3),
    memoryReviewEvery: getEnvInt('MEMORY_REVIEW_EVERY', 4),
    maxMemoryItems: getEnvInt('MAX_MEMORY_ITEMS', 80),
    maxInboxItems: getEnvInt('MAX_INBOX_ITEMS', 30),
    memoryContextItems: getEnvInt('MEMORY_CONTEXT_ITEMS', 10),
    summaryMaxChars: getEnvInt('SUMMARY_MAX_CHARS', 1200),
    summaryUpdateEvery: getEnvInt('SUMMARY_UPDATE_EVERY', 10),
    allowHighSensitivityMemory: getEnvBool('ALLOW_HIGH_SENSITIVITY_MEMORY', false)
  };
}

function createDefaultData() {
  return {
    version: 4,
    currentPersonaId: DEFAULT_PERSONA_ID,
    customPersonas: [],
    settings: getDefaultSettings(),
    profile: {
      identity: {},
      userName: '',
      preferences: [],
      dislikes: [],
      habits: [],
      personality: [],
      communicationStyle: [],
      boundaries: [],
      facts: [],
      currentProjects: []
    },
    summary: {
      content: '',
      updated_at: null,
      lastSummarizedMessageId: 0
    },
    memoryItems: [],
    memoryInbox: [],
    audit: {
      lastReviewedMessageId: 0
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
        version: 4,
        currentPersonaId: parsed.currentPersonaId || DEFAULT_PERSONA_ID,
        customPersonas: Array.isArray(parsed.customPersonas) ? parsed.customPersonas : [],
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
      data.customPersonas = data.customPersonas
        .map(persona => normalizeCustomPersona(persona, persona))
        .filter(Boolean);
      if (!getPersonas(data.customPersonas).some(persona => persona.id === data.currentPersonaId)) {
        data.currentPersonaId = DEFAULT_PERSONA_ID;
      }
      data.conversations.forEach(message => {
        if (!message.personaId) message.personaId = DEFAULT_PERSONA_ID;
        if (!message.source) message.source = 'chat';
      });
      data.moodHistory.forEach(entry => {
        if (!entry.personaId) entry.personaId = DEFAULT_PERSONA_ID;
      });
      data.memoryItems = data.memoryItems || [];
      data.memoryInbox = data.memoryInbox || [];
      data.audit = {
        ...createDefaultData().audit,
        ...(parsed.audit || {}),
        lastReviewedMessageId: parsed.audit?.lastReviewedMessageId || parsed.summary?.lastSummarizedMessageId || 0
      };

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
function getCurrentPersonaId() {
  return getPersona(data.currentPersonaId, data.customPersonas).id;
}

function getAllPersonas() {
  return getPersonas(data.customPersonas).map(toPublicPersona);
}

function getCurrentPersona() {
  return getPersona(getCurrentPersonaId(), data.customPersonas);
}

function setCurrentPersonaId(personaId) {
  const persona = getPersona(personaId, data.customPersonas);
  data.currentPersonaId = persona.id;
  saveData();
  return data.currentPersonaId;
}

function saveCustomPersona(input = {}) {
  const existing = input.id && !isBuiltinPersonaId(input.id)
    ? data.customPersonas.find(persona => persona.id === input.id)
    : null;
  const persona = normalizeCustomPersona(input, existing);
  if (!persona) {
    throw new Error('人格名称和提示词不能为空');
  }

  if (existing) {
    const index = data.customPersonas.findIndex(item => item.id === existing.id);
    data.customPersonas[index] = persona;
  } else {
    data.customPersonas.push(persona);
  }
  data.currentPersonaId = persona.id;
  saveData();
  return toPublicPersona({
    ...persona,
    editable: true
  });
}

function deleteCustomPersona(personaId) {
  if (!personaId || isBuiltinPersonaId(personaId)) {
    return { ok: false, currentPersonaId: getCurrentPersonaId() };
  }
  const before = data.customPersonas.length;
  data.customPersonas = data.customPersonas.filter(persona => persona.id !== personaId);
  if (data.currentPersonaId === personaId) {
    data.currentPersonaId = DEFAULT_PERSONA_ID;
  }
  saveData();
  return {
    ok: data.customPersonas.length !== before,
    currentPersonaId: getCurrentPersonaId()
  };
}

function saveMessage(role, content, personaId = getCurrentPersonaId(), source = 'chat') {
  const msg = {
    id: nextId++,
    personaId,
    role,
    content,
    source,
    created_at: new Date().toISOString()
  };
  data.conversations.push(msg);
  cleanOldConversations(data.settings.maxConversations);
  saveData();
  return msg;
}

function getRecentConversations(limit = 10) {
  const personaId = getCurrentPersonaId();
  const all = data.conversations.filter(message => (message.personaId || DEFAULT_PERSONA_ID) === personaId);
  return all.slice(-limit);
}

function getRecentChatConversations(limit = 10) {
  const personaId = getCurrentPersonaId();
  const personaMessages = data.conversations.filter(message => (message.personaId || DEFAULT_PERSONA_ID) === personaId);
  const chatMessages = [];

  personaMessages.forEach((message, index) => {
    if (message.source === 'proactive') return;
    if (message.role === 'user') {
      chatMessages.push(message);
      return;
    }

    const previous = personaMessages[index - 1];
    const isChatReply = message.source === 'chat' && previous?.role === 'user';
    if (message.role === 'pet' && isChatReply) {
      chatMessages.push(message);
    }
  });

  return chatMessages.slice(-limit);
}

function getMemorySettings() {
  return { ...data.settings };
}

function getMemorySummary() {
  return data.summary?.content || '';
}

function setMemorySummary(content, reviewedMessageId = null) {
  data.summary = {
    content: String(content || '').slice(0, data.settings.summaryMaxChars),
    updated_at: new Date().toISOString(),
    lastSummarizedMessageId: reviewedMessageId || data.conversations.at(-1)?.id || data.summary.lastSummarizedMessageId || 0
  };
  saveData();
  return data.summary;
}

function getProfile() {
  return {
    identity: data.profile.identity || {},
    userName: data.profile.userName || '',
    preferences: data.profile.preferences || [],
    dislikes: data.profile.dislikes || [],
    habits: data.profile.habits || [],
    personality: data.profile.personality || [],
    communicationStyle: data.profile.communicationStyle || [],
    boundaries: data.profile.boundaries || [],
    facts: data.profile.facts || [],
    currentProjects: data.profile.currentProjects || []
  };
}

function setProfile(profile = {}) {
  data.profile = {
    identity: typeof profile.identity === 'object' && profile.identity ? profile.identity : data.profile.identity || {},
    userName: typeof profile.userName === 'string' ? profile.userName.slice(0, 80) : data.profile.userName || '',
    preferences: Array.isArray(profile.preferences) ? profile.preferences.slice(0, 12) : data.profile.preferences || [],
    dislikes: Array.isArray(profile.dislikes) ? profile.dislikes.slice(0, 12) : data.profile.dislikes || [],
    habits: Array.isArray(profile.habits) ? profile.habits.slice(0, 12) : data.profile.habits || [],
    personality: Array.isArray(profile.personality) ? profile.personality.slice(0, 12) : data.profile.personality || [],
    communicationStyle: Array.isArray(profile.communicationStyle) ? profile.communicationStyle.slice(0, 12) : data.profile.communicationStyle || [],
    boundaries: Array.isArray(profile.boundaries) ? profile.boundaries.slice(0, 12) : data.profile.boundaries || [],
    facts: Array.isArray(profile.facts) ? profile.facts.slice(0, 20) : data.profile.facts || [],
    currentProjects: Array.isArray(profile.currentProjects) ? profile.currentProjects.slice(0, 8) : data.profile.currentProjects || []
  };
  saveData();
  return getProfile();
}

function mergeUnique(existing = [], incoming = [], limit = 12) {
  const values = [...existing];
  incoming.forEach(item => {
    const text = String(item || '').trim();
    if (text && !values.includes(text)) values.push(text.slice(0, 120));
  });
  return values.slice(0, limit);
}

function mergeProfilePatch(profile = {}) {
  const current = getProfile();
  const merged = {
    identity: { ...current.identity, ...(profile.identity || {}) },
    userName: typeof profile.userName === 'string' && profile.userName.trim() ? profile.userName : current.userName,
    preferences: mergeUnique(current.preferences, profile.preferences, 12),
    dislikes: mergeUnique(current.dislikes, profile.dislikes, 12),
    habits: mergeUnique(current.habits, profile.habits, 12),
    personality: mergeUnique(current.personality, profile.personality, 12),
    communicationStyle: mergeUnique(current.communicationStyle, profile.communicationStyle, 12),
    boundaries: mergeUnique(current.boundaries, profile.boundaries, 12),
    facts: mergeUnique(current.facts, profile.facts, 20),
    currentProjects: mergeUnique(current.currentProjects, profile.currentProjects, 8)
  };
  return setProfile(merged);
}

function shouldReviewMemory() {
  if (!data.settings.memoryEnabled) return false;
  const lastMessageId = data.conversations.at(-1)?.id || 0;
  const lastReviewed = data.audit.lastReviewedMessageId || 0;
  return lastMessageId - lastReviewed >= data.settings.memoryReviewEvery;
}

function getMessagesForMemoryReview(limit = 12) {
  const lastReviewed = data.audit.lastReviewedMessageId || 0;
  return data.conversations.filter(c => c.id > lastReviewed).slice(-limit);
}

function markMemoryReviewed(messageId = null) {
  const lastId = messageId || data.conversations.at(-1)?.id || data.audit.lastReviewedMessageId || 0;
  data.audit.lastReviewedMessageId = Math.max(data.audit.lastReviewedMessageId || 0, lastId);
  data.summary.lastSummarizedMessageId = data.audit.lastReviewedMessageId;
  saveData();
  return data.audit.lastReviewedMessageId;
}

function tokenize(text) {
  return new Set(String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
}

function similarity(a, b) {
  const left = tokenize(a);
  const right = tokenize(b);
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  left.forEach(token => {
    if (right.has(token)) overlap++;
  });
  return overlap / Math.max(left.size, right.size);
}

function normalizeMemoryItem(item = {}) {
  const content = String(item.content || '').trim().slice(0, 120);
  if (!content) return null;
  const sensitivity = ['low', 'medium', 'high'].includes(item.sensitivity) ? item.sensitivity : 'low';
  if (sensitivity === 'high' && !data.settings.allowHighSensitivityMemory) return null;
  return {
    id: item.id || `mem_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    type: String(item.type || 'fact').trim().slice(0, 40),
    content,
    evidence: String(item.evidence || '').trim().slice(0, 80),
    confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0.7)),
    sensitivity,
    sourceMessageIds: Array.isArray(item.sourceMessageIds) ? item.sourceMessageIds.slice(0, 8) : [],
    created_at: item.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_used_at: item.last_used_at || null,
    use_count: Number(item.use_count) || 0,
    status: 'active'
  };
}

function upsertMemoryItems(items = []) {
  const accepted = [];
  items.forEach(raw => {
    const item = normalizeMemoryItem(raw);
    if (!item) return;
    const existing = data.memoryItems.find(current =>
      current.status !== 'deleted' &&
      current.type === item.type &&
      (current.content.includes(item.content) || item.content.includes(current.content) || similarity(current.content, item.content) >= 0.55)
    );

    if (existing) {
      existing.content = item.content.length > existing.content.length ? item.content : existing.content;
      existing.evidence = item.evidence || existing.evidence || '';
      existing.confidence = Math.max(existing.confidence || 0, item.confidence);
      existing.sensitivity = existing.sensitivity === 'high' || item.sensitivity === 'high'
        ? 'high'
        : existing.sensitivity === 'medium' || item.sensitivity === 'medium' ? 'medium' : 'low';
      existing.sourceMessageIds = Array.from(new Set([...(existing.sourceMessageIds || []), ...item.sourceMessageIds])).slice(0, 12);
      existing.updated_at = new Date().toISOString();
      accepted.push(existing);
    } else {
      data.memoryItems.push(item);
      accepted.push(item);
    }
  });

  data.memoryItems = data.memoryItems
    .filter(item => item.status !== 'deleted')
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
    .slice(0, data.settings.maxMemoryItems);
  saveData();
  return accepted;
}

function addMemoryInboxEntry(entry = {}) {
  data.memoryInbox.push({
    id: `inbox_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    shouldPersist: !!entry.shouldPersist,
    reason: String(entry.reason || '').slice(0, 200),
    candidates: Array.isArray(entry.candidates) ? entry.candidates.slice(0, 12) : [],
    acceptedCount: Number(entry.acceptedCount) || 0,
    sourceMessageIds: Array.isArray(entry.sourceMessageIds) ? entry.sourceMessageIds.slice(0, 20) : [],
    created_at: new Date().toISOString()
  });
  data.memoryInbox = data.memoryInbox.slice(-data.settings.maxInboxItems);
  saveData();
}

function getMemoryItems(limit = null) {
  const priority = {
    boundary: 0,
    communication_style: 1,
    preference: 2,
    dislike: 3,
    work_context: 4,
    habit: 5,
    personality: 6,
    emotional_pattern: 7,
    profile_identity: 8,
    relationship: 9,
    fact: 10
  };
  const items = data.memoryItems
    .filter(item => item.status !== 'deleted')
    .sort((a, b) => {
      const rank = (priority[a.type] ?? 50) - (priority[b.type] ?? 50);
      if (rank !== 0) return rank;
      return (b.confidence || 0) - (a.confidence || 0);
    });
  return typeof limit === 'number' ? items.slice(0, limit) : items;
}

function getMemoryContextItems() {
  return getMemoryItems(data.settings.memoryContextItems);
}

function getMemoryStats() {
  return {
    memoryItems: data.memoryItems.filter(item => item.status !== 'deleted').length,
    inboxItems: data.memoryInbox.length,
    lastReviewedMessageId: data.audit.lastReviewedMessageId || 0
  };
}

function applyMemoryReview(review = {}, reviewedMessageId = null) {
  const sourceMessageIds = Array.isArray(review.sourceMessageIds)
    ? review.sourceMessageIds
    : getMessagesForMemoryReview().map(m => m.id);
  addMemoryInboxEntry({
    shouldPersist: review.shouldPersist,
    reason: review.reason,
    candidates: review.memoryItems || review.candidates || [],
    acceptedCount: review.shouldPersist ? (review.memoryItems || []).length : 0,
    sourceMessageIds
  });

  if (review.shouldPersist) {
    upsertMemoryItems(review.memoryItems || []);
    if (review.profilePatch && typeof review.profilePatch === 'object') {
      mergeProfilePatch(review.profilePatch);
    }
    if (review.summaryPatch || review.summary) {
      setMemorySummary(review.summaryPatch || review.summary, reviewedMessageId);
    }
  }

  markMemoryReviewed(reviewedMessageId);
  return getMemoryStats();
}

function getTodayMessageCount() {
  const today = new Date().toISOString().slice(0, 10);
  const personaId = getCurrentPersonaId();
  return data.conversations.filter(c =>
    c.created_at.startsWith(today) &&
    (c.personaId || DEFAULT_PERSONA_ID) === personaId
  ).length;
}

function getLastPetMessageTime() {
  const personaId = getCurrentPersonaId();
  const petMsgs = data.conversations.filter(c =>
    c.role === 'pet' &&
    (c.personaId || DEFAULT_PERSONA_ID) === personaId
  );
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
function saveMood(mood, reason = null, personaId = getCurrentPersonaId()) {
  const entry = {
    id: data.moodHistory.length + 1,
    personaId,
    mood,
    reason,
    created_at: new Date().toISOString()
  };
  data.moodHistory.push(entry);
  saveData();
  return entry;
}

function getLastMood() {
  const personaId = getCurrentPersonaId();
  const entries = data.moodHistory.filter(entry => (entry.personaId || DEFAULT_PERSONA_ID) === personaId);
  if (entries.length === 0) return 'happy';
  return entries[entries.length - 1].mood;
}

function getLastMoodReason() {
  const personaId = getCurrentPersonaId();
  const entries = data.moodHistory.filter(entry => (entry.personaId || DEFAULT_PERSONA_ID) === personaId);
  if (entries.length === 0) return null;
  return entries[entries.length - 1].reason;
}

// --- Cleanup ---
function cleanOldConversations(keepCount = 500) {
  if (data.conversations.length > keepCount) {
    data.conversations = data.conversations.slice(-keepCount);
    saveData();
  }
}

function clearMemory() {
  data.currentPersonaId = DEFAULT_PERSONA_ID;
  data.conversations = [];
  data.memories = {};
  data.moodHistory = [];
  data.memoryItems = [];
  data.memoryInbox = [];
  data.audit = createDefaultData().audit;
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
  getCurrentPersonaId, setCurrentPersonaId,
  getAllPersonas, getCurrentPersona, saveCustomPersona, deleteCustomPersona,
  saveMessage, getRecentConversations, getRecentChatConversations, getTodayMessageCount, getLastPetMessageTime,
  setMemory, getMemory,
  saveMood, getLastMood, getLastMoodReason,
  cleanOldConversations,
  getMemorySettings, getMemorySummary, setMemorySummary,
  getProfile, setProfile, mergeProfilePatch,
  shouldReviewMemory, getMessagesForMemoryReview, markMemoryReviewed,
  applyMemoryReview, getMemoryItems, getMemoryContextItems, getMemoryStats,
  clearMemory
};
