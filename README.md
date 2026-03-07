# Programmable Secrets Contracts

Programmable Secrets is a receipt-backed entitlement protocol for finance-agent workflows.
Providers commit encrypted market data, issuer materials, research, or private tool access onchain.
Buyers satisfy an onchain policy, mint a non-transferable access receipt, and then request the buyer-bound key envelope from the offchain key release service.

This package is the contract source of truth for:
- `PolicyVault`
- `PaymentModule`
- `AccessReceipt`
- deployment automation
- checked-in ABIs
- testnet deployment manifests

## Architecture

| Contract | Responsibility |
| --- | --- |
| `PolicyVault` | Stores provider-owned datasets plus attached policy records, including dataset discovery indexes and supported policy types. |
| `PaymentModule` | Validates purchase conditions, settles native ETH, mints the access receipt, and resolves active entitlement state for policies or datasets. |
| `AccessReceipt` | Non-transferable ERC-721 entitlement proving a buyer satisfied a specific dataset policy. |

The intended app entrypoints are:
- dataset registration and policy creation through `PolicyVault`
- purchase through `PaymentModule`
- proof checks through `AccessReceipt` or `PaymentModule.receiptOfPolicyAndBuyer`

## Target Networks

| Network | Chain ID | RPC | Explorer |
| --- | ---: | --- | --- |
| Robinhood Chain Testnet | `46630` | `https://rpc.testnet.chain.robinhood.com/rpc` | `https://explorer.testnet.chain.robinhood.com` |
| Arbitrum Sepolia | `421614` | `https://sepolia-rollup.arbitrum.io/rpc` | `https://sepolia.arbiscan.io` |

Robinhood testnet is the primary demo target.
Arbitrum Sepolia is maintained as a secondary testnet deployment target.

## Contract Surface

### PolicyVault

Primary functions:
- `initialize(address initialOwner)`
- `registerDataset(bytes32 ciphertextHash, bytes32 keyCommitment, bytes32 metadataHash, bytes32 providerUaidHash)`
- `setDatasetActive(uint256 datasetId, bool active)`
- `createTimeboundPolicy(uint256 datasetId, address payout, address paymentToken, uint96 price, uint64 expiresAt, bool allowlistEnabled, bytes32 metadataHash, address[] allowlistAccounts)`
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
- `purchase(uint256 policyId, address recipient)`
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
- `PolicyVault` owns dataset and policy metadata plus provider-controlled mutability.
- `PaymentModule` is the only contract allowed to mint receipts.
- One buyer can hold at most one receipt per policy.
- Receipts are non-transferable.
- Expiry is strict: `expiresAt == block.timestamp` is expired.
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
