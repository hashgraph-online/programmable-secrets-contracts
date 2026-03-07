// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPolicyCondition} from "./IPolicyCondition.sol";
import {AllowlistTooLarge, EmptyAllowlist} from "./Errors.sol";

contract AddressAllowlistCondition is IPolicyCondition {
    uint256 public constant MAX_ALLOWLIST_ENTRIES = 512;

    function validateCondition(address, address, uint256, bytes calldata configData) external pure override {
        address[] memory allowlistedAccounts = abi.decode(configData, (address[]));
        uint256 accountCount = allowlistedAccounts.length;
        if (accountCount == 0) {
            revert EmptyAllowlist();
        }
        if (accountCount > MAX_ALLOWLIST_ENTRIES) {
            revert AllowlistTooLarge(accountCount, MAX_ALLOWLIST_ENTRIES);
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
        if (accountCount > MAX_ALLOWLIST_ENTRIES) {
            return false;
        }

        for (uint256 index = 0; index < accountCount; ++index) {
            if (allowlistedAccounts[index] == buyer) {
                return true;
            }
        }
        return false;
    }
}
