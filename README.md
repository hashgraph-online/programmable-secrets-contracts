# Programmable Secrets Contracts

This project contains the EVM contract for the Programmable Secrets POC.

## Layout

- `src/ProgrammableSecrets.sol`: core offer + purchase contract
- `src/Errors.sol`: custom errors
- `src/Events.sol`: event definitions
- `script/Deploy.s.sol`: deployment script
- `script/Verify.s.sol`: verification helper placeholder
- `test/ProgrammableSecrets.t.sol`: unit and fuzz tests
- `deployments/*.json`: canonical checked-in deployment artifacts per network

## Requirements

- Foundry with `forge`

## Local commands

```bash
cd programmable-secrets-contracts
forge build
forge fmt
forge lint
forge test -vvv
forge test --gas-report
```

## Deploy to Arbitrum Sepolia

```bash
cd programmable-secrets-contracts
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "https://sepolia-rollup.arbitrum.io/rpc" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast \
  -vvv
```

## Deploy to Robinhood Chain Testnet

```bash
cd programmable-secrets-contracts
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "https://rpc.testnet.chain.robinhood.com/rpc" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast \
  -vvv
```

## GitHub automation

The repository ships with GitHub Actions for CI, security scanning, and manual EVM testnet deployment:

- `.github/workflows/ci.yml`
  Runs `forge fmt --check`, `forge lint`, `forge build --sizes`, `forge test -vvv`, and a gas report on every push to `main` and every pull request.
- `.github/workflows/security.yml`
  Runs Slither, uploads a SARIF artifact on every run, attempts GitHub code scanning upload when the repository supports it, and fails on any low-or-higher severity finding after excluding the two intentional patterns in this contract:
  `timestamp` for offer expiry and `low-level-calls` for guarded native-ETH payout.
- `.github/workflows/deploy-arbitrum-sepolia.yml`
  Provides a manual `workflow_dispatch` deployment path for both Arbitrum Sepolia and Robinhood Chain Testnet, writes the canonical deployment artifact for the selected network, verifies on Sourcify for Arbitrum Sepolia, and performs native explorer verification through Arbiscan or Robinhood's Blockscout explorer as appropriate.
- `.github/dependabot.yml`
  Keeps GitHub Actions dependencies updated weekly.

### Required GitHub secrets

For the existing `arbitrum-sepolia` deployment environment, which currently stores the shared deployer key plus RPC URLs for the supported testnets:

- `ARBITRUM_SEPOLIA_RPC_URL`
- `ROBINHOOD_TESTNET_RPC_URL`
- `DEPLOYER_PRIVATE_KEY`

Optional deploy-time verification secrets:

- `ARBISCAN_API_KEY`
- `ETHERSCAN_API_KEY`

Compatibility fallback:

- `ETH_PK`

The deploy workflow prefers `DEPLOYER_PRIVATE_KEY` and falls back to `ETH_PK` for compatibility with the existing local script. Either secret may be stored with or without a leading `0x`; the workflow normalizes the key before running Foundry.

Optional repository variable for native GitHub code scanning on private repos:

- `ENABLE_GHAS_CODE_SCANNING=true`

Leave that variable unset for private repos without GitHub Advanced Security. In that mode the security workflow still uploads `results.sarif` as a build artifact so the Slither report remains inspectable.

## Canonical deployment artifact

The checked-in deployment artifact paths are:

- `deployments/arbitrum-sepolia.json`
- `deployments/robinhood-testnet.json`

Required fields:

- `chainId`
- `network`
- `contractAddress`
- `deployer`
- `blockNumber`
- `transactionHash`
- `deployedAt`
- `abiChecksum`
- `gitCommit`

Update the relevant file immediately after any successful deployment.

## Current measured gas

Latest `forge test --gas-report` output:

- Deployment cost: `836945`
- Deployment size: `3556`
- `createOffer` average gas: `195419`
- `purchase` average gas: `65721`
- `updateOffer` average gas: `33365`

## Hardening notes

- Offer creation and updates now reject zero integrity hashes for `ciphertextHash`, `keyCommitment`, `metadataHash`, and `providerUaidHash`.
- Offer expiries now use strict future-only validation, and purchases revert at the exact `expiresAt` timestamp.
- Internal offer storage is packed into `7` storage slots while the external `getOffer` ABI remains unchanged.
- Security coverage includes payout rejection handling and an explicit payout-contract reentrancy regression test.

## ABI handoff

After any ABI change:

1. rebuild this project
2. refresh `abis/ProgrammableSecrets.abi.json`
3. sync the ABI/address into `registry-broker` and `hol-points-portal` before backend or UI integration proceeds

## Current status

- Foundry bootstrap complete
- Canonical checked-in ABI added at `abis/ProgrammableSecrets.abi.json`
- Latest GitHub Actions Arbitrum Sepolia deployment live at `0x0eA271390F1e275Bde02BC1087691461497B6650`
- Latest deployment tx: `0x790ecd369855e79619b3351b58d85fb73d9a01ac77762e51c7a36fd61eb24050`
- Latest GitHub Actions Robinhood Chain Testnet deployment live at `0x0C04e50660332dB8Fda62f92c07eA725D0D66e80`
- Latest Robinhood deployment tx: `0x9c473e43569da767a13bf16922205222de92c727f5bc541fe19d038d4753ed5e`
- Canonical deployment artifacts updated in commits `d99bc1c` and `b95afe6`
- Gas report captured

## Historical browser rehearsal

Validated on `2026-03-06` against the earlier Sepolia deployment used for the portal and broker browser walkthrough.

- Example offer id: `1`
- Offer creation tx: `0x189b64468ed7c246e0e1007d7c9d5024ba8ad93a41c68b416184f281693650d9`
- Purchase tx: `0x78df1f2ed03b49b0d8cbcf7af941a047a1afd51f19fed3c72008b309d4ab137e`
- Key issue latency: `1460 ms`
- Buyer plaintext hash after decrypt: `0x2f1ff5d4604576427dc0f8b691e974d208981f031fe7b3abb86a3f048f4bff3a`

## Explorer verification

- Public source verification is complete on Sourcify as an `exact_match`.
- Sourcify contract page: `https://repo.sourcify.dev/421614/0x0eA271390F1e275Bde02BC1087691461497B6650`
- Sourcify metadata: `https://sourcify.dev/server/repository/contracts/full_match/421614/0x0eA271390F1e275Bde02BC1087691461497B6650/metadata.json`
- Sourcify source file: `https://sourcify.dev/server/repository/contracts/full_match/421614/0x0eA271390F1e275Bde02BC1087691461497B6650/sources/src/ProgrammableSecrets.sol`
- Arbiscan-native verification is complete for `https://sepolia.arbiscan.io/address/0x0eA271390F1e275Bde02BC1087691461497B6650#code`.
- Robinhood Blockscout verification is complete for `https://explorer.testnet.chain.robinhood.com/address/0x0C04e50660332dB8Fda62f92c07eA725D0D66e80?tab=contract`.
- Verified via the GitHub deployment workflow using Foundry's `blockscout` verifier against `https://explorer.testnet.chain.robinhood.com/api/`.
- Verified via Foundry and confirmed through the Etherscan V2 API with:
  - contract name `ProgrammableSecrets`
  - compiler `v0.8.24+commit.e11b9ed9`
  - optimizer enabled
  - non-empty published source
