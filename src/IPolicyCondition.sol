// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPolicyCondition {
    function validateCondition(address policyVault, address provider, uint256 datasetId, bytes calldata configData)
        external
        view;

    function isPurchaseAllowed(
        address policyVault,
        uint256 policyId,
        address buyer,
        address recipient,
        bytes calldata configData,
        bytes calldata runtimeData
    ) external view returns (bool);
}
