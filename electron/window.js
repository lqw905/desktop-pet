const { BrowserWindow, screen } = require('electron');
const path = require('path');

let petWindow = null;

function getDefaultPetPosition(targetWindow = null) {
  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.workArea;
  const [windowWidth, windowHeight] = targetWindow?.getSize?.() || [240, 320];

  return {
    x: x + width - windowWidth - 20,
    y: y + height - windowHeight - 40
  };
}

function createPetWindow() {
  const defaultPosition = getDefaultPetPosition();

  petWindow = new BrowserWindow({
    width: 240,
    height: 320,
    x: defaultPosition.x,
    y: defaultPosition.y,
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

function resetPetWindowPosition() {
  if (!petWindow || petWindow.isDestroyed()) return null;
  const position = getDefaultPetPosition(petWindow);
  petWindow.setPosition(position.x, position.y);
  return position;
}

module.exports = { createPetWindow, getPetWindow, togglePetWindow, resetPetWindowPosition };
