/**
 * deepseek.js 单元测试 — API 客户端
 *
 * 测试：buildHeaders、checkStatus、MODEL、API_BASE、PROVIDER_NAME
 */

// 保存原始环境变量
const originalEnv = { ...process.env };

beforeEach(() => {
  // 清理相关环境变量
  delete process.env.AI_API_KEY;
  delete process.env.AI_BASE_URL;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_BASE_URL;
  delete process.env.DASHSCOPE_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.AI_PROVIDER;
  delete process.env.AI_MODEL;

  // 清除模块缓存，让环境变量变化生效
  jest.resetModules();
});

afterAll(() => {
  // 恢复环境变量
  Object.assign(process.env, originalEnv);
});

function loadModule() {
  return require('../electron/deepseek');
}

// ==================== 常量 ====================

describe('MODEL / API_BASE / PROVIDER_NAME', () => {
  test('默认 model 为 qwen-turbo', () => {
    const { MODEL } = loadModule();
    expect(MODEL).toBe('qwen-turbo');
  });

  test('可通过 AI_MODEL 环境变量覆盖', () => {
    process.env.AI_MODEL = 'gpt-4';
    const { MODEL } = loadModule();
    expect(MODEL).toBe('gpt-4');
  });

  test('默认 API_BASE 为阿里百炼官方 OpenAI 兼容地址', () => {
    const { API_BASE } = loadModule();
    expect(API_BASE).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
  });

  test('可通过 DEEPSEEK_BASE_URL 覆盖', () => {
    process.env.DEEPSEEK_BASE_URL = 'https://custom.api.com';
    const { API_BASE } = loadModule();
    expect(API_BASE).toBe('https://custom.api.com');
  });

  test('可通过 AI_BASE_URL 覆盖', () => {
    process.env.AI_BASE_URL = 'https://ai.api.com';
    const { API_BASE } = loadModule();
    expect(API_BASE).toBe('https://ai.api.com');
  });

  test('AI_BASE_URL 优先级高于 DEEPSEEK_BASE_URL', () => {
    process.env.AI_BASE_URL = 'https://ai.api.com';
    process.env.DEEPSEEK_BASE_URL = 'https://deepseek.api.com';
    const { API_BASE } = loadModule();
    expect(API_BASE).toBe('https://ai.api.com');
  });

  test('API_BASE 去除尾部斜杠', () => {
    process.env.AI_BASE_URL = 'https://api.test.com/';
    const { API_BASE } = loadModule();
    expect(API_BASE).toBe('https://api.test.com');
  });

  test('默认 PROVIDER_NAME 为阿里百炼', () => {
    const { PROVIDER_NAME } = loadModule();
    expect(PROVIDER_NAME).toBe('阿里百炼');
  });

  test('OpenRouter URL 自动识别提供者名称', () => {
    process.env.AI_BASE_URL = 'https://openrouter.ai/api/v1';
    const { PROVIDER_NAME } = loadModule();
    expect(PROVIDER_NAME).toBe('OpenRouter');
  });

  test('AI_PROVIDER 环境变量覆盖', () => {
    process.env.AI_PROVIDER = 'CustomAI';
    const { PROVIDER_NAME } = loadModule();
    expect(PROVIDER_NAME).toBe('CustomAI');
  });
});

// ==================== buildHeaders ====================

describe('buildHeaders', () => {
  test('标准请求头包含 Authorization 和 Content-Type', () => {
    process.env.DASHSCOPE_API_KEY = 'sk-test-key-123';
    const { buildHeaders } = loadModule();
    const headers = buildHeaders();
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Authorization']).toBe('Bearer sk-test-key-123');
  });

  test('AI_API_KEY 环境变量优先级最高', () => {
    process.env.AI_API_KEY = 'sk-ai-key';
    process.env.DEEPSEEK_API_KEY = 'sk-deepseek-key';
    const { buildHeaders } = loadModule();
    const headers = buildHeaders();
    expect(headers['Authorization']).toBe('Bearer sk-ai-key');
  });

  test('DASHSCOPE_API_KEY 作为百炼 Key 回退', () => {
    process.env.DASHSCOPE_API_KEY = 'sk-dashscope-key';
    const { buildHeaders } = loadModule();
    const headers = buildHeaders();
    expect(headers['Authorization']).toBe('Bearer sk-dashscope-key');
  });

  test('OPENROUTER_API_KEY 作为回退', () => {
    process.env.OPENROUTER_API_KEY = 'sk-openrouter-key';
    const { buildHeaders } = loadModule();
    const headers = buildHeaders();
    expect(headers['Authorization']).toBe('Bearer sk-openrouter-key');
  });

  test('OpenRouter 包含额外头部', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-key';
    process.env.AI_BASE_URL = 'https://openrouter.ai/api/v1';
    const { buildHeaders } = loadModule();
    const headers = buildHeaders();
    expect(headers['HTTP-Referer']).toBeDefined();
    expect(headers['X-Title']).toBe('Desktop Pet');
  });

  test('未配置 API Key 时返回空 Bearer token', () => {
    const { buildHeaders } = loadModule();
    const headers = buildHeaders();
    expect(headers['Authorization']).toBe('Bearer ');
  });
});

// ==================== buildApiUrl ====================

describe('buildApiUrl', () => {
  test('默认百炼 base URL 已含 /v1 时不重复拼接', () => {
    const { buildApiUrl } = loadModule();
    expect(buildApiUrl('/chat/completions')).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
  });

  test('旧式 base URL 不含 /v1 时自动补齐', () => {
    process.env.AI_BASE_URL = 'https://openrouter.ai/api';
    const { buildApiUrl } = loadModule();
    expect(buildApiUrl('/chat/completions')).toBe('https://openrouter.ai/api/v1/chat/completions');
  });
});

// ==================== applyProviderOptions ====================

describe('applyProviderOptions', () => {
  test('默认百炼请求显式关闭思考模式', () => {
    const { applyProviderOptions } = loadModule();
    expect(applyProviderOptions({ model: 'qwen-turbo' })).toMatchObject({
      model: 'qwen-turbo',
      enable_thinking: false
    });
  });

  test('非百炼兼容端点不追加百炼专属参数', () => {
    process.env.AI_BASE_URL = 'https://openrouter.ai/api/v1';
    const { applyProviderOptions } = loadModule();
    expect(applyProviderOptions({ model: 'openai/gpt-oss-20b:free' })).toEqual({
      model: 'openai/gpt-oss-20b:free'
    });
  });
});

// ==================== callDeepseek ====================

describe('callDeepseek', () => {
  test('发送百炼聊天请求时包含 enable_thinking false', async () => {
    process.env.DASHSCOPE_API_KEY = 'sk-test-key';
    const { callDeepseek } = loadModule();

    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          choices: [{ message: { content: '好的' } }]
        })
      })
    );

    await expect(callDeepseek('你好')).resolves.toBe('好的');
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.enable_thinking).toBe(false);
    expect(body.model).toBe('qwen-turbo');
  });
});

// ==================== checkStatus ====================

describe('checkStatus', () => {
  test('未配置 API Key 返回错误', async () => {
    // 确保所有 key 都为空
    delete process.env.AI_API_KEY;
    delete process.env.DASHSCOPE_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    const { checkStatus } = loadModule();
    const result = await checkStatus();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('未配置');
  });

  test('sk-your-key 占位符也被视为未配置', async () => {
    process.env.DASHSCOPE_API_KEY = 'sk-your-key-here';
    const { checkStatus } = loadModule();
    const result = await checkStatus();
    expect(result.ok).toBe(false);
  });

  test('配置了有效格式的 Key 时尝试连接', async () => {
    process.env.DASHSCOPE_API_KEY = 'sk-real-looking-key-1234567890';
    const { checkStatus } = loadModule();

    // Mock fetch
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [] })
      })
    );

    const result = await checkStatus();
    expect(result.ok).toBe(true);
    expect(result.provider).toBeDefined();
    expect(result.model).toBeDefined();
  });

  test('API 返回 401 时报告 Key 无效', async () => {
    process.env.DASHSCOPE_API_KEY = 'sk-invalid-key';
    const { checkStatus } = loadModule();

    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false,
        status: 401
      })
    );

    const result = await checkStatus();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('无效');
  });

  test('网络错误时报告连接失败', async () => {
    process.env.DASHSCOPE_API_KEY = 'sk-test-key';
    const { checkStatus } = loadModule();

    global.fetch = jest.fn(() => Promise.reject(new Error('Network error')));

    const result = await checkStatus();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('无法连接');
  });

  test('API 返回其他状态码', async () => {
    process.env.DASHSCOPE_API_KEY = 'sk-test-key';
    const { checkStatus } = loadModule();

    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500
      })
    );

    const result = await checkStatus();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('500');
  });
});
