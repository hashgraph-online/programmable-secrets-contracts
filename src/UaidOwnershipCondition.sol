// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IIdentityRegistry} from "./IIdentityRegistry.sol";
import {IPolicyCondition} from "./IPolicyCondition.sol";
import {AgentIdentityNotFound, InvalidAgentId, InvalidIdentityRegistry, InvalidRequiredBuyerUaid} from "./Errors.sol";

contract UaidOwnershipCondition is IPolicyCondition {
    struct UaidOwnershipConfig {
        bytes32 requiredBuyerUaidHash;
        address identityRegistry;
        uint256 agentId;
    }

    function validateCondition(address, address, uint256, bytes calldata configData) external view override {
        UaidOwnershipConfig memory config = abi.decode(configData, (UaidOwnershipConfig));
        if (config.requiredBuyerUaidHash == bytes32(0)) {
            revert InvalidRequiredBuyerUaid();
        }
        if (config.identityRegistry == address(0)) {
            revert InvalidIdentityRegistry();
        }
        if (config.agentId == 0) {
            revert InvalidAgentId();
        }
        try IIdentityRegistry(config.identityRegistry).ownerOf(config.agentId) returns (address owner) {
            if (owner == address(0)) {
                revert AgentIdentityNotFound();
            }
        } catch {
            revert AgentIdentityNotFound();
        }
    }

    function isPurchaseAllowed(
        address,
        uint256,
        address buyer,
        address,
        bytes calldata configData,
        bytes calldata runtimeData
    ) external view override returns (bool) {
        if (runtimeData.length == 0) {
            return false;
        }

        UaidOwnershipConfig memory config = abi.decode(configData, (UaidOwnershipConfig));
        string memory buyerUaid = abi.decode(runtimeData, (string));
        if (keccak256(bytes(buyerUaid)) != config.requiredBuyerUaidHash) {
            return false;
        }

        return IIdentityRegistry(config.identityRegistry).ownerOf(config.agentId) == buyer;
    }
}
