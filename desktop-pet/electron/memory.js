const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let dataPath = null;
let data = {
  conversations: [],
  memories: {},
  moodHistory: []
};

// Auto-increment ID
let nextId = 1;

function initDatabase() {
  dataPath = path.join(app.getPath('userData'), 'pet-data.json');

  if (fs.existsSync(dataPath)) {
    try {
      const raw = fs.readFileSync(dataPath, 'utf-8');
      data = JSON.parse(raw);
      // Ensure all keys exist
      data.conversations = data.conversations || [];
      data.memories = data.memories || {};
      data.moodHistory = data.moodHistory || [];

      // Find max ID
      const maxConvId = data.conversations.reduce((max, c) => Math.max(max, c.id || 0), 0);
      nextId = maxConvId + 1;
    } catch {
      // Corrupted file, start fresh
      data = { conversations: [], memories: {}, moodHistory: [] };
    }
  }

  // Clean old conversations on init
  cleanOldConversations(500);
  saveData();

  return true;
}

function saveData() {
  if (!dataPath) return;
  try {
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
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
  saveData();
  return msg;
}

function getRecentConversations(limit = 10) {
  const all = data.conversations;
  return all.slice(-limit);
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

function closeDatabase() {
  saveData();
  data = { conversations: [], memories: {}, moodHistory: [] };
  dataPath = null;
}

module.exports = {
  initDatabase, saveData, closeDatabase,
  saveMessage, getRecentConversations, getTodayMessageCount, getLastPetMessageTime,
  setMemory, getMemory,
  saveMood, getLastMood, getLastMoodReason,
  cleanOldConversations
};
