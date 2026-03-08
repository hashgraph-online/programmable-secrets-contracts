# Repository Structure

This document defines the intended structure of `programmable-secrets-contracts` so changes stay focused and predictable.

## Top-level ownership map

| Path | Owner surface | Notes |
| --- | --- | --- |
| `src/` | Solidity protocol contracts | Core onchain logic, policy evaluators, interfaces, and shared errors/events. |
| `test/` | Foundry test suite | Solidity tests for protocol behavior, security invariants, and upgrades. |
| `script/Deploy.s.sol` | Deployment automation | UUPS proxy deployments and ownership handoff flows. |
| `script/Verify.s.sol` | Contract verification flow | Verifies deployments against target explorers. |
| `script/cli/` | Operator CLI modules | Read/write commands, flows, runtime validators, and profile tooling. |
| `__tests__/` | CLI integration tests | Node test coverage for operator commands and custom evaluator helpers. |
| `deployments/` | Canonical addresses | JSON manifests consumed by apps/subgraph and treated as source of truth. |
| `abis/` | Integration artifacts | Checked-in ABI files consumed by frontend, broker, and portal repos. |
| `examples/` | Guided examples | Sample payloads and policy templates for end-to-end demonstrations. |
| `stylus/` | Stylus evaluator implementations | Optional custom evaluator modules and Rust toolchain workflows. |
| `subgraph/` | Indexing package | Graph schema/mappings plus deployment tooling for query surfaces. |
| `.github/workflows/` | CI/CD and security automation | Build, test, deploy, publish, and security scanning workflows. |
| `docs/` | Repository navigation | High-level maps and cross-repo integration documentation. |

## Structure conventions

- Keep core protocol logic in `src/`; avoid mixing deployment-specific helpers into contracts.
- Keep Solidity tests in `test/` and CLI tests in `__tests__/`.
- Treat `deployments/*.json` as authoritative for live addresses.
- Keep externally consumed ABI files in `abis/` updated when contract interfaces change.
- Keep Graph indexing logic isolated to `subgraph/` so app code does not depend on mapping internals.
- Add new operator commands under `script/cli/commands/` and wire them through `script/cli/main.mjs`.

## Change routing quick guide

- Contract behavior changes: `src/` + `test/` + `abis/` + `deployments/` (if redeployed).
- CLI behavior changes: `script/cli/` + `__tests__/`.
- Deployment changes: `script/Deploy.s.sol`, workflow files, and deployment manifests.
- Indexing changes: `subgraph/` schema, mappings, and manifests.
- Cross-repo integration docs: `docs/hackathon-repo-map.md`.
