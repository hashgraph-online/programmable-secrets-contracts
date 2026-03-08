import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AIAgentCapability,
  AIAgentType,
  ProfileType,
  RegistryBrokerClient,
} from '../script/cli/registry-broker-client.mjs';

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
      return Response.json({ hits: [] });
    },
  });

  const result = await client.search({
    limit: 25,
    q: '0x1234',
    registry: 'erc-8004',
  });

  assert.deepEqual(result, { hits: [] });
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    'https://hol.org/registry/api/v1/search?limit=25&q=0x1234&registry=erc-8004',
  );
  assert.equal(requests[0].init.method, 'GET');
  assert.equal(requests[0].init.headers.accept, 'application/json');
  assert.equal(requests[0].init.headers['x-account-id'], '0xabc');
  assert.equal(requests[0].init.headers['x-api-key'], 'secret');
});

test('waitForRegistrationCompletion returns the completed record', async () => {
  let attempts = 0;
  const client = new RegistryBrokerClient({
    baseUrl: 'https://hol.org/registry/api/v1',
    fetchImplementation: async () => {
      attempts += 1;
      return Response.json({
        registration: {
          attemptId: 'attempt-1',
          mode: 'register',
          status: attempts > 1 ? 'completed' : 'pending',
          registryNamespace: 'hcs-11',
          startedAt: new Date().toISOString(),
          primary: { status: 'created' },
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
        registration: {
          attemptId: 'attempt-2',
          mode: 'register',
          status: 'partial',
          registryNamespace: 'hcs-11',
          startedAt: new Date().toISOString(),
          primary: { status: 'created' },
          additionalRegistries: {},
        },
      }),
  });

  await assert.rejects(
    client.waitForRegistrationCompletion('attempt-2', {
      intervalMs: 1,
      timeoutMs: 100,
    }),
    /partial/i,
  );
});
