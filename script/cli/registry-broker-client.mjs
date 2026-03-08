export const ProfileType = Object.freeze({
  AI_AGENT: 1,
});

export const AIAgentType = Object.freeze({
  MANUAL: 0,
});

export const AIAgentCapability = Object.freeze({
  TEXT_GENERATION: 0,
  WORKFLOW_AUTOMATION: 18,
});

function normalizeBaseUrl(baseUrl) {
  return (baseUrl ?? 'https://hol.org/registry/api/v1').replace(/\/+$/, '');
}

function appendSearchParam(searchParams, key, value) {
  if (value === undefined || value === null) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      appendSearchParam(searchParams, key, item);
    }
    return;
  }
  if (typeof value === 'object') {
    searchParams.append(key, JSON.stringify(value));
    return;
  }
  searchParams.append(key, `${value}`);
}

async function parseJsonOrText(response) {
  const text = await response.text();
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractProgressRecord(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  if ('registration' in payload && payload.registration && typeof payload.registration === 'object') {
    return payload.registration;
  }
  if ('attemptId' in payload) {
    return payload;
  }
  return null;
}

export class RegistryBrokerClientError extends Error {
  constructor(message, { body = null, status } = {}) {
    super(message);
    this.name = 'RegistryBrokerClientError';
    this.body = body;
    this.status = status;
  }
}

export class RegistryBrokerClient {
  constructor({
    accountId,
    apiKey,
    baseUrl,
    fetchImplementation,
  } = {}) {
    this.accountId = accountId ?? null;
    this.apiKey = apiKey ?? null;
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.fetchImplementation = fetchImplementation ?? fetch;
  }

  getDefaultHeaders() {
    return {
      accept: 'application/json',
      ...(this.accountId ? { 'x-account-id': this.accountId } : {}),
      ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
    };
  }

  buildUrl(path, params) {
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    if (params && typeof params === 'object') {
      for (const [key, value] of Object.entries(params)) {
        appendSearchParam(url.searchParams, key, value);
      }
    }
    return url.toString();
  }

  async requestJson(path, {
    body,
    headers,
    method = 'GET',
    params,
  } = {}) {
    const response = await this.fetchImplementation(this.buildUrl(path, params), {
      method,
      headers: {
        ...this.getDefaultHeaders(),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(headers ?? {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await parseJsonOrText(response);
    if (!response.ok) {
      const message = payload && typeof payload === 'object' && 'message' in payload
        ? `${payload.message}`
        : `Registry Broker request failed with status ${response.status}`;
      throw new RegistryBrokerClientError(message, {
        body: payload,
        status: response.status,
      });
    }
    return payload;
  }

  async search(params = {}) {
    return this.requestJson('/search', { params });
  }

  async getAdditionalRegistries() {
    return this.requestJson('/register/additional-registries');
  }

  async registerAgent(payload) {
    return this.requestJson('/register', {
      body: payload,
      method: 'POST',
    });
  }

  async getRegistrationProgress(attemptId) {
    try {
      const payload = await this.requestJson(`/register/progress/${encodeURIComponent(attemptId)}`);
      return extractProgressRecord(payload);
    } catch (error) {
      if (error instanceof RegistryBrokerClientError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async waitForRegistrationCompletion(attemptId, {
    intervalMs = 2000,
    onProgress,
    throwOnFailure = true,
    timeoutMs = 120000,
  } = {}) {
    const startedAt = Date.now();
    while (Date.now() - startedAt <= timeoutMs) {
      const progress = await this.getRegistrationProgress(attemptId);
      if (progress) {
        onProgress?.(progress);
        if (progress.status === 'completed') {
          return progress;
        }
        if (progress.status === 'partial' || progress.status === 'failed') {
          if (throwOnFailure) {
            throw new RegistryBrokerClientError(
              `Registry Broker registration ${attemptId} ended with status ${progress.status}.`,
              { body: progress },
            );
          }
          return progress;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new RegistryBrokerClientError(
      `Registry Broker registration ${attemptId} did not complete within ${timeoutMs}ms.`,
    );
  }
}
