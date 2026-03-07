// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPolicyCondition} from "./IPolicyCondition.sol";

contract AddressAllowlistCondition is IPolicyCondition {
    function validateCondition(address, address, uint256, bytes calldata configData) external pure override {
        address[] memory allowlistedAccounts = abi.decode(configData, (address[]));
        if (allowlistedAccounts.length == 0) {
            revert("empty_allowlist");
        }
    }

    function isPurchaseAllowed(address, uint256, address buyer, address, bytes calldata configData, bytes calldata)
        external
        pure
        override
        returns (bool)
    {
        address[] memory allowlistedAccounts = abi.decode(configData, (address[]));
        uint256 accountCount = allowlistedAccounts.length;
        for (uint256 index = 0; index < accountCount; ++index) {
            if (allowlistedAccounts[index] == buyer) {
                return true;
            }
        }
        return false;
    }
}
