// --- DOM Elements ---
const petBody = document.getElementById('pet-body');
const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');
const bubbleClose = document.getElementById('bubble-close');

let bubbleTimer = null;
let isDragging = false;
let dragMoved = false;
let bubbleEnabled = true;
let currentMood = 'happy';
let currentExpression = 'idle';
let expressionTimer = null;
let expressionLocked = false;
// --- Drag to move window ---
let dragOffsetX = 0;
let dragOffsetY = 0;
let dragOriginX = 0;
let dragOriginY = 0;

function applyFaceClasses() {
  const expressionClasses = Array.from(petBody.classList)
    .filter((className) => className.startsWith('expression-'));

  petBody.className = '';
  petBody.classList.add(`mood-${currentMood}`);
  expressionClasses.forEach((className) => petBody.classList.add(className));
}

function setExpression(expression, duration = 0, locked = false) {
  if (expressionLocked && !locked) return;
  if (currentExpression === expression && duration === 0 && expressionTimer === null) return;

  if (expressionTimer) {
    clearTimeout(expressionTimer);
    expressionTimer = null;
  }

  currentExpression = expression;
  expressionLocked = locked;
  Array.from(petBody.classList)
    .filter((className) => className.startsWith('expression-'))
    .forEach((className) => petBody.classList.remove(className));
  petBody.classList.add(`expression-${expression}`);

  if (duration > 0) {
    expressionTimer = setTimeout(() => {
      expressionLocked = false;
      setExpression('idle');
    }, duration);
  }
}

function updateLookAtMouse(e) {
  const rect = petBody.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const dx = e.clientX - centerX;
  const dy = e.clientY - centerY;
  const distance = Math.hypot(dx, dy);
  const lookX = Math.max(-4, Math.min(4, dx / 18));
  const lookY = Math.max(-3, Math.min(3, dy / 22));

  petBody.style.setProperty('--look-x', `${lookX.toFixed(2)}px`);
  petBody.style.setProperty('--look-y', `${lookY.toFixed(2)}px`);

  if (isDragging || expressionLocked) return;
  if (distance < 70) {
    setExpression('hover');
  } else if (distance < 150) {
    setExpression('curious');
  } else if (currentExpression !== 'idle') {
    setExpression('idle');
  }
}

petBody.addEventListener('mousedown', async (e) => {
  isDragging = true;
  dragMoved = false;
  setExpression('squish', 0, true);
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
  updateLookAtMouse(e);
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
      setExpression('dizzy', 900, true);
      window.petAPI?.petDragged();
    } else {
      setExpression('surprised', 450, true);
    }
  }
});

// Click to trigger an automatic greeting (only if not dragging)
petBody.addEventListener('click', (e) => {
  if (dragMoved) return;
  setExpression('hover', 700, true);
  window.petAPI?.forceSpeak();
});

// Double click to open chat dialog
petBody.addEventListener('dblclick', () => {
  if (dragMoved) return;
  window.petAPI?.openChat();
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
  setExpression('talk', 900, true);
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
  currentMood = mood;
  applyFaceClasses();
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
  setExpression('idle');
}, 500);

document.addEventListener('mouseleave', () => {
  petBody.style.setProperty('--look-x', '0px');
  petBody.style.setProperty('--look-y', '0px');
  if (!expressionLocked) setExpression('idle');
});
