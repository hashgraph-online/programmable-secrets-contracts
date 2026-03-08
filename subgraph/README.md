# Programmable Secrets Subgraph

This package indexes `PolicyVault`, `PaymentModule`, and `AccessReceipt` for:
- `robinhood-testnet` (default)
- `arbitrum-sepolia` (optional)

It tracks:
- policy-level `receiptTransferable`
- access-grant-level `receiptTransferable`
- current `Receipt.holder` after ERC-721 transfers

Manifests are generated directly from checked-in deployment manifests:
- `../deployments/robinhood-testnet.json`
- `../deployments/arbitrum-sepolia.json`

## Related docs

- Protocol overview: [`../README.md`](../README.md)
- Repository structure: [`../docs/repository-structure.md`](../docs/repository-structure.md)
- Hackathon repo map: [`../docs/hackathon-repo-map.md`](../docs/hackathon-repo-map.md)

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

## Kubernetes Deployment (Staging)

Kubernetes manifests are included at:
- `subgraph/deploy/k8s`

This stack deploys:
- `ps-subgraph-postgres`
- `ps-subgraph-ipfs`
- `ps-graph-node`
- ingress host `ps-subgraph.hol.org`

Apply manifests in the staging namespace:

```bash
kubectl -n programmable-secrets-staging create secret generic ps-subgraph-secrets \
  --from-literal=postgres-password='<strong-password>' \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl apply -k subgraph/deploy/k8s
kubectl -n programmable-secrets-staging rollout status deployment/ps-subgraph-postgres
kubectl -n programmable-secrets-staging rollout status deployment/ps-subgraph-ipfs
kubectl -n programmable-secrets-staging rollout status deployment/ps-graph-node
```

Publish subgraphs to the in-cluster Graph Node:

```bash
kubectl -n programmable-secrets-staging port-forward svc/ps-graph-node 18020:8020 18000:8000
kubectl -n programmable-secrets-staging port-forward svc/ps-subgraph-ipfs 15001:5001

pnpm --dir subgraph exec graph create --node http://127.0.0.1:18020 programmable-secrets-robinhood
pnpm --dir subgraph exec graph deploy --node http://127.0.0.1:18020 --ipfs http://127.0.0.1:15001 programmable-secrets-robinhood subgraph/subgraph.robinhood-testnet.yaml

pnpm --dir subgraph exec graph create --node http://127.0.0.1:18020 programmable-secrets-arbitrum
pnpm --dir subgraph exec graph deploy --node http://127.0.0.1:18020 --ipfs http://127.0.0.1:15001 programmable-secrets-arbitrum subgraph/subgraph.arbitrum-sepolia.yaml
```

GraphQL endpoints:
- `https://ps-subgraph.hol.org/subgraphs/name/programmable-secrets-robinhood`
- `https://ps-subgraph.hol.org/subgraphs/name/programmable-secrets-arbitrum`

## Indexed entities

- `ProtocolConfig`
- `Evaluator`
- `Dataset`
- `Policy`
- `AccessGrant`
- `Receipt`
