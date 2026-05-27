// --- DOM Elements ---
const petContainer = document.getElementById('pet-container');
const petStage = document.getElementById('pet-stage');
const petRoller = document.getElementById('pet-roller');
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

// --- Gentle local rolling ---
const ROLL_STOP_DISTANCE = 120;
const PET_BODY_DIAMETER = 90;
const PET_BODY_CIRCUMFERENCE = Math.PI * PET_BODY_DIAMETER;
const PET_WINDOW_WIDTH = 240;
const PET_WINDOW_HEIGHT = 320;
const PET_MIN_VISIBLE = 40;
const ROLL_SPEED_PX_PER_MS = 0.18;
const MIN_ROLL_DURATION = 1200;
let rollRotation = 0;
let lastRollFrameAt = 0;
let nextRollTargetAt = 0;
let isPointerNearPet = false;
let activeRoll = null;
let isPickingRoll = false;
let rollingEnabled = false;

function getMotionBounds() {
  const display = window.screen || {};
  const left = Number.isFinite(display.availLeft) ? display.availLeft : 0;
  const top = Number.isFinite(display.availTop) ? display.availTop : 0;
  const width = Number.isFinite(display.availWidth) ? display.availWidth : display.width;
  const height = Number.isFinite(display.availHeight) ? display.availHeight : display.height;

  return {
    minX: left - PET_WINDOW_WIDTH + PET_MIN_VISIBLE,
    maxX: left + width - PET_MIN_VISIBLE,
    minY: top - PET_WINDOW_HEIGHT + PET_MIN_VISIBLE,
    maxY: top + height - PET_MIN_VISIBLE
  };
}

function shuffle(items) {
  return items
    .map((item) => ({ item, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ item }) => item);
}

function isTargetInsideBounds(position, dx, dy, bounds) {
  const targetX = position.x + dx;
  const targetY = position.y + dy;
  return targetX >= bounds.minX && targetX <= bounds.maxX && targetY >= bounds.minY && targetY <= bounds.maxY;
}

function buildRollPlan(position) {
  const bounds = getMotionBounds();
  const turnOptions = shuffle([1, 2, 3]);
  const angleOptions = shuffle([
    0,
    Math.PI / 4,
    Math.PI / 2,
    (3 * Math.PI) / 4,
    Math.PI,
    (5 * Math.PI) / 4,
    (3 * Math.PI) / 2,
    (7 * Math.PI) / 4
  ]);

  for (const turns of turnOptions) {
    const distance = PET_BODY_CIRCUMFERENCE * turns;

    for (const angle of angleOptions) {
      const dx = Math.cos(angle) * distance;
      const dy = Math.sin(angle) * distance;
      if (!isTargetInsideBounds(position, dx, dy, bounds)) continue;

      const rotationSign = Math.abs(dx) >= Math.abs(dy)
        ? Math.sign(dx || 1)
        : Math.sign(dy || 1);
      return { dx, dy, distance, turns, rotationSign };
    }
  }

  return null;
}

async function pickRollTarget(now = performance.now()) {
  if (activeRoll || isPickingRoll) return;

  isPickingRoll = true;
  try {
    const position = await window.petAPI?.getPosition?.();
    const plan = position ? buildRollPlan(position) : null;
    if (!plan) {
      nextRollTargetAt = now + 1800;
      return;
    }

    activeRoll = {
      startAt: performance.now(),
      duration: Math.max(MIN_ROLL_DURATION, plan.distance / ROLL_SPEED_PX_PER_MS),
      dx: plan.dx,
      dy: plan.dy,
      sentDx: 0,
      sentDy: 0,
      fromRotation: rollRotation,
      toRotation: rollRotation + plan.rotationSign * plan.turns * 360
    };
    nextRollTargetAt = Number.POSITIVE_INFINITY;
  } finally {
    isPickingRoll = false;
  }
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function syncRollStyles() {
  petContainer?.style.setProperty('--roll-x', '0px');
  petRoller?.style.setProperty('--roll-rotation', `${rollRotation.toFixed(2)}deg`);
}

function stopRollAtCurrentPosition() {
  activeRoll = null;
  syncRollStyles();
}

function resetRollPose() {
  activeRoll = null;
  rollRotation = 0;
  syncRollStyles();
}

function setRollingEnabled(enabled) {
  rollingEnabled = enabled !== false;
  stopRollAtCurrentPosition();
  nextRollTargetAt = performance.now() + 1200;
}

function animateLocalRoll(now) {
  if (!lastRollFrameAt) {
    lastRollFrameAt = now;
    nextRollTargetAt = now + 1800 + Math.random() * 2400;
  }

  lastRollFrameAt = now;

  const isBubbleVisible = bubble?.classList.contains('bubble-visible');
  const shouldPause = !rollingEnabled || isPointerNearPet || isDragging || expressionLocked || isBubbleVisible;
  if (shouldPause) {
    stopRollAtCurrentPosition();
    nextRollTargetAt = now + 1200;
  } else if (!shouldPause && !activeRoll && now >= nextRollTargetAt) {
    pickRollTarget(now);
  }

  if (activeRoll) {
    const progress = Math.min(1, (now - activeRoll.startAt) / activeRoll.duration);
    const eased = easeInOutCubic(progress);
    const sentDx = Math.round(activeRoll.dx * eased);
    const sentDy = Math.round(activeRoll.dy * eased);
    const frameDx = sentDx - activeRoll.sentDx;
    const frameDy = sentDy - activeRoll.sentDy;

    if (frameDx !== 0 || frameDy !== 0) {
      window.petAPI?.moveWindow(frameDx, frameDy);
      activeRoll.sentDx = sentDx;
      activeRoll.sentDy = sentDy;
    }

    rollRotation = activeRoll.fromRotation + (activeRoll.toRotation - activeRoll.fromRotation) * eased;

    if (progress >= 1) {
      rollRotation = activeRoll.toRotation;
      activeRoll = null;
      nextRollTargetAt = now + 2600 + Math.random() * 3600;
    }
  }

  syncRollStyles();
  requestAnimationFrame(animateLocalRoll);
}

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
  isPointerNearPet = distance < ROLL_STOP_DISTANCE;

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

  stopRollAtCurrentPosition();
  petContainer?.style.setProperty('--bubble-x', '0px');
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
  window.petAPI.getState?.().then((state) => {
    setRollingEnabled(state?.memorySettings?.rollingEnabled === true);
  });

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

  window.petAPI.onToggleRolling((enabled) => {
    setRollingEnabled(enabled);
  });

  window.petAPI.onResetPosition(() => {
    resetRollPose();
    nextRollTargetAt = performance.now() + 1800;
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
  isPointerNearPet = false;
  petBody.style.setProperty('--look-x', '0px');
  petBody.style.setProperty('--look-y', '0px');
  if (!expressionLocked) setExpression('idle');
});

requestAnimationFrame(animateLocalRoll);
