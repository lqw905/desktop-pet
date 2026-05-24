const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');

let tray = null;
let isMuted = false;
let isBubbleEnabled = true;

function createTray(mainWindow, callbacks = {}) {
  // Create a simple 16x16 tray icon programmatically (no external file needed)
  const icon = nativeImage.createFromBuffer(createTrayIconBuffer(), { width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Desktop Pet');

  updateTrayMenu(mainWindow, callbacks);

  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
    }
  });

  return tray;
}

function updateTrayMenu(mainWindow, callbacks = {}) {
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示/隐藏宠物',
      click: () => {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
        }
      }
    },
    {
      label: isMuted ? '🔇 静音中（点击取消）' : '🔊 静音',
      click: () => {
        isMuted = !isMuted;
        if (callbacks.onMuteChange) callbacks.onMuteChange(isMuted);
        updateTrayMenu(mainWindow, callbacks);
      }
    },
    {
      label: isBubbleEnabled ? '💬 气泡：开' : '💬 气泡：关',
      click: () => {
        isBubbleEnabled = !isBubbleEnabled;
        if (callbacks.onBubbleToggle) callbacks.onBubbleToggle(isBubbleEnabled);
        updateTrayMenu(mainWindow, callbacks);
      }
    },
    { type: 'separator' },
    {
      label: '主动说句话',
      click: () => {
        if (callbacks.onForceSpeak) callbacks.onForceSpeak();
      }
    },
    {
      label: '控制台',
      click: () => {
        if (callbacks.onOpenControl) callbacks.onOpenControl();
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        const { app } = require('electron');
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

function createTrayIconBuffer() {
  // 16x16 RGBA raw pixel data for a simple pet face icon
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const cx = x - 8, cy = y - 7;

      // Body circle (main face)
      const isBody = (cx * cx + cy * cy) < 36;

      // Eyes
      const isLeftEye = ((x - 5) * (x - 5) + (y - 6) * (y - 6)) < 3;
      const isRightEye = ((x - 10) * (x - 10) + (y - 6) * (y - 6)) < 3;

      // Mouth
      const isMouth = x >= 5 && x <= 10 && y === 10;

      if (isLeftEye || isRightEye) {
        buffer[i] = 60;     // R
        buffer[i + 1] = 60; // G
        buffer[i + 2] = 60; // B
        buffer[i + 3] = 255; // A
      } else if (isMouth) {
        buffer[i] = 80;
        buffer[i + 1] = 80;
        buffer[i + 2] = 80;
        buffer[i + 3] = 255;
      } else if (isBody) {
        buffer[i] = 255;
        buffer[i + 1] = 220;
        buffer[i + 2] = 100;
        buffer[i + 3] = 255;
      } else {
        buffer[i + 3] = 0; // transparent
      }
    }
  }

  return buffer;
}

function getIsMuted() {
  return isMuted;
}

function getIsBubbleEnabled() {
  return isBubbleEnabled;
}

module.exports = { createTray, getIsMuted, getIsBubbleEnabled };
