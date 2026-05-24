// --- DOM ---
const moodEmoji = document.getElementById('mood-emoji');
const moodLabel = document.getElementById('mood-label');
const moodReason = document.getElementById('mood-last-reason');
const moodButtons = document.querySelectorAll('.mood-btn');
const autoBtn = document.getElementById('btn-auto');
const chatHistory = document.getElementById('chat-history');

const MOOD_MAP = {
  happy:   { emoji: '😊', label: '开心' },
  excited: { emoji: '🤩', label: '兴奋' },
  bored:   { emoji: '😑', label: '无聊' },
  sleepy:  { emoji: '😴', label: '困倦' },
  caring:  { emoji: '🥰', label: '关心' }
};

const EVENT_LABELS = {
  user_interaction: '用户互动',
  long_idle: '长时间空闲',
  late_night: '深夜',
  morning: '早上',
  long_work: '长时间工作',
  user_praises: '用户表扬',
  user_scolds: '用户吐槽',
  manual: '手动切换'
};

// --- Update mood display ---
function updateMoodDisplay(mood, reason) {
  const info = MOOD_MAP[mood] || { emoji: '❓', label: mood };
  moodEmoji.textContent = info.emoji;
  moodLabel.textContent = info.label;

  if (reason) {
    const reasonText = EVENT_LABELS[reason] || reason;
    moodReason.textContent = `触发: ${reasonText}`;
  }

  moodButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mood === mood);
  });
}

// --- Add chat entry ---
function addChatEntry(role, content) {
  // Remove empty hint
  const hint = chatHistory.querySelector('.empty-hint');
  if (hint) hint.remove();

  const entry = document.createElement('div');
  entry.className = `chat-entry ${role}`;
  const roleLabel = role === 'user' ? '用户' : '宠物';
  entry.innerHTML = `<div class="entry-role">${roleLabel}</div><div>${escapeHtml(content)}</div>`;
  chatHistory.appendChild(entry);

  // Keep max 20 entries
  while (chatHistory.children.length > 20) {
    chatHistory.firstElementChild.remove();
  }

  chatHistory.scrollTop = chatHistory.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- IPC Listeners ---
if (window.controlAPI) {
  window.controlAPI.onMoodChanged(({ mood, reason }) => {
    updateMoodDisplay(mood, reason);
  });

  window.controlAPI.onChatMessage(({ role, content }) => {
    addChatEntry(role, content);
  });

  // Load initial state
  window.controlAPI.getState().then(state => {
    if (state.mood) {
      updateMoodDisplay(state.mood, state.moodReason);
    }
    if (state.recentMessages) {
      state.recentMessages.forEach(m => addChatEntry(m.role, m.content));
    }
  });
}

// --- Mood buttons ---
moodButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const mood = btn.dataset.mood;
    window.controlAPI?.setMood(mood);
    moodButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

autoBtn.addEventListener('click', () => {
  window.controlAPI?.resetMood();
  moodButtons.forEach(b => b.classList.remove('active'));
});
