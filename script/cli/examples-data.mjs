import { CLI_COMMAND } from './constants.mjs';

export const EXAMPLE_REGISTRY = {
  'two-agent-sale': {
    description: 'Agent A publishes an encrypted dataset policy and Agent B buys, verifies, and decrypts the bundle.',
    roles: {
      provider: {
        name: 'Agent A',
        wallet: 'provider',
      },
      buyer: {
        name: 'Agent B',
        wallet: 'agent',
      },
    },
    steps: [
      {
        title: 'Agent A encrypts the payload bundle locally',
        commands: [
          `${CLI_COMMAND} krs encrypt --plaintext-file ./examples/two-agent-sale/agent-a-signal.json --title "Agent A premium signal" --provider-uaid did:uaid:hol:agent-a --output ./examples/two-agent-sale/agent-a-bundle.json`,
        ],
      },
      {
        title: 'Agent A registers the dataset using the bundle hashes',
        commands: [
          `${CLI_COMMAND} datasets register --wallet provider --bundle-file ./examples/two-agent-sale/agent-a-bundle.json`,
        ],
      },
      {
        title: 'Agent A creates the sell-side policy',
        commands: [
          `${CLI_COMMAND} policies create-timebound --wallet provider --dataset-id <dataset-id> --price-eth 0.00001 --duration-hours 24 --metadata-json '{"title":"24 hour unlock"}'`,
        ],
      },
      {
        title: 'Agent B purchases the policy',
        commands: [
          `${CLI_COMMAND} purchase --policy-id <policy-id> --wallet agent`,
          `${CLI_COMMAND} receipts get --receipt-id <receipt-id>`,
        ],
      },
      {
        title: 'Agent B verifies the bundle matches the purchased receipt and decrypts it',
        commands: [
          `${CLI_COMMAND} krs verify --bundle-file ./examples/two-agent-sale/agent-a-bundle.json --receipt-id <receipt-id> --policy-id <policy-id> --buyer <buyer-wallet>`,
          `${CLI_COMMAND} krs decrypt --bundle-file ./examples/two-agent-sale/agent-a-bundle.json --output ./examples/two-agent-sale/agent-b-plaintext.json`,
        ],
      },
    ],
  },
};
