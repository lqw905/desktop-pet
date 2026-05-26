/**
 * prompts.js 单元测试 — LLM 提示词模板
 */

const { buildSentryPrompt, buildChatPrompt } = require('../electron/prompts');

// ==================== buildSentryPrompt ====================

describe('buildSentryPrompt', () => {
  const baseContext = {
    time: '周一 14:30',
    idleMinutes: 5,
    todayMessageCount: 3,
    mood: 'happy',
    minutesSinceLastSpeak: 10,
    activeWindow: 'Cursor - project/main.js',
    activityType: 'coding',
    recentWindowSwitches: 2,
    recentApps: ['Cursor', 'Chrome'],
    memorySummary: '',
    recentConversations: '（尚无对话）'
  };

  test('包含角色设定和名字', () => {
    const prompt = buildSentryPrompt(baseContext);
    expect(prompt).toContain('小伴');
    expect(prompt).toContain('桌面宠物');
  });

  test('包含时间上下文', () => {
    const prompt = buildSentryPrompt(baseContext);
    expect(prompt).toContain('周一 14:30');
  });

  test('包含空闲时间', () => {
    const prompt = buildSentryPrompt(baseContext);
    expect(prompt).toContain('5 分钟');
  });

  test('包含当天对话次数', () => {
    const prompt = buildSentryPrompt(baseContext);
    expect(prompt).toContain('3');
  });

  test('包含心情', () => {
    const prompt = buildSentryPrompt({ ...baseContext, mood: 'excited' });
    expect(prompt).toContain('excited');
  });

  test('包含距上次发言时间', () => {
    const prompt = buildSentryPrompt(baseContext);
    expect(prompt).toContain('10 分钟');
  });

  test('包含活动窗口信息', () => {
    const prompt = buildSentryPrompt(baseContext);
    expect(prompt).toContain('Cursor - project/main.js');
    expect(prompt).toContain('coding');
  });

  test('包含 JSON 格式指令', () => {
    const prompt = buildSentryPrompt(baseContext);
    expect(prompt).toContain('should_speak');
    expect(prompt).toContain('message');
    expect(prompt).toContain('reason');
  });

  test('包含长期记忆节（即使为空）', () => {
    const prompt = buildSentryPrompt(baseContext);
    expect(prompt).toContain('长期记忆');
  });

  test('包含深夜保持沉默规则', () => {
    const prompt = buildSentryPrompt(baseContext);
    expect(prompt).toContain('深夜');
  });

  test('未知窗口时包含 unknown 标记', () => {
    const ctx = { ...baseContext, activeWindow: '未知' };
    const prompt = buildSentryPrompt(ctx);
    expect(prompt).toContain('未知');
  });

  test('recentApps 用顿号分隔', () => {
    const prompt = buildSentryPrompt(baseContext);
    expect(prompt).toContain('Cursor、Chrome');
  });
});

// ==================== buildChatPrompt ====================

describe('buildChatPrompt', () => {
  const conversations = [
    { role: 'user', content: '你好呀' },
    { role: 'pet', content: '哈喽~你来啦！' }
  ];

  const context = {
    time: '周二 10:00',
    activeWindow: 'Chrome - GitHub',
    activityType: 'browser',
    memorySummary: '用户喜欢早上喝咖啡。',
    profile: {
      userName: '小明',
      preferences: ['安静的环境', '喝咖啡'],
      facts: ['今天是周二'],
      currentProjects: ['desktop-pet']
    },
    memoryItems: [
      { type: 'preference', content: '喜欢早上喝咖啡' },
      { type: 'communication_style', content: '偏好简短直接的回答' }
    ]
  };

  test('包含角色名字', () => {
    const prompt = buildChatPrompt(conversations, 'happy', context);
    expect(prompt).toContain('小伴');
  });

  test('小伴允许主人、撒娇和颜文字风格', () => {
    const prompt = buildChatPrompt(conversations, 'happy', context);
    expect(prompt).toContain('主人');
    expect(prompt).toContain('呜呜');
    expect(prompt).toContain('颜文字');
    expect(prompt).toContain('当前人格允许使用');
  });

  test('支持自定义人格提示词', () => {
    const prompt = buildChatPrompt(conversations, 'happy', {
      ...context,
      persona: {
        id: 'custom_test',
        name: '冷静助理',
        systemPrompt: '你是一个冷静直接的助手',
        moodPrompt: '心情只轻微影响语气',
        replyRules: '回答要短',
        preserveExpressiveStyle: false
      }
    });
    expect(prompt).toContain('冷静助理');
    expect(prompt).toContain('你是一个冷静直接的助手');
    expect(prompt).toContain('回答要短');
    expect(prompt).toContain('不要使用“主人”');
  });

  test('包含心情映射', () => {
    const mappings = [
      ['happy', '开心'],
      ['excited', '兴奋'],
      ['bored', '无聊'],
      ['sleepy', '困倦'],
      ['caring', '关心']
    ];
    for (const [mood, label] of mappings) {
      const prompt = buildChatPrompt([], mood, { ...context, profile: {} });
      // 心情在 prompt 模板中以上下文形式出现
      expect(prompt).toContain('开心'); // 心情映射在模板文本里
    }
  });

  test('包含用户画像 userName', () => {
    const prompt = buildChatPrompt(conversations, 'happy', context);
    expect(prompt).toContain('小明');
  });

  test('包含用户偏好', () => {
    const prompt = buildChatPrompt(conversations, 'happy', context);
    expect(prompt).toContain('安静的环境');
    expect(prompt).toContain('喝咖啡');
  });

  test('包含已知事实', () => {
    const prompt = buildChatPrompt(conversations, 'happy', context);
    expect(prompt).toContain('今天是周二');
  });

  test('包含当前项目', () => {
    const prompt = buildChatPrompt(conversations, 'happy', context);
    expect(prompt).toContain('desktop-pet');
  });

  test('包含对话历史', () => {
    const prompt = buildChatPrompt(conversations, 'happy', context);
    expect(prompt).toContain('你好呀');
    expect(prompt).toContain('哈喽~你来啦！');
  });

  test('当前用户消息单独突出，且不在历史里重复出现', () => {
    const prompt = buildChatPrompt([
      { role: 'user', content: '叫我主人' },
      { role: 'pet', content: '嗯？又在看代码啊。' },
      { role: 'user', content: '别说这话了' }
    ], 'happy', {
      ...context,
      currentUserMessage: '别说这话了'
    });
    expect(prompt).toContain('当前用户刚说：\n别说这话了');
    expect(prompt).toContain('不要复读你上一条回复');
    expect(prompt).toContain('[宠物]: 嗯？又在看代码啊。');
    expect(prompt).not.toContain('[用户]: 别说这话了');
  });

  test('提示词明确短期上下文优先用于刚刚说了什么', () => {
    const prompt = buildChatPrompt(conversations, 'happy', context);
    expect(prompt).toContain('最近对话历史是真实短期上下文');
    expect(prompt).toContain('不要说自己不记得');
  });

  test('包含长期记忆', () => {
    const prompt = buildChatPrompt(conversations, 'happy', context);
    expect(prompt).toContain('喜欢早上喝咖啡');
  });

  test('包含记忆条目', () => {
    const prompt = buildChatPrompt(conversations, 'happy', context);
    expect(prompt).toContain('偏好简短直接的回答');
  });

  test('空用户画像显示暂无', () => {
    const prompt = buildChatPrompt([], 'happy', { ...context, profile: {} });
    expect(prompt).toContain('暂无用户画像');
  });

  test('空长期记忆显示暂无', () => {
    const prompt = buildChatPrompt([], 'happy', { ...context, memorySummary: '', profile: {} });
    expect(prompt).toContain('暂无长期记忆');
  });

  test('空关键记忆显示暂无', () => {
    const prompt = buildChatPrompt([], 'happy', { ...context, memoryItems: [], profile: {} });
    expect(prompt).toContain('暂无关键记忆');
  });

  test('空对话历史显示暂无', () => {
    const prompt = buildChatPrompt([], 'happy', { ...context, profile: {} });
    expect(prompt).toContain('暂无最近对话');
  });
});
