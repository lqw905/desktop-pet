const path = require('path');
const fs = require('fs');

// Load .env from multiple possible locations
const envPaths = [
  path.join(__dirname, '..', '.env'),             // dev: project root
  path.join(process.resourcesPath || '', '.env'),  // prod: next to app.asar
];
for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
    break;
  }
}

const { app, ipcMain, BrowserWindow, screen } = require('electron');
const { createPetWindow, getPetWindow, togglePetWindow, resetPetWindowPosition } = require('./window');
const { createTray, getIsMuted, getIsBubbleEnabled } = require('./tray');

let petWindow = null;
let chatWindow = null;
let controlWindow = null;
let tray = null;

// Lazy-load backend modules (after app is ready)
let scheduler = null;
let memory = null;
let mood = null;
let deepseek = null;

function getRollingEnabled() {
  return memory?.getMemorySettings?.().rollingEnabled !== false;
}

function syncRollingStateToPet() {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('toggle-rolling', getRollingEnabled());
  }
}

function attachPetWindowStateSync() {
  if (!petWindow || petWindow.isDestroyed()) return;
  petWindow.webContents.once('did-finish-load', () => {
    syncRollingStateToPet();
  });
}

function initBackend() {
  memory = require('./memory');
  memory.initDatabase();

  mood = require('./mood');
  mood.initMood();
  mood.onMoodChange(({ mood: newMood, reason, personaId }) => {
    if (controlWindow && !controlWindow.isDestroyed()) {
      controlWindow.webContents.send('mood-changed', { mood: newMood, reason, personaId });
    }
  });

  deepseek = require('./deepseek');

  scheduler = require('./scheduler');
  scheduler.onChatMessage(({ role, content }) => {
    if (controlWindow && !controlWindow.isDestroyed()) {
      controlWindow.webContents.send('chat-message', { role, content });
    }
  });
  scheduler.startScheduler();
}

// --- Chat Window ---
function createChatWindow() {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.show();
    chatWindow.focus();
    return;
  }

  chatWindow = new BrowserWindow({
    width: 380,
    height: 520,
    resizable: true,
    skipTaskbar: false,
    title: 'Chat with Pet',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  chatWindow.loadFile(path.join(__dirname, '..', 'renderer', 'chat.html'));
  chatWindow.setMenuBarVisibility(false);

  chatWindow.on('close', (e) => {
    e.preventDefault();
    chatWindow.hide();
  });

  return chatWindow;
}

// --- Control Window ---
function createControlWindow() {
  if (controlWindow && !controlWindow.isDestroyed()) {
    controlWindow.show();
    controlWindow.focus();
    return;
  }

  controlWindow = new BrowserWindow({
    width: 320,
    height: 520,
    resizable: true,
    skipTaskbar: false,
    title: '桌宠控制台',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  controlWindow.loadFile(path.join(__dirname, '..', 'renderer', 'control.html'));
  controlWindow.setMenuBarVisibility(false);

  controlWindow.on('close', (e) => {
    e.preventDefault();
    controlWindow.hide();
  });

  return controlWindow;
}

// --- App Lifecycle ---
app.whenReady().then(async () => {
  // Initialize backend
  initBackend();

  // Create windows
  petWindow = createPetWindow();
  attachPetWindowStateSync();

  // Force the pet window to show and focus immediately
  petWindow.show();
  petWindow.focus();
  petWindow.moveTop();

  // Greet the user after a short delay
  setTimeout(() => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('show-bubble', `你好，我是${memory.getCurrentPersona().name}。`);
    }
  }, 1000);

  // Check DeepSeek API status & show in pet
  const status = await deepseek.checkStatus();
  if (!status.ok) {
    setTimeout(() => {
      if (petWindow && !petWindow.isDestroyed()) {
        petWindow.webContents.send('show-bubble', `⚠️ ${status.error}`);
      }
    }, 3000);
  } else {
    setTimeout(() => {
      if (petWindow && !petWindow.isDestroyed()) {
        petWindow.webContents.send('update-mood', mood.getCurrentMood());
      }
    }, 2500);
  }

  // Create tray
  tray = createTray(petWindow, {
    onMuteChange: (muted) => {
      if (scheduler) scheduler.setMuted(muted);
    },
    onBubbleToggle: (enabled) => {
      if (scheduler) scheduler.setBubbleEnabled(enabled);
      if (petWindow && !petWindow.isDestroyed()) {
        petWindow.webContents.send('toggle-bubble', enabled);
      }
    },
    onForceSpeak: async () => {
      try {
        await scheduler.triggerProactiveMessage();
      } catch (e) {
        console.error('Force speak error:', e.message);
      }
    },
    onOpenControl: () => {
      createControlWindow();
    }
  });

  // --- IPC Handlers ---
  ipcMain.on('open-chat-window', () => {
    createChatWindow();
    if (chatWindow) chatWindow.show();
  });

  ipcMain.on('close-chat-window', () => {
    if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.hide();
    }
  });

  ipcMain.handle('get-pet-position', () => {
    if (!petWindow || petWindow.isDestroyed()) return null;
    const [x, y] = petWindow.getPosition();
    return { x, y };
  });

  ipcMain.handle('reset-pet-position', () => {
    const position = resetPetWindowPosition();
    if (position && petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('reset-pet-position');
    }
    return position;
  });

  ipcMain.on('move-window-to', (_event, nx, ny) => {
    if (!petWindow || petWindow.isDestroyed()) return;
    const [ww, wh] = petWindow.getSize();

    const pt = { x: nx + ww / 2, y: ny + wh / 2 };
    const disp = screen.getDisplayNearestPoint(pt);
    const { x: bX, y: bY, width: bW, height: bH } = disp.bounds;

    const minVisible = 40;
    if (nx < bX - ww + minVisible) nx = bX - ww + minVisible;
    if (ny < bY - wh + minVisible) ny = bY - wh + minVisible;
    if (nx > bX + bW - minVisible) nx = bX + bW - minVisible;
    if (ny > bY + bH - minVisible) ny = bY + bH - minVisible;

    petWindow.setPosition(nx, ny);
  });

  ipcMain.on('move-window', (_event, dx, dy) => {
    if (!petWindow || petWindow.isDestroyed()) return;
    const [x, y] = petWindow.getPosition();
    const [ww, wh] = petWindow.getSize();
    let nx = x + dx;
    let ny = y + dy;

    // Find the display this window is on (supports multi-monitor, DPI scaling)
    const pt = { x: nx + ww / 2, y: ny + wh / 2 };
    const disp = screen.getDisplayNearestPoint(pt);
    const { x: bX, y: bY, width: bW, height: bH } = disp.bounds;

    // Allow pet to go to screen edges (keep at least 40px visible so it can still be grabbed)
    const minVisible = 40;
    if (nx < bX - ww + minVisible) nx = bX - ww + minVisible;
    if (ny < bY - wh + minVisible) ny = bY - wh + minVisible;
    if (nx > bX + bW - minVisible) nx = bX + bW - minVisible;
    if (ny > bY + bH - minVisible) ny = bY + bH - minVisible;

    petWindow.setPosition(nx, ny);
  });

  ipcMain.on('open-control-window', () => {
    createControlWindow();
    if (controlWindow) controlWindow.show();
  });

  ipcMain.on('reset-mood', () => {
    const newMood = mood.resetMood();
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('update-mood', newMood);
    }
  });

  ipcMain.on('set-mood', (_event, targetMood) => {
    const newMood = mood.setMood(targetMood);
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('update-mood', newMood);
    }
  });

  function buildControlState() {
    const recentMessages = memory.getRecentConversations(20).map(m => ({
      role: m.role,
      content: m.content
    }));
    return {
      currentPersonaId: memory.getCurrentPersonaId(),
      currentPersona: memory.getCurrentPersona(),
      personas: memory.getAllPersonas(),
      mood: mood.getCurrentMood(),
      moodReason: memory.getLastMoodReason(),
      recentMessages,
      memorySettings: memory.getMemorySettings(),
      memorySummary: memory.getMemorySummary(),
      profile: memory.getProfile(),
      memoryItems: memory.getMemoryItems(8),
      memoryStats: memory.getMemoryStats(),
      apiConfig: deepseek.getPublicApiConfig(),
      apiProfiles: deepseek.getApiProfiles(),
      apiPresets: deepseek.getApiPresets()
    };
  }

  function notifyPersonaState() {
    const state = buildControlState();
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('update-mood', state.mood);
    }
    if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.webContents.send('persona-changed', {
        currentPersonaId: state.currentPersonaId,
        currentPersona: state.currentPersona
      });
    }
    if (controlWindow && !controlWindow.isDestroyed()) {
      controlWindow.webContents.send('persona-changed', state);
    }
    return state;
  }

  ipcMain.handle('set-persona', (_event, personaId) => {
    mood.switchPersona(personaId);
    return notifyPersonaState();
  });

  ipcMain.handle('save-custom-persona', (_event, persona) => {
    const saved = memory.saveCustomPersona(persona);
    mood.switchPersona(saved.id);
    return notifyPersonaState();
  });

  ipcMain.handle('delete-custom-persona', (_event, personaId) => {
    memory.deleteCustomPersona(personaId);
    mood.switchPersona(memory.getCurrentPersonaId());
    return notifyPersonaState();
  });

  ipcMain.handle('get-state', () => {
    return buildControlState();
  });

  ipcMain.handle('save-api-config', (_event, config) => {
    deepseek.saveApiConfig(config);
    return buildControlState();
  });

  ipcMain.handle('set-api-profile', (_event, profileId) => {
    deepseek.setApiProfile(profileId);
    return buildControlState();
  });

  ipcMain.handle('delete-api-profile', (_event, profileId) => {
    deepseek.deleteApiProfile(profileId);
    return buildControlState();
  });

  ipcMain.handle('test-api-config', async (_event, config) => {
    return deepseek.testApiConfig(config);
  });

  ipcMain.handle('set-rolling-enabled', (_event, enabled) => {
    memory.setRollingEnabled(enabled);
    syncRollingStateToPet();
    return buildControlState();
  });

  ipcMain.handle('clear-memory', () => {
    memory.clearMemory();
    mood.initMood();
    return {
      ok: true,
      currentPersonaId: memory.getCurrentPersonaId(),
      currentPersona: memory.getCurrentPersona(),
      personas: memory.getAllPersonas(),
      mood: mood.getCurrentMood(),
      moodReason: memory.getLastMoodReason(),
      memorySettings: memory.getMemorySettings(),
      memorySummary: memory.getMemorySummary(),
      profile: memory.getProfile(),
      memoryItems: memory.getMemoryItems(8),
      memoryStats: memory.getMemoryStats(),
      apiConfig: deepseek.getPublicApiConfig(),
      apiProfiles: deepseek.getApiProfiles(),
      apiPresets: deepseek.getApiPresets()
    };
  });

  ipcMain.on('force-speak', async () => {
    try {
      await scheduler.triggerProactiveMessage();
    } catch (e) {
      console.error('Force speak error:', e.message);
    }
  });

  ipcMain.on('pet-dragged', () => {
    const messages = [
      '哎呀，别拽我啦~',
      '呜呜，要被拖走了...',
      '嘿！轻一点嘛！',
      '你要把我带到哪儿去呀？',
      '晕了晕了，慢点慢点！',
      '诶诶诶？我在飞！',
      '别别别，我恐高！',
      '哇啊，好刺激！',
      '哼，随便你拖吧...',
      '你这是在遛宠物吗？',
      '哎哟，我的小短腿跟不上啦~',
      '好吧好吧，换个地方也不错~',
    ];
    const msg = messages[Math.floor(Math.random() * messages.length)];
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('show-bubble', msg);
    }
  });
  ipcMain.handle('check-status', async () => {
    const status = await deepseek.checkStatus();
    const lastError = scheduler.getLastError ? scheduler.getLastError() : null;
    return { ...status, lastError };
  });

  ipcMain.on('user-message', async (_event, text) => {
    if (!chatWindow || chatWindow.isDestroyed()) return;

    try {
      const reply = await scheduler.generateReplyStreaming(text, chatWindow);
      if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.webContents.send('chat-response-end', reply);
      }
    } catch (err) {
      console.error('Chat error:', err.message);
      if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.webContents.send('chat-response-end', `出错了：${err.message}`);
      }
    }
  });
});

app.on('window-all-closed', () => {
  // Don't quit - keep running in tray
});

app.on('before-quit', () => {
  if (scheduler) scheduler.stopScheduler();
  if (memory) memory.closeDatabase();
});

app.on('activate', () => {
  if (!petWindow || petWindow.isDestroyed()) {
    petWindow = createPetWindow();
    attachPetWindowStateSync();
  } else {
    petWindow.show();
  }
});
