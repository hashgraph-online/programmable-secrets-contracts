# Programmable Secrets Contracts

`ProgrammableSecrets` is the EVM settlement contract for the Programmable Secrets POC.
It lets a provider publish a priced encrypted payload reference, and lets a buyer purchase one-time access with native ETH.

This repository is the source of truth for:
- the Solidity contract
- the checked-in ABI
- the canonical deployment artifacts
- the GitHub CI, security, and deployment automation

## Live Contracts

These two live testnet deployments currently expose the same verified bytecode and ABI checksum `77090895059bc200089ebc6ef3314af06c32131c9d1bed50961230af429860c3`.

| Network | Chain ID | Contract | Deploy Tx | Deployed At (UTC) | Verification | Artifact |
| --- | ---: | --- | --- | --- | --- | --- |
| Arbitrum Sepolia | `421614` | [`0x0eA271390F1e275Bde02BC1087691461497B6650`](https://sepolia.arbiscan.io/address/0x0eA271390F1e275Bde02BC1087691461497B6650#code) | [`0x790ecd369855e79619b3351b58d85fb73d9a01ac77762e51c7a36fd61eb24050`](https://sepolia.arbiscan.io/tx/0x790ecd369855e79619b3351b58d85fb73d9a01ac77762e51c7a36fd61eb24050) | `2026-03-06T23:52:15Z` | [Arbiscan](https://sepolia.arbiscan.io/address/0x0eA271390F1e275Bde02BC1087691461497B6650#code), [Sourcify](https://repo.sourcify.dev/421614/0x0eA271390F1e275Bde02BC1087691461497B6650) | [`deployments/arbitrum-sepolia.json`](./deployments/arbitrum-sepolia.json) |
| Robinhood Chain Testnet | `46630` | [`0x0C04e50660332dB8Fda62f92c07eA725D0D66e80`](https://explorer.testnet.chain.robinhood.com/address/0x0C04e50660332dB8Fda62f92c07eA725D0D66e80?tab=contract) | [`0x9c473e43569da767a13bf16922205222de92c727f5bc541fe19d038d4753ed5e`](https://explorer.testnet.chain.robinhood.com/tx/0x9c473e43569da767a13bf16922205222de92c727f5bc541fe19d038d4753ed5e) | `2026-03-07T01:49:25Z` | [Robinhood Blockscout exact match](https://explorer.testnet.chain.robinhood.com/address/0x0C04e50660332dB8Fda62f92c07eA725D0D66e80?tab=contract) | [`deployments/robinhood-testnet.json`](./deployments/robinhood-testnet.json) |

## Network Details

| Network | RPC URL | Currency | Explorer |
| --- | --- | --- | --- |
| Arbitrum Sepolia | `https://sepolia-rollup.arbitrum.io/rpc` | `ETH` | `https://sepolia.arbiscan.io` |
| Robinhood Chain Testnet | `https://rpc.testnet.chain.robinhood.com/rpc` | `ETH` | `https://explorer.testnet.chain.robinhood.com` |

Use Arbitrum Sepolia when you want compatibility with the existing portal and broker walkthrough.
Use Robinhood Chain Testnet when you want the Robinhood-hosted L2 environment and Blockscout-native verification flow.

## Contract Surface

The deployed contract in [`src/ProgrammableSecrets.sol`](./src/ProgrammableSecrets.sol) has a deliberately small surface area:

- `createOffer(address payout, address paymentToken, uint96 price, uint64 expiresAt, bytes32 ciphertextHash, bytes32 keyCommitment, bytes32 metadataHash, bytes32 providerUaidHash) returns (uint256 offerId)`
- `updateOffer(uint256 offerId, uint96 newPrice, uint64 newExpiresAt, bool active, bytes32 newMetadataHash)`
- `getOffer(uint256 offerId) returns (Offer)`
- `purchase(uint256 offerId, address recipient) payable`
- `hasAccess(uint256 offerId, address user) returns (bool)`
- `purchasedTimestamp(uint256 offerId, address user) returns (uint64)`
- `offerCount() returns (uint256)`
- `purchasedAt(uint256 offerId, address buyer) returns (uint64)`

### Offer Struct

`getOffer()` returns:

```solidity
struct Offer {
    address provider;
    address payout;
    address paymentToken;
    uint96 price;
    uint64 createdAt;
    uint64 expiresAt;
    bool active;
    bytes32 ciphertextHash;
    bytes32 keyCommitment;
    bytes32 metadataHash;
    bytes32 providerUaidHash;
}
```

## Contract Semantics

These behaviors matter for every integration:

- Native ETH only. `paymentToken` must be `address(0)` today. Any non-zero token address reverts with `InvalidPaymentToken()`.
- Exact payment only. `purchase()` reverts unless `msg.value == offer.price`.
- Strict future expiry. `expiresAt` must be `0` or strictly greater than the current block timestamp at create and update time.
- Expiry is inclusive on failure. A purchase at the exact `expiresAt` timestamp reverts with `OfferExpired()`.
- Integrity anchors are mandatory. `ciphertextHash`, `keyCommitment`, `metadataHash`, and `providerUaidHash` must all be non-zero.
- Access is keyed by the buyer wallet. The `recipient` argument is emitted for indexing and downstream routing, but on-chain authorization is still stored under `msg.sender`.
- One purchase per buyer per offer. A second purchase from the same wallet reverts with `AlreadyPurchased()`.
- Payout is push-based. ETH is forwarded to `payout` during `purchase()`. If the payout address rejects ETH, the full purchase reverts with `PaymentFailed()`.
- Reentrancy is guarded. Native payout forwarding is wrapped by a simple non-reentrant gate and reentry attempts revert with `ReentrancyDetected()`.
- No admin surface. There is no owner, no pause role, no upgrade hook, and no withdrawal path.

## Recommended Integration Model

For a full provider and buyer flow:

1. Encrypt content off-chain.
2. Compute `ciphertextHash`, `keyCommitment`, `metadataHash`, and `providerUaidHash` off-chain.
3. Call `createOffer()` from the provider wallet.
4. Index `OfferCreated`.
5. Show the offer from `getOffer()` in UI or backend read models.
6. Call `purchase()` from the buyer wallet with exact ETH.
7. Index `AccessPurchased`.
8. Grant off-chain decryption delivery only after confirming the purchase event and `hasAccess()` or `purchasedTimestamp()`.

Do not use the `recipient` field as the sole authorization signal. The contract intentionally records access against the buyer address.

## Quick Start

### Read Contract State with `cast`

Arbitrum Sepolia:

```bash
cast call \
  0x0eA271390F1e275Bde02BC1087691461497B6650 \
  "offerCount()(uint256)" \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc
```

Robinhood Chain Testnet:

```bash
cast call \
  0x0C04e50660332dB8Fda62f92c07eA725D0D66e80 \
  "offerCount()(uint256)" \
  --rpc-url https://rpc.testnet.chain.robinhood.com/rpc
```

### Create an Offer with `cast`

Set your provider wallet key in `DEPLOYER_PRIVATE_KEY` or another local secret variable first.

```bash
export CONTRACT=0x0C04e50660332dB8Fda62f92c07eA725D0D66e80
export RPC_URL=https://rpc.testnet.chain.robinhood.com/rpc

cast send "$CONTRACT" \
  "createOffer(address,address,uint96,uint64,bytes32,bytes32,bytes32,bytes32)" \
  0x8fC56f5F0534BB25E7F140Eb467E6D1DDBA62e57 \
  0x0000000000000000000000000000000000000000 \
  1000000000000000 \
  1763000000 \
  0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc \
  0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --rpc-url "$RPC_URL"
```

Parameter rules:

- `payout`: where ETH should be forwarded during purchase
- `paymentToken`: must be `0x0000000000000000000000000000000000000000`
- `price`: uint96 price in wei
- `expiresAt`: unix seconds or `0` for no expiry
- `ciphertextHash`: keccak256 or equivalent content-addressed hash of encrypted payload bytes
- `keyCommitment`: commitment to the decryption key or key envelope
- `metadataHash`: commitment to the off-chain metadata blob
- `providerUaidHash`: hashed provider identity anchor

### Purchase an Offer with `cast`

```bash
export CONTRACT=0x0C04e50660332dB8Fda62f92c07eA725D0D66e80
export RPC_URL=https://rpc.testnet.chain.robinhood.com/rpc
export OFFER_ID=1
export PRICE_WEI=1000000000000000

cast send "$CONTRACT" \
  "purchase(uint256,address)" \
  "$OFFER_ID" \
  0x0000000000000000000000000000000000000000 \
  --value "$PRICE_WEI" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --rpc-url "$RPC_URL"
```

Passing the zero address as `recipient` is valid. The contract normalizes that emitted recipient to the buyer address.

### Read Access State After Purchase

```bash
cast call "$CONTRACT" \
  "hasAccess(uint256,address)(bool)" \
  "$OFFER_ID" \
  0xYourBuyerAddress \
  --rpc-url "$RPC_URL"

cast call "$CONTRACT" \
  "purchasedTimestamp(uint256,address)(uint64)" \
  "$OFFER_ID" \
  0xYourBuyerAddress \
  --rpc-url "$RPC_URL"
```

## Events

Declared in [`src/Events.sol`](./src/Events.sol).

### `OfferCreated`

Emitted when a provider publishes a new offer.

Indexed topics:

- `offerId`
- `provider`
- `payout`

Data payload:

- `paymentToken`
- `price`
- `expiresAt`
- `ciphertextHash`
- `keyCommitment`
- `metadataHash`
- `providerUaidHash`

### `OfferUpdated`

Emitted when mutable offer fields are changed.

Indexed topics:

- `offerId`

Data payload:

- `newPrice`
- `newExpiresAt`
- `active`
- `newMetadataHash`

### `AccessPurchased`

Emitted when a buyer completes a purchase.

Indexed topics:

- `offerId`
- `buyer`
- `recipient`

Data payload:

- `paymentToken`
- `price`
- `purchasedAt`
- `ciphertextHash`
- `keyCommitment`

## Errors

Declared in [`src/Errors.sol`](./src/Errors.sol).

| Error | Meaning |
| --- | --- |
| `NotOfferProvider()` | Caller tried to update an offer they do not own |
| `OfferNotFound()` | `offerId` does not exist |
| `OfferInactive()` | Offer was disabled before purchase |
| `OfferExpired()` | Offer expiry has passed or matches the current timestamp |
| `AlreadyPurchased()` | Buyer already purchased this offer |
| `InvalidPrice()` | Zero price at create or update, or incorrect `msg.value` at purchase |
| `InvalidExpiry()` | `expiresAt` is not `0` and not strictly in the future |
| `InvalidPaymentToken()` | Non-native token flow attempted |
| `InvalidOfferHashes()` | One or more required hashes were zero |
| `PaymentFailed()` | Payout address rejected native ETH transfer |
| `ReentrancyDetected()` | Reentrant purchase attempt was blocked |

## Security and Scalability Notes

- The contract uses packed internal storage for offers while preserving a stable external `Offer` ABI.
- `offerCount` grows monotonically and is safe for simple append-only indexing.
- Purchase state is a nested mapping, which keeps lookup cost constant per `(offerId, buyer)` pair.
- There is no array enumeration on-chain. Production indexing should be event-driven.
- The current settlement path is optimized for native ETH only. If ERC-20 support is added later, treat that as a new audited version rather than a silent extension.

Latest measured gas from `forge test --gas-report`:

- Deployment cost: `836945`
- Deployment size: `3556`
- `createOffer` average gas: `195419`
- `purchase` average gas: `65721`
- `updateOffer` average gas: `33365`

## ABI and Integration Handoff

The canonical ABI is checked in at [`abis/ProgrammableSecrets.abi.json`](./abis/ProgrammableSecrets.abi.json).

After any ABI or deployment change:

1. rebuild this project
2. refresh the ABI file if required
3. refresh the network deployment artifact
4. sync the address and ABI into `registry-broker`
5. sync the address and ABI into `hol-points-portal`

## Repository Layout

- [`src/ProgrammableSecrets.sol`](./src/ProgrammableSecrets.sol): core contract
- [`src/Errors.sol`](./src/Errors.sol): custom errors
- [`src/Events.sol`](./src/Events.sol): emitted events
- [`script/Deploy.s.sol`](./script/Deploy.s.sol): Foundry deployment script
- [`script/Verify.s.sol`](./script/Verify.s.sol): helper placeholder
- [`test/ProgrammableSecrets.t.sol`](./test/ProgrammableSecrets.t.sol): unit and fuzz tests
- [`test/ProgrammableSecretsSecurity.t.sol`](./test/ProgrammableSecretsSecurity.t.sol): security regressions
- [`deployments/arbitrum-sepolia.json`](./deployments/arbitrum-sepolia.json): canonical Arbitrum deployment
- [`deployments/robinhood-testnet.json`](./deployments/robinhood-testnet.json): canonical Robinhood deployment

## Local Development

Requirements:

- Foundry with `forge`

Core commands:

```bash
cd programmable-secrets-contracts
forge build
forge fmt --check
forge lint
forge test -vvv
forge test --gas-report
```

## Deployment Automation

GitHub Actions ships three relevant workflows:

- `.github/workflows/ci.yml`
  Runs formatting, linting, build sizing, tests, gas report generation, and checks that both deployment artifacts exist.
- `.github/workflows/security.yml`
  Runs Slither and uploads SARIF output.
- `.github/workflows/deploy-arbitrum-sepolia.yml`
  Manual `workflow_dispatch` deployer for both supported networks.

### GitHub Deployment Inputs

Workflow name:

- `Deploy EVM Testnet`

Workflow input:

- `network`: `arbitrum-sepolia` or `robinhood-testnet`

Current environment:

- `arbitrum-sepolia`

Required secrets in that environment:

- `ARBITRUM_SEPOLIA_RPC_URL`
- `ROBINHOOD_TESTNET_RPC_URL`
- `DEPLOYER_PRIVATE_KEY`

Optional verification secrets:

- `ARBISCAN_API_KEY`
- `ETHERSCAN_API_KEY`
- `ETH_PK`

The workflow prefers `DEPLOYER_PRIVATE_KEY` and falls back to `ETH_PK`. Keys may be stored with or without `0x`.

## Manual Deployment Commands

Arbitrum Sepolia:

```bash
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast \
  -vvv
```

Robinhood Chain Testnet:

```bash
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://rpc.testnet.chain.robinhood.com/rpc \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast \
  -vvv
```

Manual verification on Robinhood uses Blockscout:

```bash
forge verify-contract \
  0x0C04e50660332dB8Fda62f92c07eA725D0D66e80 \
  src/ProgrammableSecrets.sol:ProgrammableSecrets \
  --chain-id 46630 \
  --rpc-url https://rpc.testnet.chain.robinhood.com/rpc \
  --verifier blockscout \
  --verifier-url https://explorer.testnet.chain.robinhood.com/api/ \
  --compiler-version v0.8.24+commit.e11b9ed9 \
  --num-of-optimizations 200 \
  --watch
```

## Verification Status

Arbitrum Sepolia:

- Sourcify exact match: [repo.sourcify.dev/421614/0x0eA271390F1e275Bde02BC1087691461497B6650](https://repo.sourcify.dev/421614/0x0eA271390F1e275Bde02BC1087691461497B6650)
- Arbiscan source: [sepolia.arbiscan.io/address/0x0eA271390F1e275Bde02BC1087691461497B6650#code](https://sepolia.arbiscan.io/address/0x0eA271390F1e275Bde02BC1087691461497B6650#code)

Robinhood Chain Testnet:

- Blockscout exact match: [explorer.testnet.chain.robinhood.com/address/0x0C04e50660332dB8Fda62f92c07eA725D0D66e80?tab=contract](https://explorer.testnet.chain.robinhood.com/address/0x0C04e50660332dB8Fda62f92c07eA725D0D66e80?tab=contract)

## Historical Notes

On `2026-03-06`, the earlier browser rehearsal against the older Sepolia deployment used:

- example offer id `1`
- offer creation tx `0x189b64468ed7c246e0e1007d7c9d5024ba8ad93a41c68b416184f281693650d9`
- purchase tx `0x78df1f2ed03b49b0d8cbcf7af941a047a1afd51f19fed3c72008b309d4ab137e`
- key issue latency `1460 ms`
- buyer plaintext hash `0x2f1ff5d4604576427dc0f8b691e974d208981f031fe7b3abb86a3f048f4bff3a`
