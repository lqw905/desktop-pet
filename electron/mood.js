const { saveMood, getLastMood } = require('./memory');

const MOODS = ['happy', 'excited', 'bored', 'sleepy', 'caring'];

let currentMood = 'happy';
let onChangeCallback = null;
let preManualMood = null;

function onMoodChange(cb) {
  onChangeCallback = cb;
}

function setMood(mood) {
  if (!MOODS.includes(mood)) return currentMood;
  if (preManualMood === null) preManualMood = currentMood;
  const oldMood = currentMood;
  currentMood = mood;
  saveMood(currentMood, 'manual');
  if (onChangeCallback) {
    onChangeCallback({ mood: currentMood, reason: 'manual', oldMood });
  }
  return currentMood;
}

function resetMood() {
  if (preManualMood !== null) {
    currentMood = preManualMood;
    preManualMood = null;
    saveMood(currentMood, 'reset_auto');
    if (onChangeCallback) {
      onChangeCallback({ mood: currentMood, reason: 'reset_auto' });
    }
  }
  return currentMood;
}

function initMood() {
  currentMood = getLastMood();
  return currentMood;
}

function getCurrentMood() {
  return currentMood;
}

/**
 * Transition mood based on trigger events
 */
function triggerEvent(event) {
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
    preManualMood = null;
  }

  if (currentMood !== oldMood) {
    saveMood(currentMood, event);
    if (onChangeCallback) {
      onChangeCallback({ mood: currentMood, reason: event, oldMood });
    }
  }

  return currentMood;
}

/**
 * Get the proactive interval range in minutes based on mood
 */
function getProactiveInterval() {
  switch (currentMood) {
    case 'excited': return { min: 1, max: 2 };
    case 'bored':   return { min: 1, max: 2 };
    case 'caring':  return { min: 1.5, max: 3 };
    case 'happy':   return { min: 1.5, max: 3.5 };
    case 'sleepy':  return { min: 5, max: 12 };
    default:        return { min: 1.5, max: 3.5 };
  }
}

module.exports = { initMood, getCurrentMood, triggerEvent, setMood, resetMood, onMoodChange, MOODS, getProactiveInterval };
