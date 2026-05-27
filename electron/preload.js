const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  // Pet window actions
  onShowBubble: (callback) => ipcRenderer.on('show-bubble', (_event, text) => callback(text)),
  onUpdateMood: (callback) => ipcRenderer.on('update-mood', (_event, mood) => callback(mood)),
  onToggleBubble: (callback) => ipcRenderer.on('toggle-bubble', (_event, enabled) => callback(enabled)),
  onToggleRolling: (callback) => ipcRenderer.on('toggle-rolling', (_event, enabled) => callback(enabled)),
  onResetPosition: (callback) => ipcRenderer.on('reset-pet-position', () => callback()),

  // Chat actions
  sendMessage: (text) => ipcRenderer.send('user-message', text),
  onChatResponse: (callback) => ipcRenderer.on('chat-response', (_event, text) => callback(text)),
  onChatToken: (callback) => ipcRenderer.on('chat-token', (_event, text) => callback(text)),
  onChatResponseEnd: (callback) => ipcRenderer.on('chat-response-end', (_event, text) => callback(text)),
  onPersonaChanged: (callback) => ipcRenderer.on('persona-changed', (_event, data) => callback(data)),
  getState: () => ipcRenderer.invoke('get-state'),

  // Status check
  checkStatus: () => ipcRenderer.invoke('check-status'),

  // Window controls
  moveWindow: (dx, dy) => ipcRenderer.send('move-window', dx, dy),
  moveWindowTo: (x, y) => ipcRenderer.send('move-window-to', x, y),
  getPosition: () => ipcRenderer.invoke('get-pet-position'),
  openChat: () => ipcRenderer.send('open-chat-window'),
  closeChat: () => ipcRenderer.send('close-chat-window'),
  forceSpeak: () => ipcRenderer.send('force-speak'),
  petDragged: () => ipcRenderer.send('pet-dragged'),

  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});

contextBridge.exposeInMainWorld('controlAPI', {
  onMoodChanged: (callback) => ipcRenderer.on('mood-changed', (_event, data) => callback(data)),
  onPersonaChanged: (callback) => ipcRenderer.on('persona-changed', (_event, data) => callback(data)),
  onControlState: (callback) => ipcRenderer.on('control-state', (_event, data) => callback(data)),
  onChatMessage: (callback) => ipcRenderer.on('chat-message', (_event, data) => callback(data)),
  getState: () => ipcRenderer.invoke('get-state'),
  clearMemory: () => ipcRenderer.invoke('clear-memory'),
  resetPetPosition: () => ipcRenderer.invoke('reset-pet-position'),
  setRollingEnabled: (enabled) => ipcRenderer.invoke('set-rolling-enabled', enabled),
  saveApiConfig: (config) => ipcRenderer.invoke('save-api-config', config),
  setApiProfile: (profileId) => ipcRenderer.invoke('set-api-profile', profileId),
  deleteApiProfile: (profileId) => ipcRenderer.invoke('delete-api-profile', profileId),
  testApiConfig: (config) => ipcRenderer.invoke('test-api-config', config),
  setPersona: (personaId) => ipcRenderer.invoke('set-persona', personaId),
  saveCustomPersona: (persona) => ipcRenderer.invoke('save-custom-persona', persona),
  deleteCustomPersona: (personaId) => ipcRenderer.invoke('delete-custom-persona', personaId),
  setMood: (mood) => ipcRenderer.send('set-mood', mood),
  resetMood: () => ipcRenderer.send('reset-mood'),
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});
