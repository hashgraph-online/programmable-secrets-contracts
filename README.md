# Programmable Secrets Contracts

Install-free operator CLI on npm:

```bash
npx programmable-secret help
```

Programmable Secrets is a receipt-backed entitlement protocol for finance-agent workflows.
Providers commit encrypted market data, issuer materials, research, or private tool access onchain.
Buyers satisfy an onchain policy, mint a non-transferable access receipt, and then request the buyer-bound key envelope from the offchain key release service.

This package is the contract source of truth for:
- `PolicyVault`
- `PaymentModule`
- `AccessReceipt`
- external `IdentityRegistry` integration for UAID-gated policies
- deployment automation
- checked-in ABIs
- testnet deployment manifests

## Architecture

| Contract | Responsibility |
| --- | --- |
| `PolicyVault` | Stores provider-owned datasets plus attached policy records, including dataset discovery indexes and supported policy types. |
| `PaymentModule` | Validates purchase conditions, settles native ETH, mints the access receipt, and resolves active entitlement state for policies or datasets. |
| `AccessReceipt` | Non-transferable ERC-721 entitlement proving a buyer satisfied a specific dataset policy. |
| external `IdentityRegistry` | ERC-8004 registry address referenced by UAID-gated policies to prove wallet ownership of a target HCS-14 UAID-native agent onchain. |

The intended app entrypoints are:
- dataset registration and policy creation through `PolicyVault`
- purchase through `PaymentModule`
- proof checks through `AccessReceipt` or `PaymentModule.receiptOfPolicyAndBuyer`

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
| Robinhood Chain Testnet | `0xBd4E7A50e6c61Eb7dAA6c7485df88054E5b4796D` | `0x24c6212B2673b85B71CFB3A7a767Ff691ea7D7A2` | `0x849575C669e9fA3944880c77E8c77b5c1dE58c8D` | `0x0000000000000000000000000000000000000000` |
| Arbitrum Sepolia | `0xBd4E7A50e6c61Eb7dAA6c7485df88054E5b4796D` | `0x24c6212B2673b85B71CFB3A7a767Ff691ea7D7A2` | `0x849575C669e9fA3944880c77E8c77b5c1dE58c8D` | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |

The contract repo should always treat these manifest files as the deployment source of truth.

## Contract Surface

### PolicyVault

Primary functions:
- `initialize(address initialOwner)`
- `registerDataset(bytes32 ciphertextHash, bytes32 keyCommitment, bytes32 metadataHash, bytes32 providerUaidHash)`
- `setDatasetActive(uint256 datasetId, bool active)`
- `createTimeboundPolicy(uint256 datasetId, address payout, address paymentToken, uint96 price, uint64 expiresAt, bool allowlistEnabled, bytes32 metadataHash, address[] allowlistAccounts)`
- `createUaidBoundPolicy(uint256 datasetId, address payout, address paymentToken, uint96 price, uint64 expiresAt, bool allowlistEnabled, bytes32 metadataHash, bytes32 requiredBuyerUaidHash, address identityRegistry, uint256 agentId, address[] allowlistAccounts)`
- `createPolicyForDataset(uint256 datasetId, bytes32 policyType, address payout, address paymentToken, uint96 price, uint64 expiresAt, bool allowlistEnabled, bytes32 metadataHash, address[] allowlistAccounts)`
- `updatePolicy(uint256 policyId, uint96 newPrice, uint64 newExpiresAt, bool active, bool allowlistEnabled, bytes32 newMetadataHash)`
- `setAllowlist(uint256 policyId, address[] accounts, bool allowed)`
- `getDataset(uint256 datasetId)`
- `getDatasetPolicyCount(uint256 datasetId)`
- `getDatasetPolicyIdAt(uint256 datasetId, uint256 index)`
- `getDatasetPolicyIds(uint256 datasetId)`
- `getPolicy(uint256 policyId)`
- `isAllowlisted(uint256 policyId, address account)`
- `isSupportedPolicyType(bytes32 policyType)`
- `datasetCount()`
- `policyCount()`

Events:
- `DatasetRegistered`
- `DatasetStatusUpdated`
- `PolicyCreated`
- `PolicyUpdated`
- `AllowlistUpdated`

### PaymentModule

Primary functions:
- `initialize(address initialOwner, address policyVaultAddress, address accessReceiptAddress)`
- `purchase(uint256 policyId, address recipient, string buyerUaid)`
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
- `mintReceipt(address buyer, address recipient, uint256 policyId, uint256 datasetId, address paymentToken, uint96 price, uint64 purchasedAt, bytes32 ciphertextHash, bytes32 keyCommitment)`
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
- `POLICY_TYPE_TIMEBOUND` is the built-in supported policy type. It enforces an optional expiration timestamp and establishes the registry pattern for future policy types such as KYC or geographic proofs.
- `POLICY_TYPE_UAID_ERC8004` is the built-in agent-gated policy type. It stores the resolved `identityRegistry`, `agentId`, and `requiredBuyerUaidHash`, then enforces ERC-8004 ownership plus an exact HCS-14 UAID hash match during purchase.
- `PolicyVault` owns dataset and policy metadata plus provider-controlled mutability.
- `PaymentModule` is the only contract allowed to mint receipts.
- One buyer can hold at most one receipt per policy.
- Receipts are non-transferable.
- Expiry is strict: `expiresAt == block.timestamp` is expired.
- UAID-bound purchases require the caller to pass the exact buyer UAID string.
- `PaymentModule.hasAccess` reports active entitlement, not merely historical purchase. It returns `false` once a time-bound policy expires or a dataset is deactivated.
- `AccessReceipt` remains the durable historical proof of purchase, while `PaymentModule.hasDatasetAccess` resolves whether any active policy on a dataset still grants access.
- Allowlist enforcement is onchain through `PolicyVault.isAllowlisted`.
- Offchain key release should validate both the signed buyer request and current onchain access state.

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
forge build --sizes
forge test -vvv
```

Regenerate checked-in ABIs:

```bash
forge inspect --json AccessReceipt abi > abis/AccessReceipt.abi.json
forge inspect --json PaymentModule abi > abis/PaymentModule.abi.json
forge inspect --json PolicyVault abi > abis/PolicyVault.abi.json
```

## CLI Workflows

The contracts repo includes two live CLI workflows in `script/manage-policies.mjs`:
- `flow:direct` runs the direct onchain ERC-8004 path
- `flow:broker` registers through the local Registry Broker with `RegistryBrokerClient`, then proves the same UAID-gated purchase flow against the selected live `IdentityRegistry`

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

- GitHub release tags must match the package version, for example `v0.1.0`
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

By default both workflows use Robinhood testnet. Set `PROGRAMMABLE_SECRETS_NETWORK=arbitrum-sepolia` if you want the Arbitrum Sepolia path.

If you want to point at a different env file, set `PROGRAMMABLE_SECRETS_ENV_PATH` before running the command.

## Contract Commands

The CLI now covers the full operator surface around the deployed contracts.

Read-only commands:

```bash
programmable-secret contracts
programmable-secret datasets list
programmable-secret datasets get --dataset-id 1
programmable-secret policies list
programmable-secret policies get --policy-id 1
programmable-secret access policy --policy-id 1 --buyer 0x...
programmable-secret access dataset --dataset-id 1 --buyer 0x...
programmable-secret receipts get --receipt-id 1
```

Write commands:

```bash
programmable-secret identity register --agent-uri https://hol.org/agents/volatility-trading-agent-custodian
programmable-secret datasets register --provider-uaid "did:uaid:hol:quantlab?uid=quantlab&registry=hol&proto=hol&nativeId=quantlab" --metadata-json '{"title":"TSLA feed"}' --ciphertext "encrypted payload" --key-material "wrapped key"
programmable-secret datasets set-active --dataset-id 1 --active false
programmable-secret policies create-timebound --dataset-id 1 --price-eth 0.00001 --duration-hours 24 --metadata-json '{"title":"24 hour access"}'
programmable-secret policies create-uaid --dataset-id 1 --price-eth 0.00001 --duration-hours 24 --required-buyer-uaid uaid:aid:... --agent-id 97
programmable-secret policies update --policy-id 1 --price-eth 0.00002 --active true --metadata-json '{"title":"Updated access"}'
programmable-secret policies allowlist --policy-id 1 --accounts 0xabc,0xdef --allowed true
programmable-secret purchase --policy-id 1
```

The CLI accepts either direct hashes or operator-friendly raw inputs for dataset registration:
- `--ciphertext-hash` or `--ciphertext`
- `--key-commitment` or `--key-material`
- `--metadata-hash`, `--metadata-json`, `--metadata-file`, or `--metadata`
- `--provider-uaid-hash` or `--provider-uaid`

Wallet selection:
- provider-facing write commands default to `ETH_PK_2`
- agent-facing commands default to `ETH_PK`
- override with `--wallet provider` or `--wallet agent`

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

The current checked-in deployments were created deterministically with `script/Deploy.s.sol:DeployCreate2`, so the app-facing contract addresses match across Robinhood Chain Testnet and Arbitrum Sepolia.

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
