import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AIAgentCapability,
  AIAgentType,
  ProfileType,
  RegistryBrokerClient,
} from '@hashgraphonline/standards-sdk';

test('broker profile constants match the broker contract expectations', () => {
  assert.equal(ProfileType.AI_AGENT, 1);
  assert.equal(AIAgentType.MANUAL, 0);
  assert.equal(AIAgentCapability.TEXT_GENERATION, 0);
  assert.equal(AIAgentCapability.WORKFLOW_AUTOMATION, 18);
});

test('search forwards headers and query params to the broker', async () => {
  const requests = [];
  const client = new RegistryBrokerClient({
    accountId: '0xabc',
    apiKey: 'secret',
    baseUrl: 'https://hol.org/registry/api/v1/',
    fetchImplementation: async (url, init) => {
      requests.push({ url, init });
      return Response.json({ hits: [], total: 0, page: 1, limit: 25 });
    },
  });

  const result = await client.search({
    limit: 25,
    q: '0x1234',
    registry: 'erc-8004',
  });

  assert.deepEqual(result, { hits: [], total: 0, page: 1, limit: 25 });
  assert.equal(requests.length, 1);
  const requestUrl = new URL(requests[0].url);
  assert.equal(requestUrl.origin, 'https://hol.org');
  assert.equal(requestUrl.pathname, '/registry/api/v1/search');
  assert.equal(requestUrl.searchParams.get('limit'), '25');
  assert.equal(requestUrl.searchParams.get('q'), '0x1234');
  assert.equal(requestUrl.searchParams.get('registry'), 'erc-8004');
  assert.equal(requests[0].init.method, 'GET');
  const headers = new Headers(requests[0].init.headers);
  assert.equal(headers.get('accept'), 'application/json');
  assert.equal(headers.get('x-account-id'), '0xabc');
  assert.equal(headers.get('x-api-key'), 'secret');
});

test('waitForRegistrationCompletion returns the completed record', async () => {
  let attempts = 0;
  const client = new RegistryBrokerClient({
    baseUrl: 'https://hol.org/registry/api/v1',
    fetchImplementation: async () => {
      attempts += 1;
      return Response.json({
        progress: {
          attemptId: 'attempt-1',
          mode: 'register',
          status: attempts > 1 ? 'completed' : 'pending',
          registryNamespace: 'hcs-11',
          startedAt: new Date().toISOString(),
          primary: { status: attempts > 1 ? 'completed' : 'pending' },
          additionalRegistries: {},
        },
      });
    },
  });

  const result = await client.waitForRegistrationCompletion('attempt-1', {
    intervalMs: 1,
    timeoutMs: 100,
  });

  assert.equal(result.status, 'completed');
  assert.equal(attempts, 2);
});

test('waitForRegistrationCompletion throws when the broker reports a partial result', async () => {
  const client = new RegistryBrokerClient({
    baseUrl: 'https://hol.org/registry/api/v1',
    fetchImplementation: async () =>
      Response.json({
        progress: {
          attemptId: 'attempt-2',
          mode: 'register',
          status: 'partial',
          registryNamespace: 'hcs-11',
          startedAt: new Date().toISOString(),
          primary: { status: 'completed' },
          additionalRegistries: {},
        },
      }),
  });

  await assert.rejects(
    client.waitForRegistrationCompletion('attempt-2', {
      intervalMs: 1,
      timeoutMs: 100,
    }),
    /did not complete successfully/i,
  );
});
