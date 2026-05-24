const { BrowserWindow, screen } = require('electron');
const path = require('path');

let petWindow = null;

function createPetWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  petWindow = new BrowserWindow({
    width: 240,
    height: 320,
    x: screenWidth - 260,
    y: screenHeight - 360,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    type: 'tool-window',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  petWindow.loadFile(path.join(__dirname, '..', 'renderer', 'pet.html'));
  petWindow.setVisibleOnAllWorkspaces(true);

  return petWindow;
}

function getPetWindow() {
  return petWindow;
}

function togglePetWindow() {
  if (!petWindow) return;
  if (petWindow.isVisible()) {
    petWindow.hide();
  } else {
    petWindow.show();
  }
}

module.exports = { createPetWindow, getPetWindow, togglePetWindow };
