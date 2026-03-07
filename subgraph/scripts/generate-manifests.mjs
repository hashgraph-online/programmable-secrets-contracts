import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const subgraphDir = resolve(__dirname, "..");
const repoDir = resolve(subgraphDir, "..");

const deployments = [
  {
    fileName: "robinhood-testnet.json",
    manifestName: "subgraph.robinhood-testnet.yaml",
  },
  {
    fileName: "arbitrum-sepolia.json",
    manifestName: "subgraph.arbitrum-sepolia.yaml",
  },
];

const templatePath = resolve(subgraphDir, "subgraph.template.yaml");
const template = readFileSync(templatePath, "utf8");

const resolveRequiredAddress = (value, label, network) => {
  if (typeof value !== "string" || !value.startsWith("0x") || value.length !== 42) {
    throw new Error(`Invalid ${label} for ${network}`);
  }

  return value;
};

for (const deployment of deployments) {
  const deploymentPath = resolve(repoDir, "deployments", deployment.fileName);
  const deploymentRaw = readFileSync(deploymentPath, "utf8");
  const deploymentJson = JSON.parse(deploymentRaw);

  const network = deploymentJson.network;
  const startBlock = deploymentJson.blockNumber;
  const entrypoints = deploymentJson.entrypoints ?? {};

  if (typeof network !== "string" || network.length === 0) {
    throw new Error(`Deployment file ${deployment.fileName} is missing "network"`);
  }

  if (typeof startBlock !== "number" || startBlock <= 0) {
    throw new Error(`Deployment file ${deployment.fileName} is missing valid "blockNumber"`);
  }

  const policyVaultAddress = resolveRequiredAddress(
    entrypoints.policyVaultAddress,
    "policyVaultAddress",
    network,
  );
  const paymentModuleAddress = resolveRequiredAddress(
    entrypoints.paymentModuleAddress,
    "paymentModuleAddress",
    network,
  );
  const accessReceiptAddress = resolveRequiredAddress(
    entrypoints.accessReceiptAddress,
    "accessReceiptAddress",
    network,
  );

  const manifest = template
    .replaceAll("__NETWORK__", network)
    .replaceAll("__START_BLOCK__", String(startBlock))
    .replaceAll("__POLICY_VAULT_ADDRESS__", policyVaultAddress)
    .replaceAll("__PAYMENT_MODULE_ADDRESS__", paymentModuleAddress)
    .replaceAll("__ACCESS_RECEIPT_ADDRESS__", accessReceiptAddress);

  const outputPath = resolve(subgraphDir, deployment.manifestName);
  writeFileSync(outputPath, manifest, "utf8");
  process.stdout.write(`generated ${deployment.manifestName}\n`);
}
