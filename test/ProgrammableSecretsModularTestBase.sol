// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {PolicyVault} from "../src/PolicyVault.sol";
import {PaymentModule} from "../src/PaymentModule.sol";
import {AccessReceipt} from "../src/AccessReceipt.sol";

abstract contract ProgrammableSecretsModularTestBase is Test {
    address internal constant UPGRADE_OWNER = address(0xABCD);
    address internal constant PROVIDER = address(0xA11CE);
    address internal constant PAYOUT = address(0xBEEF);
    address internal constant BUYER = address(0xCAFE);
    address internal constant RECIPIENT = address(0xD00D);
    address internal constant OTHER_BUYER = address(0xFEED);

    bytes32 internal constant CIPHERTEXT_HASH = keccak256("ciphertext");
    bytes32 internal constant KEY_COMMITMENT = keccak256("content-key");
    bytes32 internal constant METADATA_HASH = keccak256("dataset-metadata");
    bytes32 internal constant POLICY_METADATA_HASH = keccak256("policy-metadata");
    bytes32 internal constant PROVIDER_UAID_HASH = keccak256("uaid");

    PolicyVault internal policyVault;
    PaymentModule internal paymentModule;
    AccessReceipt internal accessReceipt;
    PolicyVault internal policyVaultImplementation;
    PaymentModule internal paymentModuleImplementation;
    ERC1967Proxy internal policyVaultProxy;
    ERC1967Proxy internal paymentModuleProxy;

    function setUp() public virtual {
        policyVaultImplementation = new PolicyVault();
        policyVaultProxy = new ERC1967Proxy(
            address(policyVaultImplementation), abi.encodeCall(PolicyVault.initialize, (UPGRADE_OWNER))
        );
        policyVault = PolicyVault(address(policyVaultProxy));

        accessReceipt = new AccessReceipt(UPGRADE_OWNER);

        paymentModuleImplementation = new PaymentModule();
        paymentModuleProxy = new ERC1967Proxy(
            address(paymentModuleImplementation),
            abi.encodeCall(PaymentModule.initialize, (UPGRADE_OWNER, address(policyVault), address(accessReceipt)))
        );
        paymentModule = PaymentModule(address(paymentModuleProxy));

        vm.prank(UPGRADE_OWNER);
        accessReceipt.setPaymentModule(address(paymentModule));

        vm.deal(BUYER, 100 ether);
        vm.deal(OTHER_BUYER, 100 ether);
    }

    function _createDatasetPolicy(uint96 price, uint64 expiresAt, bool allowlistEnabled)
        internal
        returns (uint256 policyId)
    {
        uint256 datasetId = _registerDataset();
        policyId = _createTimeboundPolicyForDataset(datasetId, price, expiresAt, allowlistEnabled);
    }

    function _registerDataset() internal returns (uint256 datasetId) {
        vm.prank(PROVIDER);
        datasetId = policyVault.registerDataset(CIPHERTEXT_HASH, KEY_COMMITMENT, METADATA_HASH, PROVIDER_UAID_HASH);
    }

    function _createTimeboundPolicyForDataset(uint256 datasetId, uint96 price, uint64 expiresAt, bool allowlistEnabled)
        internal
        returns (uint256 policyId)
    {
        address[] memory emptyAllowlist = new address[](0);
        vm.prank(PROVIDER);
        policyId = policyVault.createTimeboundPolicy(
            datasetId, PAYOUT, address(0), price, expiresAt, allowlistEnabled, POLICY_METADATA_HASH, emptyAllowlist
        );
    }

    function _createAllowlistedDatasetPolicy(address allowlistedBuyer, uint96 price, uint64 expiresAt)
        internal
        returns (uint256 policyId)
    {
        uint256 datasetId = _registerDataset();
        address[] memory allowlist = new address[](1);
        allowlist[0] = allowlistedBuyer;
        vm.prank(PROVIDER);
        policyId = policyVault.createTimeboundPolicy(
            datasetId, PAYOUT, address(0), price, expiresAt, true, POLICY_METADATA_HASH, allowlist
        );
    }
}
