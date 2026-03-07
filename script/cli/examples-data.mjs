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
  'custom-eth-balance-policy': {
    description: 'Deploy, register, and sell a policy backed by a custom evaluator that requires the buyer wallet to hold more than 0.1 ETH.',
    roles: {
      provider: {
        name: 'Provider',
        wallet: 'provider',
      },
      buyer: {
        name: 'Buyer',
        wallet: 'agent',
      },
    },
    steps: [
      {
        title: 'Deploy the custom evaluator contract',
        commands: [
          'forge create src/EthBalanceCondition.sol:EthBalanceCondition --rpc-url $RPC_URL --private-key $ETH_PK_2',
        ],
      },
      {
        title: 'Register the evaluator in PolicyVault and pay the 0.05 ETH registration fee',
        commands: [
          'cast send $POLICY_VAULT "registerPolicyEvaluator(address,bytes32)" $EVALUATOR_ADDRESS $(cast keccak "eth-balance-threshold-v1") --value 0.05ether --rpc-url $RPC_URL --private-key $ETH_PK_2',
        ],
      },
      {
        title: 'Create the encrypted dataset bundle and register the dataset',
        commands: [
          `${CLI_COMMAND} krs encrypt --plaintext-file ./examples/two-agent-sale/agent-a-signal.json --title "ETH balance gated signal" --provider-uaid did:uaid:hol:balance-provider --output ./examples/custom-evaluators/eth-balance-bundle.json`,
          `${CLI_COMMAND} datasets register --wallet provider --bundle-file ./examples/custom-evaluators/eth-balance-bundle.json`,
        ],
      },
      {
        title: 'Encode the evaluator threshold and import the custom policy',
        commands: [
          'export CONFIG_DATA=$(cast abi-encode "f(uint256)" 100000000000000000)',
          'jq --arg evaluator "$EVALUATOR_ADDRESS" --arg config "$CONFIG_DATA" --argjson datasetId <dataset-id> \'.policy.datasetId = $datasetId | .policy.conditions[0].evaluator = $evaluator | .policy.conditions[0].configData = $config\' ./examples/custom-evaluators/eth-balance-policy.template.json > /tmp/eth-balance-policy.json',
          `${CLI_COMMAND} policies import --wallet provider --file /tmp/eth-balance-policy.json`,
        ],
      },
      {
        title: 'Buyer purchases the policy and proves the receipt',
        commands: [
          `${CLI_COMMAND} purchase --policy-id <policy-id> --wallet agent`,
          `${CLI_COMMAND} receipts get --receipt-id <receipt-id>`,
          `${CLI_COMMAND} krs verify --bundle-file ./examples/custom-evaluators/eth-balance-bundle.json --policy-id <policy-id> --receipt-id <receipt-id> --buyer <buyer-wallet>`,
        ],
      },
    ],
  },
};
