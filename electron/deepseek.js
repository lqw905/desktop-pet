const API_BASE = (process.env.AI_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
const MODEL = process.env.AI_MODEL || 'deepseek-chat';
const TIMEOUT = 30000;

// 从环境变量读取 API Key，也可直接替换字符串
const API_KEY = process.env.AI_API_KEY || process.env.OPENROUTER_API_KEY || process.env.DEEPSEEK_API_KEY || '';
const PROVIDER_NAME = process.env.AI_PROVIDER || (API_BASE.includes('openrouter.ai') ? 'OpenRouter' : 'DeepSeek');

function buildHeaders() {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${API_KEY}`
  };

  if (API_BASE.includes('openrouter.ai')) {
    headers['HTTP-Referer'] = 'http://localhost/desktop-pet';
    headers['X-Title'] = 'Desktop Pet';
  }

  return headers;
}

/**
 * Call DeepSeek API (non-streaming).
 * Accepts a plain text prompt and wraps it in chat messages format internally.
 */
async function callDeepseek(prompt, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const body = {
      model: MODEL,
      messages: [
        { role: 'system', content: '你是一个可爱的桌面宠物，名字叫"小伴"。用中文回复，简短温暖。' },
        { role: 'user', content: prompt }
      ],
      stream: false,
      max_tokens: options.maxTokens ?? 150,
      temperature: options.temperature ?? 0.7
    };

    if (options.format === 'json') {
      body.response_format = { type: 'json_object' };
    }

    const response = await fetch(`${API_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      let errMsg = `${PROVIDER_NAME} API error: ${response.status}`;
      if (response.status === 401) errMsg = `${PROVIDER_NAME} API Key 无效，请检查配置`;
      else if (response.status === 402) errMsg = `${PROVIDER_NAME} 账户余额不足或免费额度不可用`;
      else if (response.status === 429) errMsg = `${PROVIDER_NAME} API 请求频率过高，请稍后重试`;
      else if (errText) {
        try {
          const errJson = JSON.parse(errText);
          errMsg = errJson.error?.message || errMsg;
        } catch {}
      }
      throw new Error(errMsg);
    }

    const data = await response.json();
    const text = (data.choices?.[0]?.message?.content || '').trim();

    if (!text) {
      throw new Error(`${PROVIDER_NAME} returned empty response`);
    }

    return text;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Streaming version of callDeepseek.
 * Calls onToken(deltaText, fullText) for each chunk.
 */
async function callDeepseekStream(prompt, options = {}, onToken) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const body = {
      model: MODEL,
      messages: [
        { role: 'system', content: '你是一个可爱的桌面宠物，名字叫"小伴"。用中文回复，简短温暖。' },
        { role: 'user', content: prompt }
      ],
      stream: true,
      max_tokens: options.maxTokens ?? 150,
      temperature: options.temperature ?? 0.7,
      stream_options: { include_usage: false }
    };

    const response = await fetch(`${API_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      let errMsg = `${PROVIDER_NAME} API error: ${response.status}`;
      if (response.status === 401) errMsg = `${PROVIDER_NAME} API Key 无效，请检查配置`;
      else if (response.status === 402) errMsg = `${PROVIDER_NAME} 账户余额不足或免费额度不可用`;
      else if (response.status === 429) errMsg = `${PROVIDER_NAME} API 请求频率过高，请稍后重试`;
      else if (errText) {
        try {
          const errJson = JSON.parse(errText);
          errMsg = errJson.error?.message || errMsg;
        } catch {}
      }
      throw new Error(errMsg);
    }

    let fullResponse = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const dataStr = trimmed.slice(6);
        if (dataStr === '[DONE]') break;

        try {
          const parsed = JSON.parse(dataStr);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullResponse += delta;
            onToken(delta, fullResponse);
          }
        } catch {
          // skip unparseable lines
        }
      }
    }

    const result = fullResponse.trim();
    if (!result) {
      throw new Error(`${PROVIDER_NAME} returned empty response`);
    }

    return result;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Check if the API key is configured (simple validation).
 */
async function checkStatus() {
  if (!API_KEY || API_KEY.startsWith('sk-your-key')) {
    return { ok: false, error: `${PROVIDER_NAME} API Key 未配置，请在 .env 中设置 AI_API_KEY` };
  }

  try {
    const response = await fetch(`${API_BASE}/v1/models`, {
      headers: buildHeaders(),
      signal: AbortSignal.timeout(10000)
    });

    if (response.ok) {
      return { ok: true, provider: PROVIDER_NAME, model: MODEL };
    }

    if (response.status === 401) {
      return { ok: false, error: 'API Key 无效' };
    }

    return { ok: false, error: `${PROVIDER_NAME} API 状态异常 (${response.status})` };
  } catch (err) {
    return { ok: false, error: `无法连接到 ${PROVIDER_NAME} API: ${err.message}` };
  }
}

module.exports = { callDeepseek, callDeepseekStream, checkStatus, MODEL, API_BASE, PROVIDER_NAME };
