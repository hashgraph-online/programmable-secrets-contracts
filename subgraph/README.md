# Programmable Secrets Subgraph

This package indexes `PolicyVault`, `PaymentModule`, and `AccessReceipt` for:
- `robinhood-testnet` (default)
- `arbitrum-sepolia` (optional)

Manifests are generated directly from checked-in deployment manifests:
- `../deployments/robinhood-testnet.json`
- `../deployments/arbitrum-sepolia.json`

## Prerequisites

- Node `>=20`
- pnpm `>=10`

## Install

```bash
pnpm --dir subgraph install
```

## Generate manifests

```bash
pnpm --dir subgraph run prepare:manifests
```

Generated files:
- `subgraph/subgraph.robinhood-testnet.yaml`
- `subgraph/subgraph.arbitrum-sepolia.yaml`

## Build (codegen + compile)

Robinhood:

```bash
pnpm --dir subgraph run build:robinhood
```

Arbitrum:

```bash
pnpm --dir subgraph run build:arbitrum
```

Both:

```bash
pnpm --dir subgraph run build
```

## Deploy

Robinhood testnet is a custom EVM network and typically requires a self-hosted Graph Node with custom chain configuration.
Arbitrum Sepolia can be deployed through The Graph Studio or other supported Graph infrastructure.

Example deploy commands:

```bash
graph deploy --studio <subgraph-slug> subgraph/subgraph.arbitrum-sepolia.yaml
graph deploy --node <graph-node-url> --ipfs <ipfs-url> programmable-secrets-robinhood subgraph/subgraph.robinhood-testnet.yaml
```

## Indexed entities

- `ProtocolConfig`
- `Evaluator`
- `Dataset`
- `Policy`
- `AccessGrant`
- `Receipt`
