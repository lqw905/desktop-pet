const { saveMood, getLastMood, getCurrentPersonaId, setCurrentPersonaId } = require('./memory');

const MOODS = ['happy', 'excited', 'bored', 'sleepy', 'caring'];

let currentMoodByPersona = {};
let onChangeCallback = null;
let preManualMoodByPersona = {};

function getStoredMood(personaId = getCurrentPersonaId()) {
  return currentMoodByPersona[personaId] || 'happy';
}

function onMoodChange(cb) {
  onChangeCallback = cb;
}

function setMood(mood) {
  const personaId = getCurrentPersonaId();
  const currentMood = getStoredMood(personaId);
  if (!MOODS.includes(mood)) return currentMood;
  if (preManualMoodByPersona[personaId] === undefined) preManualMoodByPersona[personaId] = currentMood;
  const oldMood = currentMood;
  currentMoodByPersona[personaId] = mood;
  saveMood(mood, 'manual', personaId);
  if (onChangeCallback) {
    onChangeCallback({ mood, reason: 'manual', oldMood, personaId });
  }
  return mood;
}

function resetMood() {
  const personaId = getCurrentPersonaId();
  if (preManualMoodByPersona[personaId] !== undefined) {
    currentMoodByPersona[personaId] = preManualMoodByPersona[personaId];
    delete preManualMoodByPersona[personaId];
    saveMood(currentMoodByPersona[personaId], 'reset_auto', personaId);
    if (onChangeCallback) {
      onChangeCallback({ mood: currentMoodByPersona[personaId], reason: 'reset_auto', personaId });
    }
  }
  return getStoredMood(personaId);
}

function initMood() {
  const personaId = getCurrentPersonaId();
  currentMoodByPersona[personaId] = getLastMood();
  return currentMoodByPersona[personaId];
}

function switchPersona(personaId) {
  const activePersonaId = setCurrentPersonaId(personaId);
  currentMoodByPersona[activePersonaId] = getLastMood();
  return {
    personaId: activePersonaId,
    mood: currentMoodByPersona[activePersonaId]
  };
}

function getCurrentMood() {
  return getStoredMood();
}

/**
 * Transition mood based on trigger events
 */
function triggerEvent(event) {
  const personaId = getCurrentPersonaId();
  let currentMood = getStoredMood(personaId);
  const oldMood = currentMood;
  const r = Math.random();

  switch (event) {
    case 'user_interaction':
      if (currentMood === 'bored') currentMood = r < 0.7 ? 'happy' : 'excited';
      else if (currentMood === 'sleepy') currentMood = r < 0.5 ? 'caring' : 'happy';
      else if (currentMood === 'excited' && r < 0.4) currentMood = 'happy'; // calm down
      else if (currentMood === 'caring' && r < 0.3) currentMood = 'happy';
      else if (currentMood === 'happy') {
        if (r < 0.35) currentMood = 'excited';
        else if (r < 0.5) currentMood = 'caring';
      }
      break;

    case 'long_idle':
      if (currentMood === 'happy') currentMood = 'bored';
      else if (currentMood === 'excited') currentMood = r < 0.5 ? 'happy' : 'bored';
      else if (currentMood === 'caring' && r < 0.4) currentMood = 'bored';
      break;

    case 'late_night':
      currentMood = 'sleepy';
      break;

    case 'morning':
      if (currentMood === 'sleepy') currentMood = 'happy';
      else if (r < 0.3) currentMood = 'happy';
      break;

    case 'long_work':
      if (currentMood !== 'sleepy') {
        currentMood = r < 0.6 ? 'caring' : 'happy';
      }
      break;

    case 'user_praises':
      currentMood = r < 0.6 ? 'happy' : 'excited';
      break;

    case 'user_scolds':
      if (currentMood === 'excited') currentMood = 'happy';
      else if (currentMood === 'happy') currentMood = 'bored';
      else currentMood = 'bored';
      break;

    case 'user_happy':
      // 用户聊得开心
      if (currentMood === 'bored') currentMood = 'happy';
      else if (currentMood === 'sleepy') currentMood = r < 0.5 ? 'happy' : 'caring';
      else if (currentMood === 'happy' && r < 0.3) currentMood = 'excited';
      else if (currentMood === 'caring' && r < 0.3) currentMood = 'excited';
      break;

    case 'user_angry':
      // 用户生气了
      if (currentMood === 'excited') currentMood = 'happy';
      else if (currentMood === 'happy') currentMood = 'bored';
      else if (currentMood === 'caring') currentMood = 'bored';
      break;

    case 'user_sad':
      // 用户难过 → 宠物变关心
      if (currentMood !== 'sleepy') currentMood = r < 0.7 ? 'caring' : 'happy';
      break;

    case 'user_affectionate':
      // 用户撒娇/亲近
      currentMood = r < 0.5 ? 'excited' : 'caring';
      break;

    case 'tick':
      // Periodic random drift — small chance each proactive check
      if (currentMood === 'happy' && r < 0.15) currentMood = r < 0.5 ? 'excited' : 'caring';
      else if (currentMood === 'excited' && r < 0.25) currentMood = 'happy';
      else if (currentMood === 'caring' && r < 0.25) currentMood = 'happy';
      else if (currentMood === 'bored' && r < 0.3) currentMood = 'happy';
      // sleepy stays sleepy until morning or interaction
      break;
  }

  // Any system event clears the manual override backup
  if (event !== 'manual' && event !== 'reset_auto') {
    delete preManualMoodByPersona[personaId];
  }

  if (currentMood !== oldMood) {
    currentMoodByPersona[personaId] = currentMood;
    saveMood(currentMood, event, personaId);
    if (onChangeCallback) {
      onChangeCallback({ mood: currentMood, reason: event, oldMood, personaId });
    }
  }

  return currentMood;
}

/**
 * Get the proactive interval range in minutes based on mood
 */
function getProactiveInterval() {
  const currentMood = getCurrentMood();
  switch (currentMood) {
    case 'excited': return { min: 1, max: 2 };
    case 'bored':   return { min: 1, max: 2 };
    case 'caring':  return { min: 1.5, max: 3 };
    case 'happy':   return { min: 1.5, max: 3.5 };
    case 'sleepy':  return { min: 5, max: 12 };
    default:        return { min: 1.5, max: 3.5 };
  }
}

module.exports = { initMood, switchPersona, getCurrentMood, triggerEvent, setMood, resetMood, onMoodChange, MOODS, getProactiveInterval };
