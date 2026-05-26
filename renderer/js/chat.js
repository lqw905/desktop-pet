// --- DOM Elements ---
const messagesDiv = document.getElementById('chat-messages');
const inputField = document.getElementById('chat-input');
const sendBtn = document.getElementById('chat-send');
const closeBtn = document.getElementById('chat-close');
const chatTitle = document.getElementById('chat-title');

let typingTimer = null;
let streamingMsgDiv = null;
const TYPING_TIMEOUT = 35000;

// --- Add message to chat ---
function addMessage(text, role = 'user') {
  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${role}-msg`;
  const timeStr = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  msgDiv.innerHTML = `<span>${escapeHtml(text)}</span><span class="msg-time">${timeStr}</span>`;
  messagesDiv.appendChild(msgDiv);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
  return msgDiv;
}

function addSystemMessage(text, isError = false) {
  const msgDiv = document.createElement('div');
  msgDiv.className = `message system-msg${isError ? ' error-msg' : ''}`;
  msgDiv.innerHTML = `<span>${escapeHtml(text)}</span>`;
  messagesDiv.appendChild(msgDiv);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
  return msgDiv;
}

function updatePersonaHeader(persona) {
  if (!persona) return;
  chatTitle.textContent = `🐾 和 ${persona.name} 聊天`;
}

function clearMessagesWithPersona(persona) {
  messagesDiv.innerHTML = '';
  addSystemMessage(`已切换到「${persona.name}」，后续聊天会使用这个人格。`);
}

function showTyping() {
  removeTyping();
  const typingDiv = document.createElement('div');
  typingDiv.className = 'message pet-msg typing';
  typingDiv.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';
  typingDiv.id = 'typing-indicator';
  messagesDiv.appendChild(typingDiv);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;

  typingTimer = setTimeout(() => {
    removeTyping();
    streamingMsgDiv = null;
    addSystemMessage('等待超时 —— 请检查 Ollama 是否正在运行', true);
  }, TYPING_TIMEOUT);
}

function removeTyping() {
  if (typingTimer) {
    clearTimeout(typingTimer);
    typingTimer = null;
  }
  const el = document.getElementById('typing-indicator');
  if (el) el.remove();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function isErrorReply(text) {
  return text && (text.includes('无法连接') || text.includes('模型未找到') || text.includes('超时') || text.includes('空内容') || text.includes('出错了'));
}

// --- Send message ---
function sendMessage() {
  const text = inputField.value.trim();
  if (!text) return;

  addMessage(text, 'user');
  inputField.value = '';
  inputField.disabled = true;
  sendBtn.disabled = true;
  streamingMsgDiv = null;
  showTyping();

  if (window.petAPI) {
    window.petAPI.sendMessage(text);
  }
}

// --- Event Listeners ---
sendBtn.addEventListener('click', sendMessage);
inputField.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage();
});

closeBtn.addEventListener('click', () => {
  window.petAPI?.closeChat();
});

// --- IPC Listeners ---
if (window.petAPI) {
  window.petAPI.getState?.().then(state => {
    if (state?.currentPersona) {
      updatePersonaHeader(state.currentPersona);
    }
  }).catch(() => {});

  window.petAPI.onPersonaChanged?.(({ currentPersona }) => {
    if (!currentPersona) return;
    updatePersonaHeader(currentPersona);
    streamingMsgDiv = null;
    removeTyping();
    inputField.disabled = false;
    sendBtn.disabled = false;
    clearMessagesWithPersona(currentPersona);
  });

  window.petAPI.onChatToken((text) => {
    removeTyping();
    if (!text) return;

    if (!streamingMsgDiv) {
      streamingMsgDiv = document.createElement('div');
      streamingMsgDiv.className = 'message pet-msg';
      const timeStr = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      streamingMsgDiv.innerHTML = `<span></span><span class="msg-time">${timeStr}</span>`;
      messagesDiv.appendChild(streamingMsgDiv);
    }
    streamingMsgDiv.querySelector('span:first-child').textContent = text;
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  });

  window.petAPI.onChatResponseEnd((text) => {
    removeTyping();
    inputField.disabled = false;
    sendBtn.disabled = false;
    inputField.focus();

    if (!text && !streamingMsgDiv) {
      addSystemMessage('未收到回复，请检查 Ollama 状态', true);
    } else if (text && isErrorReply(text)) {
      // Error message from backend — show as system error
      if (streamingMsgDiv) {
        streamingMsgDiv.remove();
        streamingMsgDiv = null;
      }
      addSystemMessage(text, true);
    } else if (text && streamingMsgDiv) {
      streamingMsgDiv.querySelector('span:first-child').textContent = text;
    } else if (text && !streamingMsgDiv) {
      addMessage(text, 'pet');
    }

    streamingMsgDiv = null;
  });

  // Legacy handler
  window.petAPI.onChatResponse((text) => {
    removeTyping();
    inputField.disabled = false;
    sendBtn.disabled = false;
    inputField.focus();

    if (text && isErrorReply(text)) {
      addSystemMessage(text, true);
    } else if (text) {
      addMessage(text, 'pet');
    } else {
      addSystemMessage('未收到回复，请检查 Ollama 状态', true);
    }
  });
}

// --- Check status on load ---
async function checkStatus() {
  if (!window.petAPI) return;
  try {
    const status = await window.petAPI.checkStatus();
    if (!status.ok) {
      addSystemMessage(`系统状态：${status.error}`, true);
    }
  } catch {
    // can't reach main process yet, ignore
  }
}

// Focus input on load
inputField.focus();
checkStatus();
