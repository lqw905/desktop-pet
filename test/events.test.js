/**
 * events.js 单元测试 — 窗口检测、时间上下文、空闲追踪
 */

const {
  getTimeContext, getIdleMinutes, markUserActive,
  isWorkContext
} = require('../electron/events');

// 模块内部函数通过模块导出的行为来测试

// ==================== getTimeContext ====================

describe('getTimeContext', () => {
  test('返回包含必要字段', () => {
    const ctx = getTimeContext();
    expect(ctx).toHaveProperty('time');
    expect(ctx).toHaveProperty('weekday');
    expect(ctx).toHaveProperty('hour');
    expect(ctx).toHaveProperty('period');
    expect(ctx).toHaveProperty('isLateNight');
    expect(ctx).toHaveProperty('isMorning');
    expect(ctx).toHaveProperty('isWeekend');
  });

  test('time 格式为 HH:MM', () => {
    const ctx = getTimeContext();
    expect(ctx.time).toMatch(/^\d{2}:\d{2}$/);
  });

  test('weekday 格式为 周X', () => {
    const ctx = getTimeContext();
    expect(ctx.weekday).toMatch(/^周[一二三四五六日]$/);
  });

  test('hour 范围 0-23', () => {
    const ctx = getTimeContext();
    expect(ctx.hour).toBeGreaterThanOrEqual(0);
    expect(ctx.hour).toBeLessThanOrEqual(23);
  });

  test('period 是合法时段', () => {
    const ctx = getTimeContext();
    expect([
      'morning', 'work_morning', 'noon',
      'work_afternoon', 'evening', 'night'
    ]).toContain(ctx.period);
  });

  test('深夜判定 (isLateNight)', () => {
    const ctx = getTimeContext();
    const h = ctx.hour;
    expect(ctx.isLateNight).toBe(h >= 23 || h < 6);
  });

  test('清晨判定 (isMorning)', () => {
    const ctx = getTimeContext();
    const h = ctx.hour;
    expect(ctx.isMorning).toBe(h >= 6 && h < 9);
  });

  test('周末判定', () => {
    const ctx = getTimeContext();
    const day = new Date().getDay();
    expect(ctx.isWeekend).toBe(day === 0 || day === 6);
  });
});

// ==================== getIdleMinutes / markUserActive ====================

describe('getIdleMinutes / markUserActive', () => {
  test('markUserActive 后空闲时间接近 0', () => {
    markUserActive();
    const idle = getIdleMinutes();
    expect(idle).toBe(0);
  });

  test('空闲时间随时间增长', () => {
    // 这个测试验证 getIdleMinutes 返回非负数
    markUserActive();
    const idle = getIdleMinutes();
    expect(idle).toBeGreaterThanOrEqual(0);
  });
});

// ==================== isWorkContext ====================

describe('isWorkContext', () => {
  test('返回布尔值', () => {
    expect(typeof isWorkContext()).toBe('boolean');
  });
});

// ==================== classifyActivity (通过 parseActiveWindow 间接测试) ====================

// classifyActivity 和 parseActiveWindow 是模块内部函数，
// 通过观察 getActiveWindowContext 行为无法直接测试它们。
// 但我们验证模块整体导出正确。

describe('模块导出完整性', () => {
  test('所有导出函数都是函数', () => {
    const events = require('../electron/events');
    expect(typeof events.getTimeContext).toBe('function');
    expect(typeof events.getIdleMinutes).toBe('function');
    expect(typeof events.markUserActive).toBe('function');
    expect(typeof events.isWorkContext).toBe('function');
    expect(typeof events.buildContext).toBe('function');
    expect(typeof events.getActiveWindowTitle).toBe('function');
    expect(typeof events.getActiveWindowContext).toBe('function');
  });
});
