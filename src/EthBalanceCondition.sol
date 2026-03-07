// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPolicyCondition} from "./IPolicyCondition.sol";

error InvalidMinimumBalance();

contract EthBalanceCondition is IPolicyCondition {
    function validateCondition(address, address, uint256, bytes calldata configData) external pure override {
        uint256 minimumBalanceWei = abi.decode(configData, (uint256));
        if (minimumBalanceWei == 0) {
            revert InvalidMinimumBalance();
        }
    }

    function isPurchaseAllowed(address, uint256, address buyer, address, bytes calldata configData, bytes calldata)
        external
        view
        override
        returns (bool)
    {
        uint256 minimumBalanceWei = abi.decode(configData, (uint256));
        return buyer.balance >= minimumBalanceWei;
    }
}
