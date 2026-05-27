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
const resetPetPositionBtn = document.getElementById('btn-reset-pet-position');
const apiProfileSelect = document.getElementById('api-profile-select');
const apiProfileName = document.getElementById('api-profile-name');
const apiProviderSelect = document.getElementById('api-provider-select');
const apiBaseUrl = document.getElementById('api-base-url');
const apiModel = document.getElementById('api-model');
const apiKey = document.getElementById('api-key');
const apiStreamToggle = document.getElementById('api-stream-toggle');
const apiThinkingToggle = document.getElementById('api-thinking-toggle');
const apiStatus = document.getElementById('api-status');
const testApiBtn = document.getElementById('btn-test-api');
const saveApiBtn = document.getElementById('btn-save-api');
const newApiProfileBtn = document.getElementById('btn-new-api-profile');
const deleteApiProfileBtn = document.getElementById('btn-delete-api-profile');

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
let apiPresets = [];
let apiProfiles = [];
const NEW_API_PROFILE_VALUE = '__new__';
const ENV_API_PROFILE_VALUE = '__env__';

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
  updateApiDisplay(state);
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
  rollingToggle.checked = settings.rollingEnabled === true;
}

function updateApiDisplay(state = {}) {
  apiPresets = Array.isArray(state.apiPresets) ? state.apiPresets : apiPresets;
  apiProfiles = Array.isArray(state.apiProfiles)
    ? state.apiProfiles
    : Array.isArray(state.apiConfig?.profiles) ? state.apiConfig.profiles : apiProfiles;
  const config = state.apiConfig || {};

  const profileOptions = apiProfiles.map(profile =>
    `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name)}</option>`
  );
  if (!profileOptions.length) {
    profileOptions.push(`<option value="${ENV_API_PROFILE_VALUE}">当前 .env 配置</option>`);
  }
  profileOptions.push(`<option value="${NEW_API_PROFILE_VALUE}">+ 新建配置</option>`);
  apiProfileSelect.innerHTML = profileOptions.join('');
  apiProfileSelect.value = config.currentProfileId || ENV_API_PROFILE_VALUE;

  if (apiPresets.length) {
    apiProviderSelect.innerHTML = apiPresets.map(preset =>
      `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)}</option>`
    ).join('');
  }

  apiProviderSelect.value = config.provider || apiProviderSelect.value || 'aliyun-bailian';
  apiProfileName.value = config.profileName || config.providerName || '';
  apiBaseUrl.value = config.baseUrl || '';
  apiModel.value = config.model || '';
  apiKey.value = '';
  apiKey.placeholder = config.apiKeyConfigured
    ? `已配置 ${config.apiKeyHint || ''}，留空则保留`
    : '输入 API Key';
  apiStreamToggle.checked = config.streamEnabled !== false;
  apiThinkingToggle.checked = config.enableThinking === true;
  deleteApiProfileBtn.disabled = !config.currentProfileId;
}

function getSelectedApiPreset() {
  return apiPresets.find(preset => preset.id === apiProviderSelect.value) || null;
}

function collectApiPayload() {
  const preset = getSelectedApiPreset();
  const selectedProfileId = apiProfileSelect.value;
  return {
    profileId: selectedProfileId && selectedProfileId !== NEW_API_PROFILE_VALUE && selectedProfileId !== ENV_API_PROFILE_VALUE
      ? selectedProfileId
      : null,
    createNew: selectedProfileId === NEW_API_PROFILE_VALUE || selectedProfileId === ENV_API_PROFILE_VALUE,
    profileName: apiProfileName.value.trim(),
    provider: apiProviderSelect.value,
    providerName: preset?.name,
    baseUrl: apiBaseUrl.value.trim(),
    model: apiModel.value.trim(),
    apiKey: apiKey.value.trim(),
    streamEnabled: apiStreamToggle.checked,
    enableThinking: apiThinkingToggle.checked
  };
}

function setApiStatus(text, type = '') {
  apiStatus.textContent = text;
  apiStatus.classList.toggle('ok', type === 'ok');
  apiStatus.classList.toggle('error', type === 'error');
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
    updateApiDisplay(state);
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

resetPetPositionBtn.addEventListener('click', async () => {
  if (!window.controlAPI) return;
  resetPetPositionBtn.disabled = true;
  try {
    await window.controlAPI.resetPetPosition();
  } finally {
    resetPetPositionBtn.disabled = false;
  }
});

apiProviderSelect.addEventListener('change', () => {
  const preset = getSelectedApiPreset();
  if (!preset) return;

  apiBaseUrl.value = preset.baseUrl || '';
  apiModel.value = preset.model || '';
  apiStreamToggle.checked = preset.streamEnabled !== false;
  apiThinkingToggle.checked = preset.enableThinking === true;
  setApiStatus('');
});

apiProfileSelect.addEventListener('change', async () => {
  if (!window.controlAPI) return;

  if (apiProfileSelect.value === NEW_API_PROFILE_VALUE) {
    const preset = getSelectedApiPreset();
    apiProfileName.value = '';
    apiKey.value = '';
    apiKey.placeholder = '输入 API Key';
    if (preset) {
      apiProviderSelect.value = preset.id;
      apiBaseUrl.value = preset.baseUrl || '';
      apiModel.value = preset.model || '';
      apiStreamToggle.checked = preset.streamEnabled !== false;
      apiThinkingToggle.checked = preset.enableThinking === true;
    }
    deleteApiProfileBtn.disabled = true;
    setApiStatus('填写后保存为新的 API 配置');
    return;
  }

  if (apiProfileSelect.value === ENV_API_PROFILE_VALUE) {
    deleteApiProfileBtn.disabled = true;
    setApiStatus('当前使用 .env 配置；保存后会创建可切换配置');
    return;
  }

  apiProfileSelect.disabled = true;
  try {
    const state = await window.controlAPI.setApiProfile(apiProfileSelect.value);
    updateApiDisplay(state);
    setApiStatus('已切换 API 配置，后续请求会使用它', 'ok');
  } catch (err) {
    setApiStatus(err?.message || '切换失败', 'error');
  } finally {
    apiProfileSelect.disabled = false;
  }
});

testApiBtn.addEventListener('click', async () => {
  if (!window.controlAPI) return;
  testApiBtn.disabled = true;
  setApiStatus('正在测试连接...');
  try {
    const result = await window.controlAPI.testApiConfig(collectApiPayload());
    if (result?.ok) {
      setApiStatus(`连接正常：${result.provider} / ${result.model}`, 'ok');
    } else {
      setApiStatus(result?.error || '连接失败', 'error');
    }
  } catch (err) {
    setApiStatus(err?.message || '连接失败', 'error');
  } finally {
    testApiBtn.disabled = false;
  }
});

saveApiBtn.addEventListener('click', async () => {
  if (!window.controlAPI) return;
  const payload = collectApiPayload();
  if (!payload.profileName || !payload.baseUrl || !payload.model) {
    setApiStatus('配置名称、Base URL 和模型不能为空', 'error');
    return;
  }

  saveApiBtn.disabled = true;
  setApiStatus('正在保存...');
  try {
    const state = await window.controlAPI.saveApiConfig(payload);
    updateApiDisplay(state);
    setApiStatus('已保存，后续请求会使用新配置', 'ok');
  } catch (err) {
    setApiStatus(err?.message || '保存失败', 'error');
  } finally {
    saveApiBtn.disabled = false;
  }
});

newApiProfileBtn.addEventListener('click', () => {
  apiProfileSelect.value = NEW_API_PROFILE_VALUE;
  apiProfileName.value = '';
  apiKey.value = '';
  apiKey.placeholder = '输入 API Key';
  deleteApiProfileBtn.disabled = true;
  setApiStatus('填写后保存为新的 API 配置');
});

deleteApiProfileBtn.addEventListener('click', async () => {
  if (!window.controlAPI) return;
  const profileId = apiProfileSelect.value;
  if (!profileId || profileId === NEW_API_PROFILE_VALUE || profileId === ENV_API_PROFILE_VALUE) return;

  deleteApiProfileBtn.disabled = true;
  try {
    const state = await window.controlAPI.deleteApiProfile(profileId);
    updateApiDisplay(state);
    setApiStatus('已删除 API 配置', 'ok');
  } catch (err) {
    setApiStatus(err?.message || '删除失败', 'error');
  } finally {
    deleteApiProfileBtn.disabled = false;
  }
});
