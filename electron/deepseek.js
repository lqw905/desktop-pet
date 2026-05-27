const fs = require('fs');
const path = require('path');

const DEFAULT_API_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_MODEL = 'qwen-turbo';
const TIMEOUT = 30000;
const SYSTEM_PROMPT = '你是桌面宠物应用中的当前人格助手。严格遵循用户消息中的人格、语气和回复规则，用中文回复。';

const API_PRESETS = [
  {
    id: 'aliyun-bailian',
    name: '阿里百炼',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-turbo',
    streamEnabled: true,
    enableThinking: false
  },
  {
    id: 'aliyun-bailian-plus',
    name: '阿里百炼 Plus',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    streamEnabled: true,
    enableThinking: false
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    streamEnabled: true,
    enableThinking: false
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-oss-20b:free',
    streamEnabled: true,
    enableThinking: false
  },
  {
    id: 'custom',
    name: '自定义兼容 API',
    baseUrl: DEFAULT_API_BASE,
    model: DEFAULT_MODEL,
    streamEnabled: true,
    enableThinking: false
  }
];

function getProviderName(apiBase) {
  if (apiBase.includes('openrouter.ai')) return 'OpenRouter';
  if (apiBase.includes('dashscope.aliyuncs.com')) return '阿里百炼';
  if (apiBase.includes('deepseek.com')) return 'DeepSeek';
  return 'AI';
}

function stripTrailingSlash(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function getEnvApiKey() {
  return process.env.AI_API_KEY ||
    process.env.DASHSCOPE_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    '';
}

function getEnvConfig() {
  const baseUrl = stripTrailingSlash(process.env.AI_BASE_URL || process.env.DEEPSEEK_BASE_URL || DEFAULT_API_BASE);
  return {
    provider: inferProviderId(baseUrl),
    providerName: process.env.AI_PROVIDER || getProviderName(baseUrl),
    baseUrl,
    model: process.env.AI_MODEL || DEFAULT_MODEL,
    apiKey: getEnvApiKey(),
    streamEnabled: process.env.AI_STREAM_ENABLED !== 'false' && process.env.AI_STREAM_ENABLED !== '0',
    enableThinking: process.env.AI_ENABLE_THINKING === 'true' || process.env.AI_ENABLE_THINKING === '1'
  };
}

function inferProviderId(baseUrl) {
  if (baseUrl.includes('openrouter.ai')) return 'openrouter';
  if (baseUrl.includes('dashscope.aliyuncs.com')) return 'aliyun-bailian';
  if (baseUrl.includes('deepseek.com')) return 'deepseek';
  return 'custom';
}

function getPreset(provider) {
  return API_PRESETS.find(preset => preset.id === provider) || API_PRESETS[0];
}

function getApiConfigPath() {
  if (process.env.DESKTOP_PET_API_CONFIG_PATH) {
    return process.env.DESKTOP_PET_API_CONFIG_PATH;
  }

  try {
    const { app } = require('electron');
    if (app?.getPath) {
      return path.join(app.getPath('userData'), 'api-config.json');
    }
  } catch {}

  return null;
}

function readSavedApiConfig() {
  const configPath = getApiConfigPath();
  if (!configPath || !fs.existsSync(configPath)) return {};

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeSavedApiStore(config) {
  const configPath = getApiConfigPath();
  if (!configPath) {
    throw new Error('当前环境无法保存 API 配置');
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function createApiProfileId() {
  return `api_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function normalizeApiConfig(input = {}, fallback = getEnvConfig(), options = {}) {
  const provider = input.provider || fallback.provider || inferProviderId(input.baseUrl || fallback.baseUrl || DEFAULT_API_BASE);
  const preset = getPreset(provider);
  const baseUrl = stripTrailingSlash(input.baseUrl || fallback.baseUrl || preset.baseUrl);
  const hasInputKey = typeof input.apiKey === 'string' && input.apiKey.trim().length > 0;
  const apiKey = hasInputKey
    ? input.apiKey.trim()
    : options.keepBlankApiKey ? '' : (fallback.apiKey || getEnvApiKey());

  return {
    provider,
    id: input.id || fallback.id || null,
    name: String(input.name || fallback.name || input.profileName || fallback.profileName || input.providerName || fallback.providerName || 'API 配置').trim(),
    providerName: input.providerName || fallback.providerName || preset.name || getProviderName(baseUrl),
    baseUrl,
    model: String(input.model || fallback.model || preset.model || DEFAULT_MODEL).trim(),
    apiKey,
    streamEnabled: input.streamEnabled === undefined ? fallback.streamEnabled !== false : input.streamEnabled !== false,
    enableThinking: input.enableThinking === undefined ? !!fallback.enableThinking : input.enableThinking === true
  };
}

function looksLikeLegacyConfig(saved = {}) {
  return !!(saved.baseUrl || saved.model || saved.apiKey || saved.provider);
}

function normalizeApiProfile(input = {}, fallback = getEnvConfig()) {
  const config = normalizeApiConfig(input, fallback);
  return {
    id: input.id || createApiProfileId(),
    name: String(input.name || input.profileName || config.providerName || 'API 配置').trim().slice(0, 40),
    provider: config.provider,
    providerName: config.providerName,
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: config.apiKey || '',
    streamEnabled: config.streamEnabled,
    enableThinking: config.enableThinking,
    created_at: input.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

function readApiStore() {
  const saved = readSavedApiConfig();
  const profiles = Array.isArray(saved.profiles)
    ? saved.profiles.map(profile => normalizeApiProfile(profile)).filter(Boolean)
    : looksLikeLegacyConfig(saved)
      ? [normalizeApiProfile({
          ...saved,
          id: saved.id || 'api_default',
          name: saved.name || saved.providerName || '默认 API'
        })]
      : [];

  const currentProfileId = profiles.some(profile => profile.id === saved.currentProfileId)
    ? saved.currentProfileId
    : profiles[0]?.id || null;

  return {
    version: 2,
    currentProfileId,
    profiles
  };
}

function writeApiStore(store) {
  writeSavedApiStore({
    version: 2,
    currentProfileId: store.currentProfileId || null,
    profiles: Array.isArray(store.profiles) ? store.profiles : [],
    updated_at: new Date().toISOString()
  });
}

function getApiConfig() {
  const envConfig = getEnvConfig();
  const store = readApiStore();
  const currentProfile = store.profiles.find(profile => profile.id === store.currentProfileId);
  return currentProfile ? normalizeApiConfig(currentProfile, envConfig) : envConfig;
}

function getPublicApiConfig() {
  const config = getApiConfig();
  const store = readApiStore();
  return {
    currentProfileId: store.currentProfileId,
    provider: config.provider,
    profileName: config.name || config.providerName,
    providerName: config.providerName,
    baseUrl: config.baseUrl,
    model: config.model,
    streamEnabled: config.streamEnabled,
    enableThinking: config.enableThinking,
    apiKeyConfigured: !!config.apiKey && !config.apiKey.startsWith('sk-your-key'),
    apiKeyHint: maskApiKey(config.apiKey),
    profiles: getApiProfiles()
  };
}

function getApiPresets() {
  return API_PRESETS.map(({ id, name, baseUrl, model, streamEnabled, enableThinking }) => ({
    id,
    name,
    baseUrl,
    model,
    streamEnabled,
    enableThinking
  }));
}

function maskApiKey(apiKey) {
  if (!apiKey) return '';
  if (apiKey.startsWith('sk-your-key')) return '';
  if (apiKey.length <= 8) return '已配置';
  return `...${apiKey.slice(-4)}`;
}

function toPublicApiProfile(profile) {
  return {
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    providerName: profile.providerName,
    baseUrl: profile.baseUrl,
    model: profile.model,
    streamEnabled: profile.streamEnabled,
    enableThinking: profile.enableThinking,
    apiKeyConfigured: !!profile.apiKey && !profile.apiKey.startsWith('sk-your-key'),
    apiKeyHint: maskApiKey(profile.apiKey)
  };
}

function getApiProfiles() {
  return readApiStore().profiles.map(toPublicApiProfile);
}

function saveApiConfig(input = {}) {
  const store = readApiStore();
  const currentProfile = input.createNew ? null : input.profileId
    ? store.profiles.find(profile => profile.id === input.profileId)
    : store.profiles.find(profile => profile.id === store.currentProfileId);
  const current = normalizeApiConfig(currentProfile || {}, getEnvConfig());
  const shouldKeepExistingKey = !String(input.apiKey || '').trim();
  const storedApiKey = shouldKeepExistingKey ? (currentProfile?.apiKey || '') : input.apiKey;
  const profile = normalizeApiProfile({
    ...currentProfile,
    ...input,
    id: input.profileId || currentProfile?.id || input.id || createApiProfileId(),
    name: input.profileName || input.name || currentProfile?.name || input.providerName,
    apiKey: storedApiKey
  }, current);

  if (!storedApiKey) {
    profile.apiKey = '';
  }

  const index = store.profiles.findIndex(item => item.id === profile.id);
  if (index >= 0) {
    store.profiles[index] = {
      ...store.profiles[index],
      ...profile,
      created_at: store.profiles[index].created_at || profile.created_at
    };
  } else {
    store.profiles.push(profile);
  }

  store.currentProfileId = profile.id;
  writeApiStore(store);

  return getPublicApiConfig();
}

function setApiProfile(profileId) {
  const store = readApiStore();
  if (!store.profiles.some(profile => profile.id === profileId)) {
    throw new Error('API 配置不存在');
  }
  store.currentProfileId = profileId;
  writeApiStore(store);
  return getPublicApiConfig();
}

function deleteApiProfile(profileId) {
  const store = readApiStore();
  const before = store.profiles.length;
  store.profiles = store.profiles.filter(profile => profile.id !== profileId);
  if (store.currentProfileId === profileId) {
    store.currentProfileId = store.profiles[0]?.id || null;
  }
  writeApiStore(store);
  return {
    ok: store.profiles.length !== before,
    apiConfig: getPublicApiConfig()
  };
}

function buildTestConfig(input = {}) {
  const store = readApiStore();
  const selected = input.profileId
    ? store.profiles.find(profile => profile.id === input.profileId)
    : store.profiles.find(profile => profile.id === store.currentProfileId);
  const shouldKeepExistingKey = !String(input.apiKey || '').trim();
  return normalizeApiConfig({
    ...selected,
    ...input,
    apiKey: shouldKeepExistingKey ? selected?.apiKey : input.apiKey
  }, selected || getApiConfig(), {
    keepBlankApiKey: !selected?.apiKey
  });
}

function buildApiUrl(pathname, config = getApiConfig()) {
  const pathPart = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const baseUrl = stripTrailingSlash(config.baseUrl);
  if (baseUrl.endsWith('/v1')) return `${baseUrl}${pathPart}`;
  return `${baseUrl}/v1${pathPart}`;
}

function shouldDisableThinking(config = getApiConfig()) {
  return config.baseUrl.includes('dashscope.aliyuncs.com') && config.enableThinking !== true;
}

function applyProviderOptions(body, config = getApiConfig()) {
  if (config.baseUrl.includes('dashscope.aliyuncs.com')) {
    body.enable_thinking = !shouldDisableThinking(config);
  }
  return body;
}

function buildHeaders(config = getApiConfig()) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey || ''}`
  };

  if (config.baseUrl.includes('openrouter.ai')) {
    headers['HTTP-Referer'] = 'http://localhost/desktop-pet';
    headers['X-Title'] = 'Desktop Pet';
  }

  return headers;
}

function buildErrorMessage(response, errorText, config) {
  let errMsg = `${config.providerName} API error: ${response.status}`;
  if (response.status === 401) errMsg = `${config.providerName} API Key 无效，请检查配置`;
  else if (response.status === 402) errMsg = `${config.providerName} 账户余额不足或免费额度不可用`;
  else if (response.status === 429) errMsg = `${config.providerName} API 请求频率过高，请稍后重试`;
  else if (errorText) {
    try {
      const errJson = JSON.parse(errorText);
      errMsg = errJson.error?.message || errMsg;
    } catch {}
  }
  return errMsg;
}

async function requestChatCompletion(prompt, options = {}, stream, onToken, config = getApiConfig()) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const body = applyProviderOptions({
      model: config.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      stream,
      max_tokens: options.maxTokens ?? 150,
      temperature: options.temperature ?? 0.7
    }, config);

    if (options.format === 'json') {
      body.response_format = { type: 'json_object' };
    }

    if (stream) {
      body.stream_options = { include_usage: false };
    }

    const response = await fetch(buildApiUrl('/chat/completions', config), {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(buildErrorMessage(response, errText, config));
    }

    if (!stream) {
      const data = await response.json();
      const text = (data.choices?.[0]?.message?.content || '').trim();
      if (!text) throw new Error(`${config.providerName} returned empty response`);
      return text;
    }

    const text = await readStreamResponse(response, onToken);
    if (!text) throw new Error(`${config.providerName} returned empty response`);
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

async function readStreamResponse(response, onToken) {
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

  return fullResponse.trim();
}

/**
 * Call OpenAI-compatible API (non-streaming).
 * Accepts a plain text prompt and wraps it in chat messages format internally.
 */
async function callDeepseek(prompt, options = {}) {
  return requestChatCompletion(prompt, options, false, null);
}

/**
 * Streaming version of callDeepseek.
 * Calls onToken(deltaText, fullText) for each chunk.
 */
async function callDeepseekStream(prompt, options = {}, onToken) {
  const config = getApiConfig();
  if (config.streamEnabled === false) {
    const text = await requestChatCompletion(prompt, options, false, null, config);
    onToken?.(text, text);
    return text;
  }
  return requestChatCompletion(prompt, options, true, onToken, config);
}

async function testApiConfig(input = {}) {
  const config = buildTestConfig(input);
  return checkStatus(config);
}

/**
 * Check if the API key is configured and the endpoint is reachable.
 */
async function checkStatus(config = getApiConfig()) {
  if (!config.apiKey || config.apiKey.startsWith('sk-your-key')) {
    return { ok: false, error: `${config.providerName} API Key 未配置，请在控制台或 .env 中设置 AI_API_KEY` };
  }

  try {
    const response = await fetch(buildApiUrl('/models', config), {
      headers: buildHeaders(config),
      signal: AbortSignal.timeout(10000)
    });

    if (response.ok) {
      return { ok: true, provider: config.providerName, model: config.model };
    }

    if (response.status === 401) {
      return { ok: false, error: 'API Key 无效' };
    }

    return { ok: false, error: `${config.providerName} API 状态异常 (${response.status})` };
  } catch (err) {
    return { ok: false, error: `无法连接到 ${config.providerName} API: ${err.message}` };
  }
}

const initialConfig = getApiConfig();

module.exports = {
  callDeepseek,
  callDeepseekStream,
  checkStatus,
  testApiConfig,
  getApiConfig,
  getPublicApiConfig,
  getApiProfiles,
  getApiPresets,
  saveApiConfig,
  setApiProfile,
  deleteApiProfile,
  normalizeApiConfig,
  MODEL: initialConfig.model,
  API_BASE: initialConfig.baseUrl,
  PROVIDER_NAME: initialConfig.providerName,
  buildHeaders,
  buildApiUrl,
  applyProviderOptions
};
