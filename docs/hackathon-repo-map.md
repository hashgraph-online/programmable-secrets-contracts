# Hackathon Repository Map

This map links the repositories used by the Programmable Secrets hackathon build and clarifies how they connect.

The baseline references come from `ps-deep-research.md` (contracts repo + skill), expanded with the additional repos used in deployed and integrated flows.

## Repository links

| Repository | System role | Primary touchpoints |
| --- | --- | --- |
| [`hashgraph-online/programmable-secrets-contracts`](https://github.com/hashgraph-online/programmable-secrets-contracts) | Onchain source of truth | `src/`, `deployments/`, `abis/`, CLI flows, subgraph package |
| [`hashgraph-online/programmable-secrets-fe`](https://github.com/hashgraph-online/programmable-secrets-fe) | Buyer/provider frontend | Reads contract entrypoints and uses WalletConnect for transaction flows |
| [`hashgraph-online/programmable-secrets-skill`](https://github.com/hashgraph-online/programmable-secrets-skill) | Agent skill package | Encapsulates operator workflows documented in contracts repo |
| [`erc-8004/erc-8004-contracts`](https://github.com/erc-8004/erc-8004-contracts) | Upstream ERC-8004 identity registry contracts | `UaidOwnershipCondition` identity ownership checks |

## Integration boundaries

| Integration | Produced by | Consumed by |
| --- | --- | --- |
| Deployment manifests (`deployments/*.json`) | `programmable-secrets-contracts` | frontend, broker, portal, subgraph |
| ABI artifacts (`abis/*.abi.json`) | `programmable-secrets-contracts` | frontend, broker, portal |
| GraphQL entities/subgraph endpoints | `programmable-secrets-contracts/subgraph` | frontend, portal, analytics tooling |
| UAID registry checks | `erc-8004-contracts` deployments | contracts (`UaidOwnershipCondition`), broker-backed flows |
| Operator runbooks and skill commands | contracts README + skill repo | agents, operators, demo scripts |

## Operator path across repos

1. Register dataset and policy via the contracts CLI (`programmable-secrets-contracts`).
2. Resolve identity gating with ERC-8004 registry ownership checks (`erc-8004-contracts` deployment target).
3. Optionally run broker-backed registration and UAID issuance through a compatible broker deployment.
4. Query indexed data via the subgraph (`programmable-secrets-contracts/subgraph`).
5. Execute buyer/provider UX in `programmable-secrets-fe`.
6. Reuse standardized workflow packaging for autonomous agents (`programmable-secrets-skill`).

## Documentation links

- Root protocol docs: [`../README.md`](../README.md)
- Structure guide: [`repository-structure.md`](repository-structure.md)
- Subgraph docs: [`../subgraph/README.md`](../subgraph/README.md)
