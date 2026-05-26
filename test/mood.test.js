/**
 * mood.js 单元测试 — 心情状态机
 */

// Mock memory 模块（mood.js 依赖 saveMood / getLastMood）
jest.mock('../electron/memory', () => ({
  saveMood: jest.fn(),
  getLastMood: jest.fn(() => 'happy'),
  getCurrentPersonaId: jest.fn(() => 'xiaoban'),
  setCurrentPersonaId: jest.fn(id => id)
}));

const {
  initMood, getCurrentMood, triggerEvent, setMood,
  resetMood, onMoodChange, MOODS, getProactiveInterval, switchPersona
} = require('../electron/mood');
const { saveMood, getLastMood, getCurrentPersonaId, setCurrentPersonaId } = require('../electron/memory');

beforeEach(() => {
  // 重置为 happy 状态
  jest.clearAllMocks();
  getLastMood.mockReturnValue('happy');
  getCurrentPersonaId.mockReturnValue('xiaoban');
  setCurrentPersonaId.mockImplementation(id => id);
  // 通过 resetMood 或 setMood 重置内部状态，这里直接用 initMood
});

// ---------- 辅助函数：重置到指定心情 ----------
function resetTo(mood) {
  // 用 mock 让 initMood 读到指定心情
  getLastMood.mockReturnValue(mood);
  initMood();
  // 清除 preManualMood（如果有的话）
  if (getCurrentMood() !== mood) {
    setMood(mood);
    resetMood();
  }
}

// ==================== MOODS 常量 ====================

describe('MOODS', () => {
  test('包含 5 种基础心情', () => {
    expect(MOODS).toEqual(['happy', 'excited', 'bored', 'sleepy', 'caring']);
  });
});

// ==================== initMood / getCurrentMood ====================

describe('initMood', () => {
  test('从存储恢复上次心情', () => {
    getLastMood.mockReturnValue('excited');
    const mood = initMood();
    expect(mood).toBe('excited');
    expect(getCurrentMood()).toBe('excited');
  });

  test('首次启动默认为 happy', () => {
    getLastMood.mockReturnValue('happy');
    const mood = initMood();
    expect(mood).toBe('happy');
  });
});

// ==================== setMood / resetMood ====================

describe('setMood', () => {
  beforeEach(() => resetTo('happy'));

  test('设置为有效心情', () => {
    const result = setMood('excited');
    expect(result).toBe('excited');
    expect(getCurrentMood()).toBe('excited');
    expect(saveMood).toHaveBeenCalledWith('excited', 'manual', 'xiaoban');
  });

  test('设置为无效心情保持原样', () => {
    const result = setMood('angry');
    expect(result).toBe('happy');
    expect(getCurrentMood()).toBe('happy');
    expect(saveMood).not.toHaveBeenCalled();
  });

  test('手动设置后保存原始心情', () => {
    setMood('sleepy');
    // preManualMood 应该记录为 happy
    resetMood();
    expect(getCurrentMood()).toBe('happy');
  });
});

describe('resetMood', () => {
  test('没有手动设置直接 reset 不变', () => {
    resetTo('excited');
    const result = resetMood();
    expect(result).toBe('excited');
    expect(saveMood).not.toHaveBeenCalled();
  });

  test('手动设置后 reset 恢复原心情', () => {
    resetTo('happy');
    setMood('bored');
    const result = resetMood();
    expect(result).toBe('happy');
    expect(saveMood).toHaveBeenCalledWith('happy', 'reset_auto', 'xiaoban');
  });

  test('连续 reset 两次，第二次无效', () => {
    resetTo('happy');
    setMood('bored');
    resetMood();
    // preManualMood 已清空，再次 reset 不应触发
    saveMood.mockClear();
    resetMood();
    expect(saveMood).not.toHaveBeenCalled();
  });
});

// ==================== onMoodChange 回调 ====================

describe('onMoodChange', () => {
  test('系统事件触发回调', () => {
    resetTo('happy');
    const cb = jest.fn();
    onMoodChange(cb);
    triggerEvent('late_night');
    expect(cb).toHaveBeenCalledWith({
      mood: 'sleepy',
      reason: 'late_night',
      oldMood: 'happy',
      personaId: 'xiaoban'
    });
  });

  test('手动设置触发回调', () => {
    resetTo('happy');
    const cb = jest.fn();
    onMoodChange(cb);
    setMood('caring');
    expect(cb).toHaveBeenCalledWith({
      mood: 'caring',
      reason: 'manual',
      oldMood: 'happy',
      personaId: 'xiaoban'
    });
  });

  test('心情未变化不触发回调', () => {
    resetTo('sleepy');
    const cb = jest.fn();
    onMoodChange(cb);
    triggerEvent('late_night'); // 已经是 sleepy
    expect(cb).not.toHaveBeenCalled();
  });
});

// ==================== triggerEvent ====================

describe('triggerEvent: user_interaction', () => {
  test('bored → happy(70%) 或 excited(30%)', () => {
    // 不测试具体概率，只验证两种可能结果
    const results = new Set();
    for (let i = 0; i < 50; i++) {
      resetTo('bored');
      triggerEvent('user_interaction');
      results.add(getCurrentMood());
    }
    expect([...results].every(m => ['happy', 'excited'].includes(m))).toBe(true);
  });

  test('sleepy → caring(50%) 或 happy(50%)', () => {
    const results = new Set();
    for (let i = 0; i < 50; i++) {
      resetTo('sleepy');
      triggerEvent('user_interaction');
      results.add(getCurrentMood());
    }
    expect([...results].every(m => ['caring', 'happy'].includes(m))).toBe(true);
  });

  test('happy 可能转 excited 或 caring 或保持', () => {
    const results = new Set();
    for (let i = 0; i < 30; i++) {
      resetTo('happy');
      triggerEvent('user_interaction');
      results.add(getCurrentMood());
    }
    // 可能转 excited(35%), caring(15%), 或保持 happy(50%)
    expect([...results].every(m => ['happy', 'excited', 'caring'].includes(m))).toBe(true);
  });
});

describe('triggerEvent: long_idle', () => {
  test('happy → bored', () => {
    resetTo('happy');
    triggerEvent('long_idle');
    expect(getCurrentMood()).toBe('bored');
  });

  test('excited → happy(50%) 或 bored(50%)', () => {
    const results = new Set();
    for (let i = 0; i < 50; i++) {
      resetTo('excited');
      triggerEvent('long_idle');
      results.add(getCurrentMood());
    }
    expect([...results].every(m => ['happy', 'bored'].includes(m))).toBe(true);
  });

  test('caring → bored(40%) 或保持 caring(60%)', () => {
    const results = new Set();
    for (let i = 0; i < 30; i++) {
      resetTo('caring');
      triggerEvent('long_idle');
      results.add(getCurrentMood());
    }
    expect([...results].every(m => ['caring', 'bored'].includes(m))).toBe(true);
  });

  test('sleepy 不受 long_idle 影响', () => {
    resetTo('sleepy');
    triggerEvent('long_idle');
    expect(getCurrentMood()).toBe('sleepy');
  });

  test('bored 不受 long_idle 影响', () => {
    resetTo('bored');
    triggerEvent('long_idle');
    expect(getCurrentMood()).toBe('bored');
  });
});

describe('triggerEvent: late_night', () => {
  test('任何心情强制转为 sleepy', () => {
    for (const mood of ['happy', 'excited', 'bored', 'caring']) {
      resetTo(mood);
      triggerEvent('late_night');
      expect(getCurrentMood()).toBe('sleepy');
    }
  });

  test('sleepy 保持 sleepy', () => {
    resetTo('sleepy');
    triggerEvent('late_night');
    expect(getCurrentMood()).toBe('sleepy');
  });
});

describe('triggerEvent: morning', () => {
  test('sleepy → happy', () => {
    resetTo('sleepy');
    triggerEvent('morning');
    expect(getCurrentMood()).toBe('happy');
  });

  test('其他心情可能转 happy(30%)', () => {
    // 30% 概率转 happy，这里多次采样验证可能结果
    const results = new Set();
    for (let i = 0; i < 30; i++) {
      resetTo('excited');
      triggerEvent('morning');
      results.add(getCurrentMood());
    }
    expect([...results].every(m => ['excited', 'happy'].includes(m))).toBe(true);
  });
});

describe('triggerEvent: long_work', () => {
  test('非 sleepy → caring(60%) 或 happy(40%)', () => {
    const results = new Set();
    for (let i = 0; i < 50; i++) {
      resetTo('bored');
      triggerEvent('long_work');
      results.add(getCurrentMood());
    }
    expect([...results].every(m => ['caring', 'happy'].includes(m))).toBe(true);
  });

  test('sleepy 保持 sleepy', () => {
    resetTo('sleepy');
    triggerEvent('long_work');
    expect(getCurrentMood()).toBe('sleepy');
  });
});

describe('triggerEvent: user_praises', () => {
  test('转为 happy(60%) 或 excited(40%)', () => {
    const results = new Set();
    for (let i = 0; i < 50; i++) {
      resetTo('bored');
      triggerEvent('user_praises');
      results.add(getCurrentMood());
    }
    expect([...results].every(m => ['happy', 'excited'].includes(m))).toBe(true);
  });
});

describe('triggerEvent: user_scolds', () => {
  test('excited → happy', () => {
    resetTo('excited');
    triggerEvent('user_scolds');
    expect(getCurrentMood()).toBe('happy');
  });

  test('happy → bored', () => {
    resetTo('happy');
    triggerEvent('user_scolds');
    expect(getCurrentMood()).toBe('bored');
  });

  test('其他心情 → bored', () => {
    for (const mood of ['caring', 'sleepy', 'bored']) {
      resetTo(mood);
      triggerEvent('user_scolds');
      expect(getCurrentMood()).toBe('bored');
    }
  });
});

describe('triggerEvent: user_happy', () => {
  test('bored → happy', () => {
    resetTo('bored');
    triggerEvent('user_happy');
    expect(getCurrentMood()).toBe('happy');
  });

  test('sleepy → happy(50%) 或 caring(50%)', () => {
    const results = new Set();
    for (let i = 0; i < 50; i++) {
      resetTo('sleepy');
      triggerEvent('user_happy');
      results.add(getCurrentMood());
    }
    expect([...results].every(m => ['happy', 'caring'].includes(m))).toBe(true);
  });
});

describe('triggerEvent: user_angry', () => {
  test('excited → happy', () => {
    resetTo('excited');
    triggerEvent('user_angry');
    expect(getCurrentMood()).toBe('happy');
  });

  test('happy → bored', () => {
    resetTo('happy');
    triggerEvent('user_angry');
    expect(getCurrentMood()).toBe('bored');
  });

  test('caring → bored', () => {
    resetTo('caring');
    triggerEvent('user_angry');
    expect(getCurrentMood()).toBe('bored');
  });
});

describe('triggerEvent: user_sad', () => {
  test('非 sleepy → caring(70%) 或 happy(30%)', () => {
    const results = new Set();
    for (let i = 0; i < 50; i++) {
      resetTo('happy');
      triggerEvent('user_sad');
      results.add(getCurrentMood());
    }
    expect([...results].every(m => ['caring', 'happy'].includes(m))).toBe(true);
  });

  test('sleepy 保持 sleepy', () => {
    resetTo('sleepy');
    triggerEvent('user_sad');
    expect(getCurrentMood()).toBe('sleepy');
  });
});

describe('triggerEvent: user_affectionate', () => {
  test('转为 excited(50%) 或 caring(50%)', () => {
    const results = new Set();
    for (let i = 0; i < 50; i++) {
      resetTo('happy');
      triggerEvent('user_affectionate');
      results.add(getCurrentMood());
    }
    expect([...results].every(m => ['excited', 'caring'].includes(m))).toBe(true);
  });
});

describe('triggerEvent: tick', () => {
  test('happy → excited/caring(15%) 或保持(85%)', () => {
    // 大部分情况保持 happy
    let stayedHappy = 0;
    for (let i = 0; i < 30; i++) {
      resetTo('happy');
      triggerEvent('tick');
      if (getCurrentMood() === 'happy') stayedHappy++;
    }
    expect(stayedHappy).toBeGreaterThan(0); // 至少有一些保持
  });

  test('excited → happy(25%) 或保持', () => {
    const results = new Set();
    for (let i = 0; i < 30; i++) {
      resetTo('excited');
      triggerEvent('tick');
      results.add(getCurrentMood());
    }
    expect([...results].every(m => ['excited', 'happy'].includes(m))).toBe(true);
  });

  test('sleepy 不受 tick 影响', () => {
    resetTo('sleepy');
    triggerEvent('tick');
    expect(getCurrentMood()).toBe('sleepy');
  });
});

// ==================== 系统事件清除手动标记 ====================

describe('系统事件清除手动 override 状态', () => {
  test('手动设置后，系统事件清除 preManualMood', () => {
    resetTo('happy');
    setMood('bored'); // preManualMood = happy
    triggerEvent('user_interaction'); // 系统事件
    // preManualMood 应被清除
    const result = resetMood(); // 不会再恢复
    expect(saveMood).toHaveBeenCalledWith(getCurrentMood(), 'user_interaction', 'xiaoban');
  });
});

describe('switchPersona', () => {
  test('切换人格时恢复该人格最后心情', () => {
    getLastMood.mockReturnValue('sleepy');
    const result = switchPersona('custom_1');
    expect(setCurrentPersonaId).toHaveBeenCalledWith('custom_1');
    expect(result).toEqual({ personaId: 'custom_1', mood: 'sleepy' });
  });
});

// ==================== getProactiveInterval ====================

describe('getProactiveInterval', () => {
  test('excited: 1-2 分钟', () => {
    resetTo('excited');
    expect(getProactiveInterval()).toEqual({ min: 1, max: 2 });
  });

  test('bored: 1-2 分钟', () => {
    resetTo('bored');
    expect(getProactiveInterval()).toEqual({ min: 1, max: 2 });
  });

  test('caring: 1.5-3 分钟', () => {
    resetTo('caring');
    expect(getProactiveInterval()).toEqual({ min: 1.5, max: 3 });
  });

  test('happy: 1.5-3.5 分钟', () => {
    resetTo('happy');
    expect(getProactiveInterval()).toEqual({ min: 1.5, max: 3.5 });
  });

  test('sleepy: 5-12 分钟', () => {
    resetTo('sleepy');
    expect(getProactiveInterval()).toEqual({ min: 5, max: 12 });
  });
});
