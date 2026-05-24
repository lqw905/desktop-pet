// --- DOM Elements ---
const petBody = document.getElementById('pet-body');
const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');
const bubbleClose = document.getElementById('bubble-close');

let bubbleTimer = null;
let isDragging = false;
let dragMoved = false;
let bubbleEnabled = true;

// --- Drag to move window ---
let dragOffsetX = 0;
let dragOffsetY = 0;
let dragOriginX = 0;
let dragOriginY = 0;

petBody.addEventListener('mousedown', async (e) => {
  isDragging = true;
  dragMoved = false;
  dragOriginX = e.screenX;
  dragOriginY = e.screenY;
  const pos = await window.petAPI?.getPosition();
  if (pos) {
    dragOffsetX = e.screenX - pos.x;
    dragOffsetY = e.screenY - pos.y;
  } else {
    dragOffsetX = 0;
    dragOffsetY = 0;
  }
});

document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const nx = e.screenX - dragOffsetX;
  const ny = e.screenY - dragOffsetY;

  if (Math.abs(e.screenX - dragOriginX) > 2 || Math.abs(e.screenY - dragOriginY) > 2) {
    dragMoved = true;
  }

  window.petAPI?.moveWindowTo(nx, ny);
});

document.addEventListener('mouseup', () => {
  if (isDragging) {
    isDragging = false;
    if (dragMoved) {
      petBody.classList.add('bouncing');
      setTimeout(() => petBody.classList.remove('bouncing'), 600);
    }
  }
});

// Click to open chat panel (only if not dragging)
petBody.addEventListener('click', (e) => {
  if (dragMoved) return;
  window.petAPI?.openChat();
});

// Double click to force the pet to speak
petBody.addEventListener('dblclick', () => {
  if (dragMoved) return;
  window.petAPI?.forceSpeak();
});

// --- Bubble management ---
function showBubble(text, duration = 8000) {
  if (!bubbleEnabled) return;
  if (bubbleTimer) clearTimeout(bubbleTimer);

  bubbleText.textContent = text;
  bubble.classList.remove('bubble-hidden');
  bubble.classList.add('bubble-visible', 'pop-in');

  // Re-trigger CSS animation
  void bubble.offsetWidth;
  bubble.classList.remove('pop-in');
  void bubble.offsetWidth;
  bubble.classList.add('pop-in');

  // Pet bounces when speaking
  petBody.classList.add('bouncing');
  setTimeout(() => petBody.classList.remove('bouncing'), 600);

  // Auto-hide after duration
  bubbleTimer = setTimeout(() => {
    hideBubble();
  }, duration);
}

function hideBubble() {
  bubble.classList.remove('bubble-visible', 'pop-in');
  bubble.classList.add('bubble-hidden');
  if (bubbleTimer) clearTimeout(bubbleTimer);
}

// Close button dismisses bubble without opening chat
bubbleClose.addEventListener('mousedown', (e) => {
  e.stopPropagation();
  e.preventDefault();
  hideBubble();
});

// --- Mood update ---
function setMood(mood) {
  // Remove old mood class
  petBody.className = '';
  petBody.classList.add(`mood-${mood}`);
}

// --- IPC Listeners ---
if (window.petAPI) {
  window.petAPI.onShowBubble((text) => {
    showBubble(text);
  });

  window.petAPI.onUpdateMood((mood) => {
    setMood(mood);
  });

  window.petAPI.onToggleBubble((enabled) => {
    bubbleEnabled = enabled;
    if (!enabled) hideBubble();
  });
}

// --- Click bubble to open chat ---
bubble.addEventListener('click', (e) => {
  if (e.target === bubbleClose) return; // don't open chat when clicking close button
  e.stopPropagation();
  if (bubble.classList.contains('bubble-visible')) {
    window.petAPI?.openChat();
  }
});

// Auto-show greeting on load
setTimeout(() => {
  setMood('happy');
}, 500);
