/**
 * memory.js 单元测试 — 数据持久化模块
 */

// 必须在 require 前 mock electron
const mockApp = {
  getPath: jest.fn(() => '/tmp/test-pet-data')
};
jest.mock('electron', () => ({
  app: mockApp
}));

// 禁止实际读写磁盘
jest.mock('fs', () => ({
  existsSync: jest.fn(() => false),
  readFileSync: jest.fn(() => '{}'),
  writeFileSync: jest.fn()
}));

const {
  initDatabase, saveData, closeDatabase, clearMemory,
  getCurrentPersonaId, setCurrentPersonaId,
  getAllPersonas, getCurrentPersona, saveCustomPersona, deleteCustomPersona,
  saveMessage, getRecentConversations, getRecentChatConversations, getTodayMessageCount,
  getLastPetMessageTime, setMemory, getMemory,
  saveMood, getLastMood, getLastMoodReason,
  getMemorySettings, setRollingEnabled, getMemorySummary, setMemorySummary,
  getProfile, setProfile, mergeProfilePatch,
  shouldReviewMemory, getMessagesForMemoryReview, markMemoryReviewed,
  applyMemoryReview, getMemoryItems, getMemoryContextItems, getMemoryStats,
  cleanOldConversations
} = require('../electron/memory');
const fs = require('fs');

// ==================== 基础结构 ====================

describe('initDatabase', () => {
  test('首次初始化成功创建数据结构', () => {
    initDatabase();
    expect(getLastMood()).toBe('happy');
    expect(getRecentConversations()).toEqual([]);
    expect(getMemorySettings()).toBeDefined();
  });

  test('memoryEnabled 默认为 true', () => {
    const settings = getMemorySettings();
    expect(settings.memoryEnabled).toBe(true);
  });

  test('saveRawMessages 默认为 true', () => {
    const settings = getMemorySettings();
    expect(settings.saveRawMessages).toBe(true);
  });

  test('rollingEnabled 默认为 false，且可以切换', () => {
    initDatabase();
    expect(getMemorySettings().rollingEnabled).toBe(false);
    expect(setRollingEnabled(true)).toBe(true);
    expect(getMemorySettings().rollingEnabled).toBe(true);
    expect(setRollingEnabled(false)).toBe(false);
    expect(getMemorySettings().rollingEnabled).toBe(false);
  });

  test('rollingEnabled 会从本地数据恢复', () => {
    fs.existsSync.mockReturnValueOnce(true);
    fs.readFileSync.mockReturnValueOnce(JSON.stringify({
      settings: { rollingEnabled: false },
      conversations: [],
      moodHistory: []
    }));

    initDatabase();
    expect(getMemorySettings().rollingEnabled).toBe(false);
  });

  test('getProfile 返回完整画像结构', () => {
    initDatabase();
    const profile = getProfile();
    expect(profile).toHaveProperty('identity');
    expect(profile).toHaveProperty('userName');
    expect(profile).toHaveProperty('preferences');
    expect(profile).toHaveProperty('dislikes');
    expect(profile).toHaveProperty('habits');
    expect(profile).toHaveProperty('personality');
    expect(profile).toHaveProperty('communicationStyle');
    expect(profile).toHaveProperty('boundaries');
    expect(profile).toHaveProperty('facts');
    expect(profile).toHaveProperty('currentProjects');
    // 初始为空
    expect(profile.userName).toBe('');
    expect(profile.preferences).toEqual([]);
  });

  test('getMemorySummary 初始为空字符串', () => {
    initDatabase();
    expect(getMemorySummary()).toBe('');
  });

  test('getMemoryContextItems 初始为空数组', () => {
    initDatabase();
    expect(getMemoryContextItems()).toEqual([]);
  });

  test('getMemoryStats 返回初始统计', () => {
    initDatabase();
    const stats = getMemoryStats();
    expect(stats.memoryItems).toBe(0);
    expect(stats.inboxItems).toBe(0);
    expect(stats.lastReviewedMessageId).toBe(0);
  });
});

// ==================== 人格状态 ====================

describe('persona state', () => {
  test('默认人格为小伴', () => {
    clearMemory();
    expect(getCurrentPersonaId()).toBe('xiaoban');
    expect(getCurrentPersona().name).toBe('小伴');
  });

  test('可以创建并切换自定义人格', () => {
    clearMemory();
    const persona = saveCustomPersona({
      name: '冷静助理',
      description: '适合排错',
      systemPrompt: '你是一个冷静直接的助手'
    });
    expect(persona.id).toMatch(/^custom_/);
    expect(persona.editable).toBe(true);
    expect(getCurrentPersonaId()).toBe(persona.id);
    expect(getAllPersonas().some(item => item.id === persona.id)).toBe(true);
  });

  test('可以更新自定义人格', () => {
    clearMemory();
    const persona = saveCustomPersona({
      name: '旧名字',
      systemPrompt: '旧提示词'
    });
    const updated = saveCustomPersona({
      id: persona.id,
      name: '新名字',
      description: '新描述',
      systemPrompt: '新提示词'
    });
    expect(updated.id).toBe(persona.id);
    expect(updated.name).toBe('新名字');
    expect(getCurrentPersona().name).toBe('新名字');
  });

  test('删除当前自定义人格后回到小伴', () => {
    clearMemory();
    const persona = saveCustomPersona({ name: '临时人格', systemPrompt: '临时提示词' });
    const result = deleteCustomPersona(persona.id);
    expect(result.ok).toBe(true);
    expect(getCurrentPersonaId()).toBe('xiaoban');
  });

  test('不能删除内置人格', () => {
    clearMemory();
    const result = deleteCustomPersona('xiaoban');
    expect(result.ok).toBe(false);
    expect(getCurrentPersonaId()).toBe('xiaoban');
  });

  test('无效人格会回到默认人格', () => {
    clearMemory();
    expect(setCurrentPersonaId('missing')).toBe('xiaoban');
  });
});

// ==================== 消息管理 ====================

describe('saveMessage / getRecentConversations', () => {
  test('保存并读取消息', () => {
    initDatabase();
    clearMemory();
    saveMessage('user', '你好');
    saveMessage('pet', '你好呀！');
    const recent = getRecentConversations(10);
    expect(recent).toHaveLength(2);
    expect(recent[0].role).toBe('user');
    expect(recent[0].content).toBe('你好');
    expect(recent[1].role).toBe('pet');
    expect(recent[1].content).toBe('你好呀！');
  });

  test('每条消息有唯一递增 ID', () => {
    clearMemory();
    const m1 = saveMessage('user', 'msg1');
    const m2 = saveMessage('user', 'msg2');
    expect(m1.id).toBeLessThan(m2.id);
  });

  test('消息包含 created_at', () => {
    clearMemory();
    const msg = saveMessage('user', 'test');
    expect(msg.created_at).toBeDefined();
    expect(new Date(msg.created_at).getTime()).not.toBeNaN();
  });

  test('消息默认标记为 chat 来源', () => {
    clearMemory();
    const msg = saveMessage('user', 'test');
    expect(msg.source).toBe('chat');
  });

  test('getRecentConversations 限制数量', () => {
    clearMemory();
    for (let i = 0; i < 20; i++) {
      saveMessage('user', `msg${i}`);
    }
    const recent = getRecentConversations(5);
    expect(recent).toHaveLength(5);
    expect(recent[4].content).toBe('msg19');
  });

  test('不同人格的最近对话互不影响', () => {
    clearMemory();
    saveMessage('user', '小伴消息');
    const persona = saveCustomPersona({ name: '自定义', systemPrompt: '自定义提示词' });
    saveMessage('user', '自定义消息');
    expect(getRecentConversations(10).map(m => m.content)).toEqual(['自定义消息']);
    setCurrentPersonaId('xiaoban');
    expect(getRecentConversations(10).map(m => m.content)).toEqual(['小伴消息']);
    setCurrentPersonaId(persona.id);
    expect(getRecentConversations(10).map(m => m.content)).toEqual(['自定义消息']);
  });

  test('聊天上下文过滤主动提醒消息', () => {
    clearMemory();
    saveMessage('user', '写一段 ts 代码');
    saveMessage('pet', '好的，主人，我来写。');
    saveMessage('pet', '主人在用 Codex 呢，要不要休息？', getCurrentPersonaId(), 'proactive');
    saveMessage('pet', '主人在用 Chrome 呢，要不要休息？', getCurrentPersonaId(), 'proactive');
    saveMessage('user', '我刚刚问了什么？');

    expect(getRecentConversations(10).map(m => m.content)).toEqual([
      '写一段 ts 代码',
      '好的，主人，我来写。',
      '主人在用 Codex 呢，要不要休息？',
      '主人在用 Chrome 呢，要不要休息？',
      '我刚刚问了什么？'
    ]);
    expect(getRecentChatConversations(10).map(m => m.content)).toEqual([
      '写一段 ts 代码',
      '好的，主人，我来写。',
      '我刚刚问了什么？'
    ]);
  });

  test('聊天上下文兼容旧数据，过滤连续宠物消息', () => {
    clearMemory();
    saveMessage('user', '我要写 TS');
    saveMessage('pet', '好的，我帮你。');
    saveMessage('pet', '主人在用 Codex 呢。');
    saveMessage('pet', '主人在用 Chrome 呢。');
    saveMessage('user', '我刚刚说了什么？');

    expect(getRecentChatConversations(10).map(m => m.content)).toEqual([
      '我要写 TS',
      '好的，我帮你。',
      '我刚刚说了什么？'
    ]);
  });
});

describe('getTodayMessageCount', () => {
  test('返回今天的消息数', () => {
    clearMemory();
    saveMessage('user', 'hello');
    saveMessage('pet', 'hi');
    expect(getTodayMessageCount()).toBe(2);
  });
});

describe('getLastPetMessageTime', () => {
  test('没有宠物消息返回 null', () => {
    clearMemory();
    saveMessage('user', 'hello');
    expect(getLastPetMessageTime()).toBeNull();
  });

  test('返回最后一条宠物消息时间', () => {
    clearMemory();
    saveMessage('user', 'hello');
    saveMessage('pet', 'hi there');
    const time = getLastPetMessageTime();
    expect(time).toBeDefined();
    expect(new Date(time).getTime()).not.toBeNaN();
  });
});

// ==================== 心情持久化 ====================

describe('saveMood / getLastMood', () => {
  test('无历史默认返回 happy', () => {
    clearMemory();
    expect(getLastMood()).toBe('happy');
  });

  test('保存并读取最后心情', () => {
    clearMemory();
    saveMood('excited', 'user_interaction');
    expect(getLastMood()).toBe('excited');
  });

  test('getLastMoodReason 返回原因', () => {
    clearMemory();
    saveMood('bored', 'long_idle');
    expect(getLastMoodReason()).toBe('long_idle');
  });

  test('getLastMoodReason 无历史返回 null', () => {
    clearMemory();
    expect(getLastMoodReason()).toBeNull();
  });

  test('不同人格的心情历史互不影响', () => {
    clearMemory();
    saveMood('excited', 'manual');
    const persona = saveCustomPersona({ name: '自定义', systemPrompt: '自定义提示词' });
    expect(getLastMood()).toBe('happy');
    saveMood('sleepy', 'late_night');
    expect(getLastMood()).toBe('sleepy');
    setCurrentPersonaId('xiaoban');
    expect(getLastMood()).toBe('excited');
    setCurrentPersonaId(persona.id);
    expect(getLastMood()).toBe('sleepy');
  });
});

// ==================== key-value 记忆 ====================

describe('setMemory / getMemory', () => {
  test('保存和读取', () => {
    clearMemory();
    setMemory('testKey', 'testValue');
    expect(getMemory('testKey')).toBe('testValue');
  });

  test('不存在的 key 返回 null', () => {
    clearMemory();
    expect(getMemory('nonexistent')).toBeNull();
  });

  test('覆盖已有 key', () => {
    clearMemory();
    setMemory('key', 'old');
    setMemory('key', 'new');
    expect(getMemory('key')).toBe('new');
  });
});

// ==================== 长期记忆 ====================

describe('setMemorySummary / getMemorySummary', () => {
  test('设置和读取摘要', () => {
    clearMemory();
    setMemorySummary('这是测试摘要');
    expect(getMemorySummary()).toBe('这是测试摘要');
  });

  test('超过 maxChars 会被截断', () => {
    clearMemory();
    const longStr = '中'.repeat(2000);
    setMemorySummary(longStr);
    const result = getMemorySummary();
    expect(result.length).toBeLessThanOrEqual(1200);
  });
});

describe('setProfile / getProfile', () => {
  test('设置部分用户画像字段', () => {
    clearMemory();
    const profile = setProfile({
      userName: '小明',
      preferences: ['喜欢猫', '喜欢咖啡']
    });
    expect(profile.userName).toBe('小明');
    expect(profile.preferences).toEqual(['喜欢猫', '喜欢咖啡']);
  });

  test('userName 超过 80 字符被截断', () => {
    clearMemory();
    const result = setProfile({ userName: 'x'.repeat(100) });
    expect(result.userName.length).toBe(80);
  });

  test('preferences 超过 12 条被截断', () => {
    clearMemory();
    const prefs = Array.from({ length: 20 }, (_, i) => `偏好${i}`);
    const result = setProfile({ preferences: prefs });
    expect(result.preferences).toHaveLength(12);
  });

  test('设置非预期字段不覆盖现有', () => {
    clearMemory();
    setProfile({ userName: '小明' });
    setProfile({ preferences: ['喜欢猫'] });
    const profile = getProfile();
    expect(profile.userName).toBe('小明');
    expect(profile.preferences).toEqual(['喜欢猫']);
  });
});

describe('mergeProfilePatch', () => {
  test('合并 preferences 去重', () => {
    clearMemory();
    setProfile({ preferences: ['咖啡', '编程'] });
    mergeProfilePatch({ preferences: ['编程', '跑步'] });
    const profile = getProfile();
    expect(profile.preferences).toContain('咖啡');
    expect(profile.preferences).toContain('编程');
    expect(profile.preferences).toContain('跑步');
  });

  test('合并 identity 对象', () => {
    clearMemory();
    mergeProfilePatch({ identity: { role: '程序员', city: '北京' } });
    mergeProfilePatch({ identity: { city: '上海' } });
    const profile = getProfile();
    expect(profile.identity.role).toBe('程序员');
    expect(profile.identity.city).toBe('上海');
  });

  test('空字符串 userName 不覆盖现有', () => {
    clearMemory();
    setProfile({ userName: '小明' });
    mergeProfilePatch({ userName: '' });
    expect(getProfile().userName).toBe('小明');
  });

  test('空白的 userName 不覆盖', () => {
    clearMemory();
    setProfile({ userName: '小红' });
    mergeProfilePatch({ userName: '   ' });
    expect(getProfile().userName).toBe('小红');
  });
});

// ==================== 记忆审查 ====================

describe('shouldReviewMemory', () => {
  test('初始状态需要审查', () => {
    clearMemory();
    initDatabase();
    // 没有消息时，lastReviewedMessageId=0，0-0=0 < reviewEvery，所以不需要
    expect(shouldReviewMemory()).toBe(false);
  });

  test('达到阈值后需要审查', () => {
    clearMemory();
    initDatabase();
    const settings = getMemorySettings();
    // 保存足够数量的消息
    for (let i = 0; i < settings.memoryReviewEvery; i++) {
      saveMessage('user', `msg${i}`);
    }
    expect(shouldReviewMemory()).toBe(true);
  });
});

describe('getMessagesForMemoryReview', () => {
  test('返回未审查的消息', () => {
    clearMemory();
    initDatabase();
    for (let i = 0; i < 10; i++) {
      saveMessage('user', `msg${i}`);
    }
    const msgs = getMessagesForMemoryReview(5);
    expect(msgs.length).toBeGreaterThan(0);
    // 所有消息 ID 应该大于 0（初始 lastReviewedMessageId=0）
    msgs.forEach(m => expect(m.id).toBeGreaterThan(0));
  });
});

describe('markMemoryReviewed', () => {
  test('标记后可审查消息减少', () => {
    clearMemory();
    initDatabase();
    saveMessage('user', 'hello');
    saveMessage('pet', 'hi');
    markMemoryReviewed();
    expect(shouldReviewMemory()).toBe(false);
  });
});

// ==================== applyMemoryReview ====================

describe('applyMemoryReview', () => {
  test('shouldPersist=true 会存储记忆条目', () => {
    clearMemory();
    initDatabase();
    const statsBefore = getMemoryStats();
    applyMemoryReview({
      shouldPersist: true,
      reason: '用户表达了偏好',
      memoryItems: [
        {
          type: 'preference',
          content: '主人喜欢喝咖啡',
          evidence: '用户说喜欢咖啡',
          confidence: 0.9,
          sensitivity: 'low'
        }
      ]
    });
    const statsAfter = getMemoryStats();
    expect(statsAfter.memoryItems).toBeGreaterThan(statsBefore.memoryItems);
    expect(statsAfter.inboxItems).toBeGreaterThan(statsBefore.inboxItems);
  });

  test('shouldPersist=false 不会新增记忆条目', () => {
    clearMemory();
    initDatabase();
    applyMemoryReview({
      shouldPersist: false,
      reason: '没有值得记住的内容'
    });
    const stats = getMemoryStats();
    expect(stats.memoryItems).toBe(0);
  });

  test('同时更新 profilePatch', () => {
    clearMemory();
    initDatabase();
    applyMemoryReview({
      shouldPersist: true,
      memoryItems: [],
      profilePatch: {
        userName: '小红',
        preferences: ['安静的环境']
      }
    });
    const profile = getProfile();
    expect(profile.userName).toBe('小红');
    expect(profile.preferences).toContain('安静的环境');
  });

  test('high sensitivity 默认被过滤', () => {
    clearMemory();
    initDatabase();
    const statsBefore = getMemoryStats();
    applyMemoryReview({
      shouldPersist: true,
      memoryItems: [
        {
          type: 'fact',
          content: '高敏信息',
          sensitivity: 'high',
          confidence: 0.9
        }
      ]
    });
    const statsAfter = getMemoryStats();
    // 高敏信息被过滤，数量不变
    expect(statsAfter.memoryItems).toBe(statsBefore.memoryItems);
  });
});

// ==================== clearMemory ====================

describe('clearMemory', () => {
  test('清空所有数据', () => {
    initDatabase();
    saveMessage('user', 'hello');
    saveMood('excited', 'test');
    setMemory('key', 'value');
    setProfile({ userName: '小明' });
    setMemorySummary('test summary');

    clearMemory();

    expect(getRecentConversations()).toEqual([]);
    expect(getLastMood()).toBe('happy');
    expect(getMemory('key')).toBeNull();
    expect(getProfile().userName).toBe('');
    expect(getMemorySummary()).toBe('');
    expect(getMemoryContextItems()).toEqual([]);
  });
});

// ==================== cleanOldConversations ====================

describe('cleanOldConversations', () => {
  test('超过阈值时裁剪旧消息', () => {
    clearMemory();
    for (let i = 0; i < 100; i++) {
      saveMessage('user', `msg${i}`);
    }
    // 用较小阈值裁剪
    cleanOldConversations(5);
    const recent = getRecentConversations(100);
    expect(recent.length).toBe(5);
    // 保留最新的
    expect(recent[4].content).toBe('msg99');
  });

  test('未超过阈值不做裁剪', () => {
    clearMemory();
    for (let i = 0; i < 5; i++) {
      saveMessage('user', `msg${i}`);
    }
    cleanOldConversations(500);
    expect(getRecentConversations(100)).toHaveLength(5);
  });
});

// ==================== getMemoryContextItems ====================

describe('getMemoryContextItems', () => {
  test('返回有限数量的记忆条目', () => {
    clearMemory();
    initDatabase();
    // 添加一些记忆
    const items = Array.from({ length: 20 }, (_, i) => ({
      type: 'fact',
      content: `fact ${i}`,
      confidence: 0.5 + i * 0.02
    }));
    applyMemoryReview({ shouldPersist: true, memoryItems: items });
    const contextItems = getMemoryContextItems();
    const settings = getMemorySettings();
    expect(contextItems.length).toBeLessThanOrEqual(settings.memoryContextItems);
  });
});

// ==================== 辅助：tokenize 和 similarity ====================

// 通过 upsert 间接测试（tokenize 和 similarity 在 normalizeMemoryItem 中使用）
describe('记忆去重逻辑', () => {
  test('相同 content 会合并而非重复添加', () => {
    clearMemory();
    initDatabase();
    applyMemoryReview({
      shouldPersist: true,
      memoryItems: [
        { type: 'preference', content: '喜欢咖啡', confidence: 0.8 }
      ]
    });
    applyMemoryReview({
      shouldPersist: true,
      memoryItems: [
        { type: 'preference', content: '喜欢咖啡', confidence: 0.9 }
      ]
    });
    const stats = getMemoryStats();
    expect(stats.memoryItems).toBe(1);
  });
});
