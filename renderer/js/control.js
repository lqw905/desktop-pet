// --- DOM ---
const moodEmoji = document.getElementById('mood-emoji');
const moodLabel = document.getElementById('mood-label');
const moodReason = document.getElementById('mood-last-reason');
const moodButtons = document.querySelectorAll('.mood-btn');
const autoBtn = document.getElementById('btn-auto');
const personaSelect = document.getElementById('persona-select');
const personaDesc = document.getElementById('persona-desc');
const personaEditor = document.getElementById('persona-editor');
const personaName = document.getElementById('persona-name');
const personaDescription = document.getElementById('persona-description');
const personaPrompt = document.getElementById('persona-prompt');
const personaError = document.getElementById('persona-editor-error');
const newPersonaBtn = document.getElementById('btn-new-persona');
const editPersonaBtn = document.getElementById('btn-edit-persona');
const resetPersonaBtn = document.getElementById('btn-reset-persona');
const savePersonaBtn = document.getElementById('btn-save-persona');
const cancelPersonaBtn = document.getElementById('btn-cancel-persona');
const deletePersonaBtn = document.getElementById('btn-delete-persona');
const chatHistory = document.getElementById('chat-history');
const memorySummary = document.getElementById('memory-summary');
const clearMemoryBtn = document.getElementById('btn-clear-memory');
const rollingToggle = document.getElementById('rolling-toggle');

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

let personas = [];
let currentPersonaId = 'xiaoban';
let editingPersonaId = null;

function getCurrentPersona() {
  return personas.find(persona => persona.id === currentPersonaId) || personas[0] || null;
}

function updatePersonaDisplay(state = {}) {
  personas = Array.isArray(state.personas) ? state.personas : personas;
  currentPersonaId = state.currentPersonaId || currentPersonaId;

  personaSelect.innerHTML = personas.map(persona =>
    `<option value="${escapeHtml(persona.id)}">${escapeHtml(persona.name)}${persona.type === 'custom' ? '（自定义）' : ''}</option>`
  ).join('');
  personaSelect.value = currentPersonaId;

  const current = getCurrentPersona();
  personaDesc.textContent = current?.description || '';
  editPersonaBtn.disabled = !current?.editable;
  deletePersonaBtn.classList.toggle('hidden', !current?.editable);
}

function openPersonaEditor(persona = null) {
  editingPersonaId = persona?.editable ? persona.id : null;
  personaName.value = persona?.editable ? persona.name : '';
  personaDescription.value = persona?.editable ? persona.description || '' : '';
  personaPrompt.value = persona?.editable ? persona.systemPrompt || '' : '';
  personaError.textContent = '';
  deletePersonaBtn.classList.toggle('hidden', !editingPersonaId);
  personaEditor.classList.remove('hidden');
  personaName.focus();
}

function closePersonaEditor() {
  editingPersonaId = null;
  personaError.textContent = '';
  personaEditor.classList.add('hidden');
}

function applyPersonaState(state = {}) {
  updatePersonaDisplay(state);
  if (state.mood) {
    updateMoodDisplay(state.mood, state.moodReason);
  }
  updateRollingDisplay(state);
  clearChatHistoryDisplay();
  if (state.recentMessages?.length) {
    state.recentMessages.forEach(m => addChatEntry(m.role, m.content));
  }
  updateMemoryDisplay(state);
}

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

function updateMemoryDisplay(state = {}) {
  const settings = state.memorySettings || {};
  const stats = state.memoryStats || {};
  const items = Array.isArray(state.memoryItems) ? state.memoryItems : [];
  const summary = state.memorySummary || '暂无长期记忆';
  const enabledText = settings.memoryEnabled === false ? '关闭' : '开启';
  const rawText = settings.saveRawMessages === false ? '不保存原文' : `最多 ${settings.maxConversations || 100} 条`;
  const itemText = items.length
    ? `\n关键记忆：${items.map(item => item.content).join('；')}`
    : '';
  memorySummary.textContent = `状态：${enabledText}；原文：${rawText}；长期记忆 ${stats.memoryItems || 0} 条；候选 ${stats.inboxItems || 0} 条；已审查到 #${stats.lastReviewedMessageId || 0}\n摘要：${summary}${itemText}`;
}

function updateRollingDisplay(state = {}) {
  const settings = state.memorySettings || {};
  rollingToggle.checked = settings.rollingEnabled !== false;
}

function clearChatHistoryDisplay() {
  chatHistory.innerHTML = '<div class="empty-hint">暂无最近对话</div>';
}

// --- IPC Listeners ---
if (window.controlAPI) {
  window.controlAPI.onMoodChanged(({ mood, reason }) => {
    updateMoodDisplay(mood, reason);
  });

  window.controlAPI.onPersonaChanged((state) => {
    applyPersonaState(state);
    closePersonaEditor();
  });

  window.controlAPI.onChatMessage(({ role, content }) => {
    addChatEntry(role, content);
  });

  // Load initial state
  window.controlAPI.getState().then(state => {
    updatePersonaDisplay(state);
    if (state.mood) updateMoodDisplay(state.mood, state.moodReason);
    updateRollingDisplay(state);
    if (state.recentMessages) {
      state.recentMessages.forEach(m => addChatEntry(m.role, m.content));
    }
    updateMemoryDisplay(state);
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

personaSelect.addEventListener('change', async () => {
  const state = await window.controlAPI?.setPersona(personaSelect.value);
  if (state) applyPersonaState(state);
});

newPersonaBtn.addEventListener('click', () => {
  openPersonaEditor();
});

editPersonaBtn.addEventListener('click', () => {
  const current = getCurrentPersona();
  if (current?.editable) openPersonaEditor(current);
});

resetPersonaBtn.addEventListener('click', () => {
  window.controlAPI?.setPersona('xiaoban').then(state => {
    if (state) applyPersonaState(state);
  });
});

cancelPersonaBtn.addEventListener('click', () => {
  closePersonaEditor();
});

savePersonaBtn.addEventListener('click', async () => {
  const payload = {
    id: editingPersonaId,
    name: personaName.value.trim(),
    description: personaDescription.value.trim(),
    systemPrompt: personaPrompt.value.trim()
  };
  if (!payload.name || !payload.systemPrompt) {
    personaError.textContent = '人格名称和提示词不能为空';
    return;
  }
  savePersonaBtn.disabled = true;
  try {
    const state = await window.controlAPI.saveCustomPersona(payload);
    applyPersonaState(state);
    closePersonaEditor();
  } catch (err) {
    personaError.textContent = err?.message || '保存失败';
  } finally {
    savePersonaBtn.disabled = false;
  }
});

deletePersonaBtn.addEventListener('click', async () => {
  if (!editingPersonaId) return;
  deletePersonaBtn.disabled = true;
  try {
    const state = await window.controlAPI.deleteCustomPersona(editingPersonaId);
    applyPersonaState(state);
    closePersonaEditor();
  } catch (err) {
    personaError.textContent = err?.message || '删除失败';
  } finally {
    deletePersonaBtn.disabled = false;
  }
});

autoBtn.addEventListener('click', () => {
  window.controlAPI?.resetMood();
  moodButtons.forEach(b => b.classList.remove('active'));
});

clearMemoryBtn.addEventListener('click', async () => {
  if (!window.controlAPI) return;
  clearMemoryBtn.disabled = true;
  try {
    const state = await window.controlAPI.clearMemory();
    applyPersonaState(state);
  } finally {
    clearMemoryBtn.disabled = false;
  }
});

rollingToggle.addEventListener('change', async () => {
  if (!window.controlAPI) return;
  rollingToggle.disabled = true;
  try {
    const state = await window.controlAPI.setRollingEnabled(rollingToggle.checked);
    if (state) updateRollingDisplay(state);
  } finally {
    rollingToggle.disabled = false;
  }
});
