// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPolicyCondition} from "./IPolicyCondition.sol";
import {InvalidExpiry} from "./Errors.sol";

contract TimeRangeCondition is IPolicyCondition {
    struct TimeRangeConfig {
        uint64 notBefore;
        uint64 notAfter;
    }

    function validateCondition(address, address, uint256, bytes calldata configData) external view override {
        TimeRangeConfig memory config = abi.decode(configData, (TimeRangeConfig));
        if (config.notAfter != 0 && config.notAfter <= block.timestamp) {
            revert InvalidExpiry();
        }
        if (config.notAfter != 0 && config.notBefore != 0 && config.notAfter <= config.notBefore) {
            revert InvalidExpiry();
        }
    }

    function isPurchaseAllowed(address, uint256, address, address, bytes calldata configData, bytes calldata)
        external
        view
        override
        returns (bool)
    {
        TimeRangeConfig memory config = abi.decode(configData, (TimeRangeConfig));
        if (config.notBefore != 0 && block.timestamp < config.notBefore) {
            return false;
        }
        if (config.notAfter != 0 && block.timestamp >= config.notAfter) {
            return false;
        }
        return true;
    }
}
