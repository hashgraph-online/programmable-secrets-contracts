#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]
extern crate alloc;

use alloc::vec::Vec;
use stylus_sdk::{
    abi::Bytes,
    alloy_primitives::{Address, B256, U256},
    alloy_sol_types::{sol, SolError, SolValue},
    call::static_call,
    crypto,
    prelude::*,
    stylus_core::calls::Call,
};

const MAX_COMMITTEE_MEMBERS: usize = 32;
const PERSONAL_SIGN_PREFIX: &[u8] = b"\x19Ethereum Signed Message:\n32";

sol! {
    error InvalidCommitteeConfig();
    error InvalidCommitteeDeadline();
    error InvalidCommitteeMember();
    error InvalidCommitteeThreshold();

    struct ThresholdCommitteeConfig {
        bytes32 policyContextHash;
        uint64 maxDeadline;
        uint8 threshold;
        address[] committee;
    }

    struct ThresholdCommitteeRuntime {
        uint64 deadline;
        bytes[] signatures;
    }

    struct ThresholdCommitteeAttestation {
        bytes32 typehash;
        address evaluator;
        address policyVault;
        uint256 chainId;
        uint256 policyId;
        address buyer;
        address recipient;
        bytes32 policyContextHash;
        uint64 deadline;
    }
}

sol_storage! {
    #[entrypoint]
    pub struct ThresholdCommitteeCondition {
        uint8 storage_marker;
    }
}

#[public]
impl ThresholdCommitteeCondition {
    pub fn version(&self) -> Result<U256, Vec<u8>> {
        Ok(U256::from(1))
    }

    pub fn validate_condition(
        &self,
        _policy_vault: Address,
        _provider: Address,
        _dataset_id: U256,
        config_data: Bytes,
    ) -> Result<(), Vec<u8>> {
        let config = Self::decode_config(config_data.as_ref())?;
        Self::validate_config(&config)
    }

    pub fn is_purchase_allowed(
        &self,
        policy_vault: Address,
        policy_id: U256,
        buyer: Address,
        recipient: Address,
        config_data: Bytes,
        runtime_data: Bytes,
    ) -> Result<bool, Vec<u8>> {
        let config = match Self::decode_config(config_data.as_ref()) {
            Ok(config) => config,
            Err(_) => return Ok(false),
        };
        if Self::validate_config(&config).is_err() {
            return Ok(false);
        }

        let runtime = match Self::decode_runtime(runtime_data.as_ref()) {
            Some(runtime) => runtime,
            None => return Ok(false),
        };
        if runtime.deadline == 0 || runtime.deadline > config.maxDeadline {
            return Ok(false);
        }
        if self.vm().block_timestamp() >= runtime.deadline {
            return Ok(false);
        }

        let required_signatures = usize::from(config.threshold);
        if runtime.signatures.len() < required_signatures
            || runtime.signatures.len() > config.committee.len()
        {
            return Ok(false);
        }

        let message_hash = self.attestation_message_hash(
            policy_vault,
            policy_id,
            buyer,
            recipient,
            config.policyContextHash,
            runtime.deadline,
        );
        let eth_signed_hash = Self::eth_personal_message_hash(message_hash);
        let mut recovered_signers = Vec::with_capacity(runtime.signatures.len());

        for signature in runtime.signatures.iter() {
            let recovered_signer = match self.recover_signer(eth_signed_hash, signature.as_ref()) {
                Some(signer) => signer,
                None => return Ok(false),
            };
            recovered_signers.push(recovered_signer);
        }

        Ok(Self::has_valid_quorum(
            config.committee.as_slice(),
            required_signatures,
            recovered_signers.as_slice(),
        ))
    }
}

impl ThresholdCommitteeCondition {
    fn decode_config(config_data: &[u8]) -> Result<ThresholdCommitteeConfig, Vec<u8>> {
        <ThresholdCommitteeConfig as SolValue>::abi_decode_params_validate(config_data)
            .map_err(|_| InvalidCommitteeConfig {}.abi_encode())
    }

    fn decode_runtime(runtime_data: &[u8]) -> Option<ThresholdCommitteeRuntime> {
        <ThresholdCommitteeRuntime as SolValue>::abi_decode_params_validate(runtime_data).ok()
    }

    fn validate_config(config: &ThresholdCommitteeConfig) -> Result<(), Vec<u8>> {
        if config.policyContextHash == B256::ZERO {
            return Err(InvalidCommitteeConfig {}.abi_encode());
        }
        if config.maxDeadline == 0 {
            return Err(InvalidCommitteeDeadline {}.abi_encode());
        }
        if config.committee.is_empty() || config.committee.len() > MAX_COMMITTEE_MEMBERS {
            return Err(InvalidCommitteeMember {}.abi_encode());
        }
        if config.threshold == 0 || usize::from(config.threshold) > config.committee.len() {
            return Err(InvalidCommitteeThreshold {}.abi_encode());
        }

        let mut previous = Address::ZERO;
        for (index, member) in config.committee.iter().enumerate() {
            if *member == Address::ZERO {
                return Err(InvalidCommitteeMember {}.abi_encode());
            }
            if index > 0 && *member <= previous {
                return Err(InvalidCommitteeMember {}.abi_encode());
            }
            previous = *member;
        }

        Ok(())
    }

    fn attestation_typehash() -> B256 {
        crypto::keccak(
            "ThresholdCommitteeAttestation(address evaluator,address policyVault,uint256 chainId,uint256 policyId,address buyer,address recipient,bytes32 policyContextHash,uint64 deadline)",
        )
    }

    fn attestation_message_hash(
        &self,
        policy_vault: Address,
        policy_id: U256,
        buyer: Address,
        recipient: Address,
        policy_context_hash: B256,
        deadline: u64,
    ) -> B256 {
        Self::attestation_message_hash_for_values(ThresholdCommitteeAttestation {
            typehash: Self::attestation_typehash(),
            evaluator: self.vm().contract_address(),
            policyVault: policy_vault,
            chainId: U256::from(self.vm().chain_id()),
            policyId: policy_id,
            buyer,
            recipient,
            policyContextHash: policy_context_hash,
            deadline,
        })
    }

    fn eth_personal_message_hash(message_hash: B256) -> B256 {
        let mut payload = Vec::with_capacity(PERSONAL_SIGN_PREFIX.len() + 32);
        payload.extend_from_slice(PERSONAL_SIGN_PREFIX);
        payload.extend_from_slice(message_hash.as_slice());
        crypto::keccak(payload)
    }

    fn recover_signer(&self, digest: B256, signature: &[u8]) -> Option<Address> {
        if signature.len() != 65 {
            return None;
        }

        let mut v = signature[64];
        if v == 0 || v == 1 {
            v += 27;
        }
        if v != 27 && v != 28 {
            return None;
        }

        let mut input = [0u8; 128];
        input[..32].copy_from_slice(digest.as_slice());
        input[63] = v;
        input[64..96].copy_from_slice(&signature[..32]);
        input[96..128].copy_from_slice(&signature[32..64]);

        let precompile = Self::ecrecover_precompile();
        let output = static_call(self.vm(), Call::new(), precompile, &input).ok()?;
        if output.len() != 32 {
            return None;
        }

        let mut address_bytes = [0u8; 20];
        address_bytes.copy_from_slice(&output[12..32]);
        let signer = Address::from(address_bytes);
        if signer == Address::ZERO {
            return None;
        }
        Some(signer)
    }

    fn attestation_message_hash_for_values(payload: ThresholdCommitteeAttestation) -> B256 {
        crypto::keccak(payload.abi_encode())
    }

    fn has_valid_quorum(
        committee: &[Address],
        required_signatures: usize,
        recovered_signers: &[Address],
    ) -> bool {
        if recovered_signers.len() < required_signatures
            || recovered_signers.len() > committee.len()
        {
            return false;
        }

        let mut committee_index = 0usize;
        let mut previous_signer = Address::ZERO;

        for (index, signer) in recovered_signers.iter().enumerate() {
            if index > 0 && *signer <= previous_signer {
                return false;
            }

            while committee_index < committee.len() && committee[committee_index] < *signer {
                committee_index += 1;
            }
            if committee_index == committee.len() || committee[committee_index] != *signer {
                return false;
            }

            previous_signer = *signer;
            committee_index += 1;
        }

        true
    }

    fn ecrecover_precompile() -> Address {
        let mut raw = [0u8; 20];
        raw[19] = 1;
        Address::from(raw)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_config(
        policy_context_hash: B256,
        max_deadline: u64,
        threshold: u8,
        committee: Vec<Address>,
    ) -> Vec<u8> {
        ThresholdCommitteeConfig {
            policyContextHash: policy_context_hash,
            maxDeadline: max_deadline,
            threshold,
            committee,
        }
        .abi_encode_params()
    }

    #[test]
    fn validate_condition_rejects_unsorted_committee() {
        let committee = vec![Address::from([2u8; 20]), Address::from([1u8; 20])];
        let result = ThresholdCommitteeCondition::decode_config(&build_config(
            crypto::keccak("ctx"),
            100,
            1,
            committee,
        ))
        .and_then(|config| ThresholdCommitteeCondition::validate_config(&config));

        assert!(result.is_err());
    }

    #[test]
    fn quorum_check_accepts_sorted_threshold() {
        let committee = vec![
            Address::from([1u8; 20]),
            Address::from([2u8; 20]),
            Address::from([3u8; 20]),
        ];
        let recovered_signers = vec![committee[0], committee[1]];
        let allowed =
            ThresholdCommitteeCondition::has_valid_quorum(&committee, 2, &recovered_signers);
        assert!(allowed);
    }

    #[test]
    fn quorum_check_rejects_duplicate_or_unknown_signers() {
        let committee = vec![Address::from([1u8; 20]), Address::from([2u8; 20])];
        let duplicate_signers = vec![committee[0], committee[0]];
        let unknown_signers = vec![committee[0], Address::from([9u8; 20])];

        assert!(!ThresholdCommitteeCondition::has_valid_quorum(
            &committee,
            2,
            &duplicate_signers
        ));
        assert!(!ThresholdCommitteeCondition::has_valid_quorum(
            &committee,
            2,
            &unknown_signers
        ));
    }

    #[test]
    fn attestation_message_hash_changes_when_context_changes() {
        let hash_one = ThresholdCommitteeCondition::attestation_message_hash_for_values(
            ThresholdCommitteeAttestation {
                typehash: ThresholdCommitteeCondition::attestation_typehash(),
                evaluator: Address::from([1u8; 20]),
                policyVault: Address::from([2u8; 20]),
                chainId: U256::from(46630u64),
                policyId: U256::from(8),
                buyer: Address::from([3u8; 20]),
                recipient: Address::from([4u8; 20]),
                policyContextHash: crypto::keccak("ctx-1"),
                deadline: 100,
            },
        );
        let hash_two = ThresholdCommitteeCondition::attestation_message_hash_for_values(
            ThresholdCommitteeAttestation {
                typehash: ThresholdCommitteeCondition::attestation_typehash(),
                evaluator: Address::from([1u8; 20]),
                policyVault: Address::from([2u8; 20]),
                chainId: U256::from(46630u64),
                policyId: U256::from(8),
                buyer: Address::from([3u8; 20]),
                recipient: Address::from([4u8; 20]),
                policyContextHash: crypto::keccak("ctx-2"),
                deadline: 100,
            },
        );

        assert_ne!(hash_one, hash_two);
    }
}
