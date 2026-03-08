# Programmable Secrets Contracts

Install-free operator CLI on npm:

```bash
npx programmable-secret help
```

Programmable Secrets is a receipt-backed entitlement protocol for finance-agent workflows.
Providers commit encrypted market data, issuer materials, research, or private tool access onchain.
Buyers satisfy a dataset policy in the shared vault, mint an access receipt, and then request the buyer-bound key envelope from the offchain key release service.

This package is the contract source of truth for:
- `PolicyVault`
- `PaymentModule`
- `AccessReceipt`
- built-in policy evaluator modules
- example custom policy evaluator modules
- external `IdentityRegistry` integration for UAID-gated policies
- deployment automation
- checked-in ABIs
- testnet deployment manifests

## Architecture

| Contract | Responsibility |
| --- | --- |
| `PolicyVault` | Shared registry for provider-owned datasets plus attached policies. Each policy stores a list of registered policy evaluator modules and immutable condition config bytes. |
| `PaymentModule` | Validates purchase conditions by calling each evaluator registered on the selected policy, settles native ETH, mints the access receipt, and resolves active entitlement state. |
| `AccessReceipt` | ERC-721 entitlement proving a buyer satisfied a specific dataset policy. Transferability is fixed per policy at mint time. |
| `TimeRangeCondition` | Built-in policy evaluator that enforces `notBefore` / `notAfter` purchase windows. |
| `UaidOwnershipCondition` | Built-in policy evaluator that enforces ERC-8004 wallet ownership plus exact buyer UAID match. |
| `AddressAllowlistCondition` | Built-in policy evaluator that enforces a provider-supplied wallet allowlist. |
| external `IdentityRegistry` | ERC-8004 registry address referenced by `UaidOwnershipCondition` to prove wallet ownership of a target HCS-14 UAID-native agent onchain. |

The intended app entrypoints are:
- dataset registration and policy creation through `PolicyVault`
- purchase through `PaymentModule`
- proof checks through `AccessReceipt` or `PaymentModule.receiptOfPolicyAndBuyer`
- custom policy module registration through `PolicyVault.registerPolicyEvaluator`

## Target Networks

| Network | Chain ID | RPC | Explorer |
| --- | ---: | --- | --- |
| Robinhood Chain Testnet | `46630` | `https://rpc.testnet.chain.robinhood.com/rpc` | `https://explorer.testnet.chain.robinhood.com` |
| Arbitrum Sepolia | `421614` | `https://sepolia-rollup.arbitrum.io/rpc` | `https://sepolia.arbiscan.io` |

Robinhood testnet is the primary operator target.
Arbitrum Sepolia is maintained as a secondary testnet deployment target.

## Current Deployments

Canonical app-facing addresses are tracked in:
- `deployments/robinhood-testnet.json`
- `deployments/arbitrum-sepolia.json`

Current deployed addresses:

| Network | PolicyVault | PaymentModule | AccessReceipt | IdentityRegistry |
| --- | --- | --- | --- | --- |
| Robinhood Chain Testnet | `0x54c40c2863dB7eE2563C65CF83F5cc295e73bd6c` | `0xbff7f7671044Ae1C965C9D7d9050cBa3Da72356c` | `0x902c70193Fc36Ad1d115DcB0310C3F49fC4F5e7a` | `0x0000000000000000000000000000000000000000` |
| Arbitrum Sepolia | `0x76160A8F1bFEd994749318Bee9611A51bcDA80e8` | `0xE39Ae07F6226156d97C76B4ec6ac8697890Dd350` | `0x2032c2572838b4B746072e8e542BDEE324BEA0C8` | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |

Built-in policy evaluators are also deployed and recorded in each manifest:
- `TimeRangeCondition`
- `UaidOwnershipCondition`
- `AddressAllowlistCondition`

The contract repo should always treat these manifest files as the deployment source of truth.

## Contract Surface

### PolicyVault

Primary functions:
- `initialize(address initialOwner)`
- `registerPolicyEvaluator(address evaluator, bytes32 metadataHash)` payable
- `registerBuiltInEvaluator(address evaluator, bytes32 metadataHash)` owner-only
- `setPolicyEvaluatorActive(address evaluator, bool active)` owner-only
- `setEvaluatorRegistrationFee(uint256 newFee)` owner-only
- `setEvaluatorFeeRecipient(address newFeeRecipient)` owner-only
- `registerDataset(bytes32 ciphertextHash, bytes32 keyCommitment, bytes32 metadataHash, bytes32 providerUaidHash)`
- `setDatasetActive(uint256 datasetId, bool active)`
- `createPolicyForDataset(uint256 datasetId, address payout, address paymentToken, uint96 price, bool receiptTransferable, bytes32 metadataHash, PolicyConditionInput[] conditions)`
- `updatePolicy(uint256 policyId, uint96 newPrice, bool active, bytes32 newMetadataHash)`
- `getDataset(uint256 datasetId)`
- `getDatasetPolicyCount(uint256 datasetId)`
- `getDatasetPolicyIdAt(uint256 datasetId, uint256 index)`
- `getDatasetPolicyIds(uint256 datasetId)`
- `getPolicy(uint256 policyId)`
- `getPolicyConditionCount(uint256 policyId)`
- `getPolicyCondition(uint256 policyId, uint256 index)`
- `getPolicyEvaluator(address evaluator)`
- `datasetCount()`
- `policyCount()`

Events:
- `PolicyEvaluatorRegistered`
- `PolicyEvaluatorStatusUpdated`
- `PolicyEvaluatorFeeUpdated`
- `PolicyEvaluatorFeeRecipientUpdated`
- `DatasetRegistered`
- `DatasetStatusUpdated`
- `PolicyCreated`
- `PolicyUpdated`

### PaymentModule

Primary functions:
- `initialize(address initialOwner, address policyVaultAddress, address accessReceiptAddress)`
- `purchase(uint256 policyId, address recipient, bytes[] conditionRuntimeInputs)`
- `hasAccess(uint256 policyId, address buyer)`
- `hasDatasetAccess(uint256 datasetId, address buyer)`
- `receiptOfPolicyAndBuyer(uint256 policyId, address buyer)`
- `setPolicyVault(address policyVaultAddress)`
- `setAccessReceipt(address accessReceiptAddress)`

Events:
- `AccessGranted`
- `PolicyVaultUpdated`
- `AccessReceiptUpdated`

### AccessReceipt

Primary functions:
- `constructor(address initialOwner)`
- `setPaymentModule(address newPaymentModule)`
- `mintReceipt(address buyer, address recipient, uint256 policyId, uint256 datasetId, address paymentToken, uint96 price, uint64 purchasedAt, bool receiptTransferable, bytes32 ciphertextHash, bytes32 keyCommitment)`
- `hasAccess(uint256 policyId, address buyer)`
- `receiptOfPolicyAndBuyer(uint256 policyId, address buyer)`
- `getReceipt(uint256 receiptTokenId)`

Events:
- `ReceiptMinted`
- `PaymentModuleUpdated`

## Semantics

- Datasets are first-class registry entries. A provider registers an encrypted dataset once, then attaches one or more policies to it.
- Policies are explorable onchain through `datasetCount`, `policyCount`, `getDataset`, `getPolicy`, `getDatasetPolicyCount`, `getDatasetPolicyIdAt`, and `getDatasetPolicyIds`.
- Native ETH only in the current green path. Policies with a non-zero `paymentToken` revert.
- `PolicyVault` is a shared registry, not a per-provider custom vault factory.
- A policy is generic: it stores an ordered list of evaluator contracts plus opaque `configData` for each condition.
- Each evaluator must be registered before providers can attach it to a policy.
- Public evaluator registration costs `0.05 ETH` by default and pays that fee to `evaluatorFeeRecipient`.
- Built-in evaluator registration is owner-only and fee-free.
- `PaymentModule.purchase` loops over the selected policy’s stored evaluator list and passes the caller-supplied `conditionRuntimeInputs[index]` to each evaluator.
- `PolicyVault` owns dataset and policy metadata plus provider-controlled mutability.
- `PaymentModule` is the only contract allowed to mint receipts.
- One wallet can hold at most one active receipt per policy and per dataset.
- Receipt transferability is decided when the policy is created and is immutable for receipts minted from that policy.
- Non-transferable receipts stay buyer-bound.
- Transferable receipts move active access with the token and cannot be transferred to a wallet that already has access to the same dataset.
- Every receipt token resolves to the same metadata URI: `ipfs://bafkreibw3osbcrk7w522tcjuz5a4ihffd3bfbjkwmfso5esxyfml2cfal4`.
- Condition modules own their own validation rules. For example, `TimeRangeCondition` treats `notAfter == block.timestamp` as expired.
- UAID-bound purchases pass the exact buyer UAID string in the runtime input consumed by `UaidOwnershipCondition`.
- Evaluators are enforced at purchase time. `PaymentModule.hasAccess` and `hasDatasetAccess` resolve durable entitlement by checking receipt existence plus current policy and dataset active state.
- Time range conditions govern whether a purchase can happen, not a post-purchase streaming lease. A provider can still deactivate the dataset or policy to revoke active access resolution.
- `AccessReceipt` remains the durable historical proof of purchase, while `PaymentModule.hasDatasetAccess` resolves whether any currently active policy on a dataset still maps to the buyer's receipt.
- Allowlist enforcement is onchain through `AddressAllowlistCondition`.
- Offchain key release should validate both the signed buyer request and current onchain access state.
- Older deployments may not expose evaluator index helper reads (`getPolicyEvaluatorCount`, `getPolicyEvaluatorAt`). The CLI falls back to manifest discovery when those helpers are unavailable.

## Built-In Policy Modules

The default deployment registers three built-ins:

| Module | Config type | Runtime input |
| --- | --- | --- |
| `TimeRangeCondition` | `TimeRangeConfig { notBefore, notAfter }` | empty bytes |
| `UaidOwnershipCondition` | `UaidOwnershipConfig { requiredBuyerUaidHash, identityRegistry, agentId }` | ABI-encoded buyer UAID string |
| `AddressAllowlistCondition` | ABI-encoded `address[]` | empty bytes |

Custom modules can implement `IPolicyCondition` and register themselves through `registerPolicyEvaluator(...)` after paying the fee.

When creating a policy, set `receiptTransferable = true` only if you want the ERC-721 itself to carry the live entitlement between wallets.
For most data-sales flows, leave it `false` so access stays tied to the original buyer.

### Custom Evaluator Example: ETH Balance > 0.1 ETH

The repo includes a concrete custom module at `src/EthBalanceCondition.sol`.
It enforces a single rule: the buyer wallet must hold at least the configured `minimumBalanceWei` at purchase time.

End-to-end operator flow:

1. Deploy the evaluator:

```bash
forge create src/EthBalanceCondition.sol:EthBalanceCondition \
  --rpc-url $RPC_URL \
  --private-key $ETH_PK_2
```

2. Register it in `PolicyVault` and pay the public `0.05 ETH` evaluator fee:

```bash
cast send $POLICY_VAULT \
  "registerPolicyEvaluator(address,bytes32)" \
  $EVALUATOR_ADDRESS \
  $(cast keccak "eth-balance-threshold-v1") \
  --value 0.05ether \
  --rpc-url $RPC_URL \
  --private-key $ETH_PK_2
```

3. Create the encrypted dataset bundle and register the dataset through the CLI:

```bash
programmable-secret krs encrypt \
  --plaintext-file ./examples/two-agent-sale/agent-a-signal.json \
  --title "ETH balance gated signal" \
  --provider-uaid did:uaid:hol:balance-provider \
  --output ./examples/custom-evaluators/eth-balance-bundle.json

programmable-secret datasets register \
  --wallet provider \
  --bundle-file ./examples/custom-evaluators/eth-balance-bundle.json
```

4. Encode the threshold config (`0.1 ETH`) and import the custom policy from the checked-in template:

```bash
export CONFIG_DATA=$(cast abi-encode "f(uint256)" 100000000000000000)

jq --arg evaluator "$EVALUATOR_ADDRESS" \
   --arg config "$CONFIG_DATA" \
   --argjson datasetId <dataset-id> \
   '.policy.datasetId = $datasetId
    | .policy.conditions[0].evaluator = $evaluator
    | .policy.conditions[0].configData = $config' \
   ./examples/custom-evaluators/eth-balance-policy.template.json \
   > /tmp/eth-balance-policy.json

programmable-secret policies import \
  --wallet provider \
  --file /tmp/eth-balance-policy.json
```

To make that policy transferable, set `"receiptTransferable": true` in the imported JSON or pass `--receipt-transferable true` when using `policies create-timebound` or `policies create-uaid`.

5. Buyer purchases and proves the unlock:

```bash
programmable-secret purchase --policy-id <policy-id> --wallet agent
programmable-secret receipts get --receipt-id <receipt-id>
programmable-secret krs verify \
  --bundle-file ./examples/custom-evaluators/eth-balance-bundle.json \
  --policy-id <policy-id> \
  --receipt-id <receipt-id> \
  --buyer <buyer-wallet>
```

Proof in this repo:
- `test/ProgrammableSecretsCustomEvaluator.t.sol` proves evaluator registration works
- it proves a buyer above the threshold can purchase successfully
- it proves a buyer below the threshold reverts with `PolicyConditionFailed(0)`
- it proves zero-threshold configs are rejected

## Upgrade Model

- `PolicyVault` is deployed behind `ERC1967Proxy` using UUPS.
- `PaymentModule` is deployed behind `ERC1967Proxy` using UUPS.
- `AccessReceipt` is currently a direct deployment, not a proxy.

Operational guidance:
- Treat proxy addresses as canonical app-facing addresses for `PolicyVault` and `PaymentModule`.
- `AccessReceipt` is app-facing directly at its deployed address.
- The deploy script initializes proxies with the deployer first, wires `AccessReceipt` to the deployed `PaymentModule`, and optionally starts ownership handoff to `CONTRACT_OWNER`.

## Local Verification

Run the full contract suite:

```bash
forge fmt --check
forge lint
forge build --sizes --skip script
forge test -vvv
```

Regenerate checked-in ABIs:

```bash
forge inspect --json AccessReceipt abi > abis/AccessReceipt.abi.json
forge inspect --json AddressAllowlistCondition abi > abis/AddressAllowlistCondition.abi.json
forge inspect --json EthBalanceCondition abi > abis/EthBalanceCondition.abi.json
forge inspect --json PaymentModule abi > abis/PaymentModule.abi.json
forge inspect --json PolicyVault abi > abis/PolicyVault.abi.json
forge inspect --json TimeRangeCondition abi > abis/TimeRangeCondition.abi.json
forge inspect --json UaidOwnershipCondition abi > abis/UaidOwnershipCondition.abi.json
```

## CLI Workflows

The contracts repo now ships a modular CLI under `script/cli/` with a thin entrypoint at `script/manage-policies.mjs`.
The live workflow commands are:
- `flow:direct` runs the default Robinhood marketplace path: dataset registration, timebound policy creation, purchase, and local unlock verification
- `flow:uaid` runs the direct onchain ERC-8004 path on a chain with a live `IdentityRegistry`
- `flow:broker` registers through the local Registry Broker with `RegistryBrokerClient`, then proves the same UAID-gated purchase flow against the selected live `IdentityRegistry`

The CLI also ships a concrete two-agent walkthrough:

```bash
programmable-secret examples show --name two-agent-sale
```

That example uses the checked-in fixture at `examples/two-agent-sale/agent-a-signal.json` and demonstrates:
- Agent A encrypting and packaging the dataset bundle with `krs encrypt`
- Agent A registering the dataset directly from the bundle via `datasets register --bundle-file ...`
- Agent A creating a sell-side policy
- Agent B purchasing the policy and reading the minted receipt
- Agent B verifying and decrypting the bundle locally

There is also a custom evaluator walkthrough:

```bash
programmable-secret examples show --name custom-eth-balance-policy
```

The package also exposes a first-class binary:

```bash
programmable-secret <command>
```

Compatibility alias:

```bash
programmable-secrets <command>
```

Inside this repo, the equivalent local wrapper is:

```bash
pnpm run cli -- <command>
```

Primary install-free entrypoint from npm:

```bash
npx programmable-secret help
```

Release automation:

- GitHub release tags must match the package version, for example `v0.2.0`
- `.github/workflows/publish-cli.yml` validates the package, smoke-tests the tarball, and publishes to npm with provenance
- manual dry-runs are available through the `Publish CLI Package` workflow dispatch

Install the single Node dependency:

```bash
pnpm install
```

Create a local env file:

```bash
cp .env.example .env
```

Required environment variables in `.env`:
- `ETH_PK` for the agent wallet that will register the ERC-8004 identity and purchase access
- `ETH_PK_2` for the provider wallet that will register the dataset and create the gated policy

Show the available commands:

```bash
pnpm run help
npx programmable-secret help
```

Start with the guided entrypoint:

```bash
programmable-secret init
programmable-secret start
```

Check readiness before a live run:

```bash
programmable-secret doctor
```

If wallet or broker keys are missing, bootstrap a local env file from the running Docker broker:

```bash
programmable-secret env-bootstrap
```

This writes `.env.local` when it does not already exist and pulls common workflow keys from `registry-broker-registry-broker-1` when available.
Set `PROGRAMMABLE_SECRETS_ENV_OUTPUT_PATH` if you want to generate a different file.

Run the direct identity flow:

```bash
programmable-secret flow:direct
```

What the direct flow does on the selected live ERC-8004 network:
1. registers a new agent in the external ERC-8004 `IdentityRegistry`
2. registers a dataset in `PolicyVault`
3. creates a UAID-gated policy that only that registered agent can unlock
4. purchases the policy from the registered agent wallet through `PaymentModule`
5. reads back the minted `AccessReceipt`
6. decrypts the locally prepared payload to prove the unlock path completed

Run the Registry Broker-backed flow:

```bash
programmable-secret flow:broker
```

What the broker-backed flow does:
1. starts a local agent endpoint with the `standards-sdk`
2. registers that agent in the local Registry Broker with `RegistryBrokerClient`
3. links the agent into the selected live ERC-8004 registry and receives a real UAID
4. registers a dataset in `PolicyVault`
5. creates a UAID-gated policy that only that broker-issued UAID can unlock
6. purchases the policy, reads back the minted `AccessReceipt`, and decrypts the prepared payload

Optional overrides:
- `PROGRAMMABLE_SECRETS_NETWORK`
- `PROGRAMMABLE_SECRETS_AGENT_URI`
- `PROGRAMMABLE_SECRETS_BUYER_UAID`
- `PROGRAMMABLE_SECRETS_PROVIDER_UAID`
- `PROGRAMMABLE_SECRETS_PRICE_WEI`
- `PROGRAMMABLE_SECRETS_EXPIRES_AT_UNIX`
- `REGISTRY_BROKER_BASE_URL`
- `REGISTRY_BROKER_API_KEY`
- `REGISTRY_BROKER_ACCOUNT_ID`
- `REGISTRY_BROKER_ERC8004_NETWORK`

`flow:direct` defaults to Robinhood testnet.
`flow:uaid` and `flow:broker` should target Arbitrum Sepolia unless your selected network manifest has a live `IdentityRegistry`.

If you want to point at a different env file, set `PROGRAMMABLE_SECRETS_ENV_PATH` before running the command.

Global operator flags:

- `--json` for machine-readable output
- `--preview` or `preview <command>` to inspect state-changing calls before sending them
- `--interactive` to prompt for missing required options
- `--profile <name>` to load a named operator profile
- `--agent-safe` to enable JSON-first, quiet, non-interactive execution defaults

## Contract Commands

The CLI now covers the full operator surface around the deployed contracts.

Read-only commands:

```bash
programmable-secret contracts
programmable-secret contracts --agent-safe
programmable-secret help --json
programmable-secret policies evaluators
programmable-secret datasets list
programmable-secret datasets get --dataset-id 1
programmable-secret datasets export --dataset-id 1 --output dataset-1.json
programmable-secret policies list
programmable-secret policies get --policy-id 1
programmable-secret policies export --policy-id 1 --output policy-1.json
programmable-secret access policy --policy-id 1 --buyer 0x...
programmable-secret access dataset --dataset-id 1 --buyer 0x...
programmable-secret receipts get --receipt-id 1
```

Write commands:

```bash
programmable-secret identity register --agent-uri https://hol.org/agents/volatility-trading-agent-custodian
programmable-secret datasets register --provider-uaid "did:uaid:hol:quantlab?uid=quantlab&registry=hol&proto=hol&nativeId=quantlab" --metadata-json '{"title":"TSLA feed"}' --ciphertext "encrypted payload" --key-material "wrapped key"
programmable-secret datasets import --file dataset-1.json
programmable-secret datasets set-active --dataset-id 1 --active false
programmable-secret policies create-timebound --dataset-id 1 --price-eth 0.00001 --duration-hours 24 --metadata-json '{"title":"24 hour access"}'
programmable-secret policies create-uaid --dataset-id 1 --price-eth 0.00001 --duration-hours 24 --required-buyer-uaid uaid:aid:... --agent-id 97
programmable-secret policies import --file policy-1.json
programmable-secret policies update --policy-id 1 --price-eth 0.00002 --active true --metadata-json '{"title":"Updated access"}'
programmable-secret purchase --policy-id 1
```

`policies allowlist` is intentionally immutable in the evaluator-array model. Recreate the policy with a new allowlist config and deactivate the prior policy.

The CLI accepts either direct hashes or operator-friendly raw inputs for dataset registration:
- `--ciphertext-hash` or `--ciphertext`
- `--key-commitment` or `--key-material`
- `--metadata-hash`, `--metadata-json`, `--metadata-file`, or `--metadata`
- `--provider-uaid-hash` or `--provider-uaid`

Wallet selection:
- provider-facing write commands default to `ETH_PK_2`
- agent-facing commands default to `ETH_PK`
- override with `--wallet provider` or `--wallet agent`

## Profiles, Templates, and Completions

Bootstrap a local config with named profiles:

```bash
programmable-secret init
programmable-secret profiles list
programmable-secret profiles show --profile robinhood-agent
```

Use built-in templates to scaffold finance-agent flows:

```bash
programmable-secret templates list
programmable-secret templates show --name finance-timebound-dataset
programmable-secret templates write --name finance-uaid-policy --output finance-uaid-policy.json
```

Generate shell completions:

```bash
programmable-secret completions zsh --output ~/.zsh/completions/_programmable-secret
programmable-secret completions bash
programmable-secret completions fish
```

## Local KRS Helpers

The CLI now includes local bundle tooling for operator previews and end-to-end verification:

```bash
programmable-secret krs encrypt --plaintext '{"signal":"buy","market":"TSLA"}' --output bundle.json
programmable-secret krs verify --bundle-file bundle.json --policy-id 1 --buyer 0x...
programmable-secret krs decrypt --bundle-file bundle.json
```

These commands are local-only helpers. They are meant for operator testing, payload preparation, and buyer-side verification, not for production secret custody.

## Deployment

Required environment variables for `script/Deploy.s.sol`:
- `ETH_PK`
- `DEPLOYER_ADDRESS`
- `CONTRACT_OWNER`

Example deploy command:

```bash
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://rpc.testnet.chain.robinhood.com/rpc \
  --broadcast -vvv
```

The GitHub workflow `.github/workflows/deploy-arbitrum-sepolia.yml` performs the same deployment flow for both supported testnets and writes a structured manifest to:
- `deployments/robinhood-testnet.json`
- `deployments/arbitrum-sepolia.json`

Each manifest is expected to record:
- `contracts.policyVault.proxyAddress`
- `contracts.policyVault.implementationAddress`
- `contracts.paymentModule.proxyAddress`
- `contracts.paymentModule.implementationAddress`
- `contracts.accessReceipt.address`
- `entrypoints.policyVaultAddress`
- `entrypoints.paymentModuleAddress`
- `entrypoints.accessReceiptAddress`

### Deterministic Same-Address Deployment

The current checked-in manifests reflect live deployments and may not match across Robinhood Chain Testnet and Arbitrum Sepolia.
If you need deterministic same-address deployment, use the CREATE2 path below and redeploy both networks in lockstep.

If you need to reproduce the same deployment pattern on a fresh environment, use the CREATE2-based deployment path:
- keep `DEPLOYER_ADDRESS` and `CONTRACT_OWNER` identical on both networks
- keep the CREATE2 salts identical on both networks
- run Foundry with the standard CREATE2 deployer at `0x4e59b44847b379578588920cA78FbF26c0B4956C`

Recommended command shape:

```bash
forge script script/Deploy.s.sol:DeployCreate2 \
  --rpc-url https://rpc.testnet.chain.robinhood.com/rpc \
  --broadcast \
  --always-use-create-2-factory \
  --create2-deployer 0x4e59b44847b379578588920cA78FbF26c0B4956C \
  -vvv
```

Default salts are baked into the deploy script:
- `programmable-secrets-policy-vault-implementation-v1`
- `programmable-secrets-policy-vault-proxy-v1`
- `programmable-secrets-payment-module-implementation-v1`
- `programmable-secrets-payment-module-proxy-v1`
- `programmable-secrets-access-receipt-v1`

Because Robinhood Chain Testnet and Arbitrum Sepolia both expose the standard `0x4e59...956C` CREATE2 deployer, deterministic redeployment to matching addresses is feasible. The manifests should only be updated after both networks are redeployed in CREATE2 mode.

## ABI Files

Checked-in app-facing ABIs:
- `abis/PolicyVault.abi.json`
- `abis/PaymentModule.abi.json`
- `abis/AccessReceipt.abi.json`

These are the files the broker and portal should consume for code generation, client reads, and transaction encoding.

## Subgraph

This repo now includes a Graph subgraph package at `subgraph/`.
It indexes:
- `PolicyVault`
- `PaymentModule`
- `AccessReceipt`

Network manifests are generated directly from the deployment source of truth:
- `deployments/robinhood-testnet.json` (default)
- `deployments/arbitrum-sepolia.json` (optional)

Build locally:

```bash
pnpm --dir subgraph install
pnpm --dir subgraph run build
```

Generated manifests:
- `subgraph/subgraph.robinhood-testnet.yaml`
- `subgraph/subgraph.arbitrum-sepolia.yaml`

See `subgraph/README.md` for deployment commands and entity coverage.

## GitHub Automation

Workflows:
- `Foundry CI`
- `Solidity Security`
- `Deploy EVM Testnet`

Required deployment environment secrets:
- `ARBITRUM_SEPOLIA_RPC_URL`
- `ROBINHOOD_TESTNET_RPC_URL`
- `DEPLOYER_PRIVATE_KEY` or `ETH_PK`
- `ETHERSCAN_API_KEY` or `ARBISCAN_API_KEY` for Arbitrum native verification

## Integration Notes

Broker and portal integrations should treat:
- `PolicyVault` as the provider commit surface
- `PaymentModule` as the settlement surface
- `AccessReceipt` as the portable proof surface

Do not integrate against the historical single-contract paywall model from earlier POC iterations.
