const OLLAMA_BASE = 'http://localhost:11434';
const MODEL = 'qwen3:4b-instruct';
const TIMEOUT = 30000;

async function callOllama(prompt, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const body = {
      model: MODEL,
      prompt,
      stream: false,
      enable_thinking: false,
      options: {
        temperature: options.temperature ?? 0.7,
        num_predict: options.maxTokens ?? 150
      }
    };

    if (options.format === 'json') {
      body.format = 'json';
    }

    const response = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const text = (data.response || '').trim();

    if (!text) {
      throw new Error('Ollama returned empty response');
    }

    return text;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Streaming version of callOllama - calls onToken for each piece of text received.
 * Returns the full assembled response.
 */
async function callOllamaStream(prompt, options = {}, onToken) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const body = {
      model: MODEL,
      prompt,
      stream: true,
      enable_thinking: false,
      options: {
        temperature: options.temperature ?? 0.7,
        num_predict: options.maxTokens ?? 150
      }
    };

    const response = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
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
        if (!trimmed) continue;

        try {
          const parsed = JSON.parse(trimmed);
          const token = parsed.response || '';
          if (token) {
            fullResponse += token;
            onToken(token, fullResponse);
          }
          if (parsed.done) break;
        } catch {
          // skip unparseable lines
        }
      }
    }

    const result = fullResponse.trim();
    if (!result) {
      throw new Error('Ollama returned empty response');
    }

    return result;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Check if Ollama is running and the model is available
 */
async function checkStatus() {
  try {
    const response = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return { ok: false, error: 'Ollama not running' };

    const data = await response.json();
    const models = data.models || [];
    const hasModel = models.some(m => m.name.startsWith(MODEL.split(':')[0]));

    if (!hasModel) {
      return {
        ok: false,
        error: `Model ${MODEL} not found. Run: ollama pull ${MODEL}`,
        availableModels: models.map(m => m.name)
      };
    }

    return { ok: true, model: MODEL };
  } catch (err) {
    return { ok: false, error: `Cannot connect to Ollama: ${err.message}` };
  }
}

module.exports = { callOllama, callOllamaStream, checkStatus, MODEL };
