import { createUaid, parseHcs14Did, toEip155Caip10 } from '@hashgraphonline/standards-sdk';
import { getAddress } from 'viem';
import { CliError } from './errors.mjs';

export const EXAMPLE_PROVIDER_ADDRESS = '0x1111111111111111111111111111111111111111';
export const DEFAULT_EXAMPLE_CHAIN_ID = 46630;

export function buildWalletBackedUaid({
  chainId = DEFAULT_EXAMPLE_CHAIN_ID,
  walletAddress = EXAMPLE_PROVIDER_ADDRESS,
} = {}) {
  const checksumAddress = getAddress(walletAddress);
  const nativeId = toEip155Caip10(chainId, checksumAddress);
  return createUaid(`did:pkh:${nativeId}`, { nativeId });
}

export const EXAMPLE_PROVIDER_UAID = buildWalletBackedUaid();
export const HCS14_CANONICAL_URL =
  'https://github.com/hiero-ledger/hiero-consensus-specifications/blob/675f6d06450c72c63f52191eb090e7b2bdbb405c/docs/standards/hcs-14.md';

export function normalizeProviderUaid(value, { fieldName = 'provider UAID' } = {}) {
  const trimmed = `${value ?? ''}`.trim();
  if (!trimmed) {
    return null;
  }
  try {
    if (!trimmed.startsWith('uaid:')) {
      throw new Error('missing uaid prefix');
    }
    parseHcs14Did(trimmed);
    return trimmed;
  } catch {
    throw new CliError(
      'INVALID_PROVIDER_UAID',
      `Invalid ${fieldName}: "${trimmed}".`,
      `Use a standards-sdk HCS-14 UAID like "${EXAMPLE_PROVIDER_UAID}" or omit --provider-uaid to derive one from the provider wallet. Canonical spec: ${HCS14_CANONICAL_URL}`,
    );
  }
}
