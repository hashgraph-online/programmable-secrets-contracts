# Programmable Secrets Contracts

This project contains the Arbitrum contract for the Programmable Secrets POC.

## Layout

- `src/ProgrammableSecrets.sol`: core offer + purchase contract
- `src/Errors.sol`: custom errors
- `src/Events.sol`: event definitions
- `script/Deploy.s.sol`: deployment script
- `script/Verify.s.sol`: verification helper placeholder
- `test/ProgrammableSecrets.t.sol`: unit and fuzz tests
- `deployments/arbitrum-sepolia.json`: canonical checked-in deployment artifact

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

## GitHub automation

The repository ships with GitHub Actions for CI, security scanning, and manual Sepolia deployment:

- `.github/workflows/ci.yml`
  Runs `forge fmt --check`, `forge lint`, `forge build --sizes`, `forge test -vvv`, and a gas report on every push to `main` and every pull request.
- `.github/workflows/security.yml`
  Runs Slither, uploads a SARIF artifact on every run, attempts GitHub code scanning upload when the repository supports it, and fails on any low-or-higher severity finding after excluding the two intentional patterns in this contract:
  `timestamp` for offer expiry and `low-level-calls` for guarded native-ETH payout.
- `.github/workflows/deploy-arbitrum-sepolia.yml`
  Provides a manual `workflow_dispatch` deployment path for Arbitrum Sepolia, writes the canonical deployment artifact, verifies on Sourcify, and attempts Arbiscan verification when an API key is configured.
- `.github/dependabot.yml`
  Keeps GitHub Actions dependencies updated weekly.

### Required GitHub secrets

For the `arbitrum-sepolia` deployment environment:

- `ARBITRUM_SEPOLIA_RPC_URL`
- `DEPLOYER_PRIVATE_KEY`

Optional deploy-time verification secrets:

- `ARBISCAN_API_KEY`
- `ETHERSCAN_API_KEY`

Compatibility fallback:

- `ETH_PK`

The deploy workflow prefers `DEPLOYER_PRIVATE_KEY` and falls back to `ETH_PK` for compatibility with the existing local script.
Either secret may be stored with or without a leading `0x`; the workflow normalizes the key before running Foundry.

Optional repository variable for native GitHub code scanning on private repos:

- `ENABLE_GHAS_CODE_SCANNING=true`

Leave that variable unset for private repos without GitHub Advanced Security. In that mode the security workflow still uploads `results.sarif` as a build artifact so the Slither report remains inspectable.

## Canonical deployment artifact

The checked-in deployment artifact path is:

- `deployments/arbitrum-sepolia.json`

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

Update that file immediately after any successful Sepolia deployment.

## Current measured gas

Latest `forge test --gas-report` output:

- Deployment cost: `793362`
- Deployment size: `3355`
- `createOffer` average gas: `229407`
- `purchase` average gas: `66717`
- `updateOffer` average gas: `32349`

## ABI handoff

After any ABI change:

1. rebuild this project
2. refresh `abis/ProgrammableSecrets.abi.json`
3. sync the ABI/address into `registry-broker` and `hol-points-portal` before backend or UI integration proceeds

## Current status

- Foundry bootstrap complete
- Canonical checked-in ABI added at `abis/ProgrammableSecrets.abi.json`
- Arbitrum Sepolia deployment live at `0x0c9cf58751ED2Dd199FBe42a777B96c5c8Bc8b8f`
- Deployment tx: `0x34d932909d3195569db421c82b85ef5c8c2df7dd12ab8b794bc12cd479963356`
- Gas report captured

## Live Sepolia rehearsal

Validated against the live contract on `2026-03-06`.

- Example offer id: `1`
- Offer creation tx: `0x189b64468ed7c246e0e1007d7c9d5024ba8ad93a41c68b416184f281693650d9`
- Purchase tx: `0x78df1f2ed03b49b0d8cbcf7af941a047a1afd51f19fed3c72008b309d4ab137e`
- Key issue latency: `1460 ms`
- Buyer plaintext hash after decrypt: `0x2f1ff5d4604576427dc0f8b691e974d208981f031fe7b3abb86a3f048f4bff3a`

## Explorer verification

- Public source verification is complete on Sourcify as an `exact_match`.
- Sourcify contract page: `https://repo.sourcify.dev/421614/0x0c9cf58751ED2Dd199FBe42a777B96c5c8Bc8b8f`
- Sourcify metadata: `https://sourcify.dev/server/repository/contracts/full_match/421614/0x0c9cf58751ED2Dd199FBe42a777B96c5c8Bc8b8f/metadata.json`
- Sourcify source file: `https://sourcify.dev/server/repository/contracts/full_match/421614/0x0c9cf58751ED2Dd199FBe42a777B96c5c8Bc8b8f/sources/src/ProgrammableSecrets.sol`
- Arbiscan-native verification is complete for `https://sepolia.arbiscan.io/address/0x0c9cf58751ED2Dd199FBe42a777B96c5c8Bc8b8f#code`.
- Verified via Foundry and confirmed through the Etherscan V2 API with:
  - contract name `ProgrammableSecrets`
  - compiler `v0.8.24+commit.e11b9ed9`
  - optimizer enabled
  - non-empty published source
