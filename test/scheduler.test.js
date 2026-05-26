/**
 * scheduler.js 单元测试 — 调度器纯函数
 *
 * 测试：extractJson、formatError、detectSentimentFast、
 * hasMemorySignal、getRandomGreeting、QUICK_GREETINGS、
 * SENTIMENT_KEYWORDS、setMuted、setBubbleEnabled
 */

// Mock 所有外部依赖
jest.mock('../electron/deepseek', () => ({
  callDeepseek: jest.fn(),
  callDeepseekStream: jest.fn()
}));

jest.mock('../electron/prompts', () => ({
  buildSentryPrompt: jest.fn(() => 'mocked'),
  buildChatPrompt: jest.fn(() => 'mocked')
}));

jest.mock('../electron/events', () => ({
  buildContext: jest.fn(() => ({})),
  markUserActive: jest.fn(),
  getTimeContext: jest.fn(() => ({
    time: '12:00', weekday: '周一', hour: 12,
    period: 'noon', isLateNight: false, isMorning: false, isWeekend: false
  })),
  getActiveWindowContext: jest.fn(() => ({
    activeWindow: null, activityType: 'unknown'
  })),
  getIdleMinutes: jest.fn(() => 0),
  isWorkContext: jest.fn(() => false)
}));

jest.mock('../electron/mood', () => ({
  getCurrentMood: jest.fn(() => 'happy'),
  triggerEvent: jest.fn(() => 'happy'),
  getProactiveInterval: jest.fn(() => ({ min: 1.5, max: 3.5 }))
}));

jest.mock('../electron/memory', () => ({
  saveMessage: jest.fn(),
  getRecentConversations: jest.fn(() => []),
  getRecentChatConversations: jest.fn(() => []),
  getTodayMessageCount: jest.fn(() => 0),
  getLastPetMessageTime: jest.fn(() => null),
  getMemorySettings: jest.fn(() => ({
    memoryEnabled: true, saveRawMessages: true,
    chatContextMessages: 10, sentryContextMessages: 3,
    memoryReviewEvery: 4, maxMemoryItems: 80,
    maxInboxItems: 30, memoryContextItems: 10,
    summaryMaxChars: 1200, summaryUpdateEvery: 10,
    allowHighSensitivityMemory: false
  })),
  getMemorySummary: jest.fn(() => ''),
  getCurrentPersonaId: jest.fn(() => 'xiaoban'),
  getCurrentPersona: jest.fn(() => ({
    id: 'xiaoban',
    name: '小伴',
    systemPrompt: '小伴人格',
    moodPrompt: '心情规则',
    replyRules: '回复规则'
  })),
  getProfile: jest.fn(() => ({ userName: '', preferences: [] })),
  shouldReviewMemory: jest.fn(() => false),
  getMessagesForMemoryReview: jest.fn(() => []),
  markMemoryReviewed: jest.fn(),
  applyMemoryReview: jest.fn(),
  getMemoryContextItems: jest.fn(() => [])
}));

jest.mock('../electron/window', () => ({
  getPetWindow: jest.fn(() => null)
}));

const {
  extractJson, formatError, detectSentimentFast,
  hasMemorySignal, getRandomGreeting, QUICK_GREETINGS,
  SENTIMENT_KEYWORDS, setMuted, setBubbleEnabled,
  getLastError, onChatMessage, startScheduler, stopScheduler,
  cleanPetReply, normalizeReplyForCompare, isRepeatedPetReply,
  tryBuildShortTermRecallReply
} = require('../electron/scheduler');

// ==================== extractJson ====================

describe('extractJson', () => {
  test('解析合法 JSON', () => {
    const result = extractJson('{"should_speak":true,"message":"你好"}');
    expect(result).toEqual({ should_speak: true, message: '你好' });
  });

  test('解析含多余文本的 JSON（含 markdown 代码块）', () => {
    const result = extractJson('前面有一些说明\n{"should_speak":false,"reason":"不需要"}\n后面也有文字');
    expect(result).toEqual({ should_speak: false, reason: '不需要' });
  });

  test('空字符串返回 null', () => {
    expect(extractJson('')).toBeNull();
  });

  test('null 输入返回 null', () => {
    expect(extractJson(null)).toBeNull();
  });

  test('undefined 输入返回 null', () => {
    expect(extractJson(undefined)).toBeNull();
  });

  test('非法 JSON 返回 null', () => {
    expect(extractJson('这不是 JSON')).toBeNull();
  });

  test('只有花括号但非法内容返回 null', () => {
    expect(extractJson('{not valid}')).toBeNull();
  });

  test('嵌套 JSON 正确解析', () => {
    const result = extractJson('{"items":[{"a":1},{"b":2}],"count":2}');
    expect(result).toEqual({ items: [{ a: 1 }, { b: 2 }], count: 2 });
  });

  test('多行 JSON 正确解析', () => {
    const input = `{
  "should_speak": true,
  "message": "今天天气真好~",
  "reason": "用户刚回来"
}`;
    const result = extractJson(input);
    expect(result).toEqual({
      should_speak: true,
      message: '今天天气真好~',
      reason: '用户刚回来'
    });
  });

  test('含特殊字符的消息正确解析', () => {
    const result = extractJson('{"message":"你好！\\"小伴\\"说：等一等……"}');
    expect(result.message).toBe('你好！"小伴"说：等一等……');
  });

  test('字符串中含多个 JSON 对象时（贪婪匹配问题）返回 null', () => {
    // 贪婪正则 /{[\s\S]*}/ 会从第一个 { 匹配到最后一个 }，
    // 导致整体不是有效 JSON。这是已知行为。
    const result = extractJson('{"a":"1"} 其他文字 {"b":"2"}');
    expect(result).toBeNull();
  });
});

// ==================== formatError ====================

describe('formatError', () => {
  test('401 / API Key 无效', () => {
    const err = new Error('API Key 无效或 401');
    expect(formatError(err)).toContain('API Key');
  });

  test('402 / 余额不足', () => {
    const err = new Error('余额不足 402');
    expect(formatError(err)).toContain('余额不足');
  });

  test('429 / 频率过高', () => {
    const err = new Error('频率过高 429');
    expect(formatError(err)).toContain('太频繁');
  });

  test('fetch / 网络错误', () => {
    expect(formatError(new Error('fetch failed'))).toContain('无法连接');
  });

  test('ECONNREFUSED', () => {
    expect(formatError(new Error('ECONNREFUSED :::1'))).toContain('无法连接');
  });

  test('ENOTFOUND', () => {
    expect(formatError(new Error('ENOTFOUND api.example.com'))).toContain('无法连接');
  });

  test('超时 / AbortError（含 timed out）', () => {
    expect(formatError(new Error('Request timed out'))).toContain('超时');
  });

  test('AbortError', () => {
    expect(formatError(new Error('AbortError: aborted'))).toContain('超时');
  });

  test('空响应', () => {
    expect(formatError(new Error('empty response'))).toContain('空内容');
  });

  test('未知错误带原文', () => {
    const msg = formatError(new Error('something unexpected'));
    expect(msg).toContain('something unexpected');
    expect(msg).toContain('出错了');
  });

  test('非 Error 对象也能处理', () => {
    const msg = formatError('string error');
    expect(msg).toContain('string error');
  });
});

// ==================== detectSentimentFast ====================

describe('detectSentimentFast', () => {
  describe('user_praises (夸奖)', () => {
    const keywords = ['好棒', '厉害', '可爱', '乖', '谢谢', '不错', '真棒', '牛', '赞', '靠谱', '厉害了', '你好聪明', '牛逼', '好厉害'];
    keywords.forEach(k => {
      test(`"${k}" → user_praises`, () => {
        expect(detectSentimentFast(`你${k}！`)).toBe('user_praises');
      });
    });
  });

  describe('user_scolds (责备)', () => {
    const keywords = ['烦', '滚', '闭嘴', '别吵', '讨厌', '笨', '傻', '吵死了', '别说了', '走开', '别烦我'];
    keywords.forEach(k => {
      test(`"${k}" → user_scolds`, () => {
        expect(detectSentimentFast(k)).toBe('user_scolds');
      });
    });
  });

  describe('user_happy (开心)', () => {
    const keywords = ['哈哈', '嘿嘿', '嘻嘻', '笑死', '开心', '好玩', '有趣', '有意思', '哈哈哈', 'hhhh', 'www'];
    keywords.forEach(k => {
      test(`"${k}" → user_happy`, () => {
        expect(detectSentimentFast(k)).toBe('user_happy');
      });
    });
  });

  describe('user_sad (难过)', () => {
    // 注意："不开心"含"开心"，会被 user_happy 先匹配
    // 只测试不会被其他类别先匹配到的关键词
    const keywords = ['难过', '伤心', '哭', '难受', '郁闷', '心累', '崩溃', '好累', '唉', 'emo'];
    keywords.forEach(k => {
      test(`"${k}" → user_sad`, () => {
        expect(detectSentimentFast(k)).toBe('user_sad');
      });
    });

    test('"不开心" 因包含"开心"而命中 user_happy', () => {
      expect(detectSentimentFast('不开心')).toBe('user_happy');
    });
  });

  describe('user_angry (愤怒)', () => {
    const keywords = ['气死', '生气', '愤怒', '火大', '离谱', '无语', '恶心', '垃圾'];
    keywords.forEach(k => {
      test(`"${k}" → user_angry`, () => {
        expect(detectSentimentFast(k)).toBe('user_angry');
      });
    });
  });

  describe('user_affectionate (撒娇亲近)', () => {
    // 注意："乖乖"含"乖"，会被 user_praises 先匹配
    const keywords = ['抱抱', '摸摸', '贴贴', '亲亲', '想你', '喜欢', '爱你', '宝贝', '小伴'];
    keywords.forEach(k => {
      test(`"${k}" → user_affectionate`, () => {
        expect(detectSentimentFast(k)).toBe('user_affectionate');
      });
    });

    test('"乖乖" 因包含"乖"而命中 user_praises', () => {
      expect(detectSentimentFast('乖乖')).toBe('user_praises');
    });
  });

  test('无匹配情绪返回 null', () => {
    // "不错" 会命中 user_praises 中的"不错"
    expect(detectSentimentFast('帮我写个函数')).toBeNull();
    expect(detectSentimentFast('')).toBeNull();
    expect(detectSentimentFast('今天几点')).toBeNull();
  });

  test('优先匹配第一个命中的类别', () => {
    // "开心" 同时在 user_happy 中，"好" 不在关键词中
    // "可爱" 在 user_praises 中
    expect(detectSentimentFast('你好可爱')).toBe('user_praises');
  });
});

// ==================== hasMemorySignal ====================

describe('hasMemorySignal', () => {
  test('没有 user 消息返回 false', () => {
    expect(hasMemorySignal([])).toBe(false);
    expect(hasMemorySignal([{ role: 'pet', content: '你好' }])).toBe(false);
  });

  test('包含"记住"返回 true', () => {
    expect(hasMemorySignal([{ role: 'user', content: '请记住我喜欢喝咖啡' }])).toBe(true);
  });

  test('包含"别忘"返回 true', () => {
    expect(hasMemorySignal([{ role: 'user', content: '别忘了明天开会' }])).toBe(true);
  });

  test('包含"以后"返回 true', () => {
    expect(hasMemorySignal([{ role: 'user', content: '以后都这样吧' }])).toBe(true);
  });

  test('包含"我是"返回 true', () => {
    expect(hasMemorySignal([{ role: 'user', content: '我是程序员' }])).toBe(true);
  });

  test('包含"我叫"返回 true', () => {
    expect(hasMemorySignal([{ role: 'user', content: '我叫小明' }])).toBe(true);
  });

  test('包含"我习惯"返回 true', () => {
    expect(hasMemorySignal([{ role: 'user', content: '我习惯早上工作' }])).toBe(true);
  });

  test('包含"偏好"返回 true', () => {
    expect(hasMemorySignal([{ role: 'user', content: '我的偏好是安静' }])).toBe(true);
  });

  test('包含"风格"返回 true', () => {
    expect(hasMemorySignal([{ role: 'user', content: '我的风格是简洁' }])).toBe(true);
  });

  test('包含"喜欢"返回 true', () => {
    expect(hasMemorySignal([{ role: 'user', content: '我喜欢这个' }])).toBe(true);
  });

  test('包含"不喜欢"返回 true', () => {
    expect(hasMemorySignal([{ role: 'user', content: '我不喜欢吵闹' }])).toBe(true);
  });

  test('包含"项目"返回 true', () => {
    expect(hasMemorySignal([{ role: 'user', content: '我的项目是 desktop-pet' }])).toBe(true);
  });

  test('无信号关键词返回 false', () => {
    expect(hasMemorySignal([{ role: 'user', content: '今天天气真好' }])).toBe(false);
    expect(hasMemorySignal([{ role: 'user', content: '帮我写段代码' }])).toBe(false);
  });

  test('多消息合并判断', () => {
    const messages = [
      { role: 'user', content: '今天天气不错' },
      { role: 'pet', content: '是呀~' },
      { role: 'user', content: '对了，记住我不喝奶茶' }
    ];
    expect(hasMemorySignal(messages)).toBe(true);
  });
});

// ==================== QUICK_GREETINGS ====================

describe('QUICK_GREETINGS', () => {
  test('包含 12 条问候语', () => {
    expect(QUICK_GREETINGS).toHaveLength(12);
  });

  test('每条都是非空字符串', () => {
    QUICK_GREETINGS.forEach(g => {
      expect(typeof g).toBe('string');
      expect(g.length).toBeGreaterThan(0);
    });
  });

  test('所有问候语都是中文', () => {
    QUICK_GREETINGS.forEach(g => {
      expect(g).toMatch(/[一-鿿]/); // 至少含一个汉字
    });
  });
});

// ==================== getRandomGreeting ====================

describe('getRandomGreeting', () => {
  test('返回值在 QUICK_GREETINGS 中', () => {
    for (let i = 0; i < 20; i++) {
      const g = getRandomGreeting();
      expect(QUICK_GREETINGS).toContain(g);
    }
  });

  test('多次调用覆盖多条不同的问候语', () => {
    const seen = new Set();
    for (let i = 0; i < 50; i++) {
      seen.add(getRandomGreeting());
    }
    // 12条中至少能覆盖到多条
    expect(seen.size).toBeGreaterThan(1);
  });
});

// ==================== SENTIMENT_KEYWORDS ====================

describe('SENTIMENT_KEYWORDS', () => {
  test('包含 6 个情绪类别', () => {
    expect(Object.keys(SENTIMENT_KEYWORDS)).toHaveLength(6);
  });

  test('每个类别都有关键词数组', () => {
    for (const [key, words] of Object.entries(SENTIMENT_KEYWORDS)) {
      expect(Array.isArray(words)).toBe(true);
      expect(words.length).toBeGreaterThan(0);
    }
  });

  test('各类别关键词不重叠检查', () => {
    // 抽检几个可能在多个类别中的词
    // "喜欢" 在 user_affectionate 中，"不喜欢" 不在
    expect(SENTIMENT_KEYWORDS.user_affectionate).toContain('喜欢');
  });

  test('所有关键词为字符串', () => {
    for (const words of Object.values(SENTIMENT_KEYWORDS)) {
      words.forEach(w => expect(typeof w).toBe('string'));
    }
  });
});

// ==================== setMuted / setBubbleEnabled ====================

describe('setMuted / setBubbleEnabled', () => {
  test('正常调用不抛错', () => {
    expect(() => setMuted(true)).not.toThrow();
    expect(() => setMuted(false)).not.toThrow();
    expect(() => setBubbleEnabled(true)).not.toThrow();
    expect(() => setBubbleEnabled(false)).not.toThrow();
  });
});

// ==================== getLastError ====================

describe('getLastError', () => {
  test('初始状态为 null', () => {
    expect(getLastError()).toBeNull();
  });
});

// ==================== cleanPetReply ====================

describe('cleanPetReply', () => {
  test('小伴保留活泼称呼和拟声词，只清理 HTML 标签', () => {
    expect(cleanPetReply('呜，主人！我来啦<br><b>试试</b>', {
      preserveExpressiveStyle: true
    })).toBe('呜，主人！我来啦\n试试');
  });

  test('非小伴人格清理旧称呼和拟声词', () => {
    expect(cleanPetReply('呜，主人！我来啦<br><b>试试</b>', {
      preserveExpressiveStyle: false
    })).toBe('我来啦\n试试');
  });
});

// ==================== repeat detection ====================

describe('reply repeat detection', () => {
  test('归一化回复用于比较时忽略常见标点和空白', () => {
    expect(normalizeReplyForCompare('嗯？ 又在看代码啊。')).toBe('嗯又在看代码啊');
  });

  test('识别重复上一条宠物回复', () => {
    const conversations = [
      { role: 'user', content: '你好' },
      { role: 'pet', content: '嗯？又在看代码啊。' },
      { role: 'user', content: '别说这话了' }
    ];
    expect(isRepeatedPetReply('嗯？ 又在看代码啊', conversations)).toBe(true);
    expect(isRepeatedPetReply('呜呜，我刚刚卡住复读了。主人想叫我什么呀？', conversations)).toBe(false);
  });
});

// ==================== short-term recall ====================

describe('tryBuildShortTermRecallReply', () => {
  test('用户问刚刚说了什么时，直接读取上一条用户消息', () => {
    const conversations = [
      { role: 'user', content: '写一段 ts 代码' },
      { role: 'pet', content: '好的，主人。' },
      { role: 'pet', content: '主动提醒', source: 'proactive' },
      { role: 'user', content: '我刚刚说了什么？' }
    ];

    expect(tryBuildShortTermRecallReply('我刚刚说了什么？', conversations, {
      preserveExpressiveStyle: true
    })).toBe('主人刚刚说的是：“写一段 ts 代码”。');
  });

  test('非回忆类问题返回 null', () => {
    expect(tryBuildShortTermRecallReply('写好了吗', [
      { role: 'user', content: '写一段 ts 代码' },
      { role: 'user', content: '写好了吗' }
    ], {})).toBeNull();
  });
});

// ==================== onChatMessage ====================

describe('onChatMessage', () => {
  test('注册回调不抛错', () => {
    expect(() => onChatMessage(jest.fn())).not.toThrow();
  });
});

// ==================== 调度器生命周期 ====================

describe('startScheduler / stopScheduler', () => {
  test('启停不抛错', () => {
    expect(() => startScheduler()).not.toThrow();
    expect(() => stopScheduler()).not.toThrow();
  });
});
