// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {AgentIdentityRegistry} from "../src/AgentIdentityRegistry.sol";
import {AddressAllowlistCondition} from "../src/AddressAllowlistCondition.sol";
import {PolicyVault} from "../src/PolicyVault.sol";
import {PaymentModule} from "../src/PaymentModule.sol";
import {AccessReceipt} from "../src/AccessReceipt.sol";
import {TimeRangeCondition} from "../src/TimeRangeCondition.sol";
import {UaidOwnershipCondition} from "../src/UaidOwnershipCondition.sol";

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
    bytes32 internal constant TIME_RANGE_EVALUATOR_METADATA_HASH = keccak256("time-range-evaluator");
    bytes32 internal constant UAID_OWNERSHIP_EVALUATOR_METADATA_HASH = keccak256("uaid-ownership-evaluator");
    bytes32 internal constant ADDRESS_ALLOWLIST_EVALUATOR_METADATA_HASH = keccak256("address-allowlist-evaluator");
    string internal constant REQUIRED_BUYER_UAID =
        "uaid:aid:buyer-agent;uid=46630:1;registry=erc-8004;proto=erc-8004;nativeId=46630:1";

    PolicyVault internal policyVault;
    PaymentModule internal paymentModule;
    AccessReceipt internal accessReceipt;
    AgentIdentityRegistry internal agentIdentityRegistry;
    TimeRangeCondition internal timeRangeCondition;
    UaidOwnershipCondition internal uaidOwnershipCondition;
    AddressAllowlistCondition internal addressAllowlistCondition;
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
        agentIdentityRegistry = new AgentIdentityRegistry(UPGRADE_OWNER);
        timeRangeCondition = new TimeRangeCondition();
        uaidOwnershipCondition = new UaidOwnershipCondition();
        addressAllowlistCondition = new AddressAllowlistCondition();

        vm.prank(UPGRADE_OWNER);
        policyVault.registerBuiltInEvaluator(address(timeRangeCondition), TIME_RANGE_EVALUATOR_METADATA_HASH);
        vm.prank(UPGRADE_OWNER);
        policyVault.registerBuiltInEvaluator(address(uaidOwnershipCondition), UAID_OWNERSHIP_EVALUATOR_METADATA_HASH);
        vm.prank(UPGRADE_OWNER);
        policyVault.registerBuiltInEvaluator(
            address(addressAllowlistCondition), ADDRESS_ALLOWLIST_EVALUATOR_METADATA_HASH
        );

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
        policyId = _createTimeboundPolicyForDataset(datasetId, price, expiresAt, allowlistEnabled, false);
    }

    function _createTransferableDatasetPolicy(uint96 price, uint64 expiresAt, bool allowlistEnabled)
        internal
        returns (uint256 policyId)
    {
        uint256 datasetId = _registerDataset();
        policyId = _createTimeboundPolicyForDataset(datasetId, price, expiresAt, allowlistEnabled, true);
    }

    function _registerDataset() internal returns (uint256 datasetId) {
        vm.prank(PROVIDER);
        datasetId = policyVault.registerDataset(CIPHERTEXT_HASH, KEY_COMMITMENT, METADATA_HASH, PROVIDER_UAID_HASH);
    }

    function _createTimeboundPolicyForDataset(
        uint256 datasetId,
        uint96 price,
        uint64 expiresAt,
        bool allowlistEnabled,
        bool receiptTransferable
    ) internal returns (uint256 policyId) {
        PolicyVault.PolicyConditionInput[] memory conditions =
            _buildConditions(expiresAt, allowlistEnabled, address(0), REQUIRED_BUYER_UAID, 0);
        vm.prank(PROVIDER);
        policyId = policyVault.createPolicyForDataset(
            datasetId, PAYOUT, address(0), price, receiptTransferable, POLICY_METADATA_HASH, conditions
        );
    }

    function _createAllowlistedDatasetPolicy(address allowlistedBuyer, uint96 price, uint64 expiresAt)
        internal
        returns (uint256 policyId)
    {
        uint256 datasetId = _registerDataset();
        PolicyVault.PolicyConditionInput[] memory conditions =
            _buildConditions(expiresAt, true, allowlistedBuyer, REQUIRED_BUYER_UAID, 0);
        vm.prank(PROVIDER);
        policyId = policyVault.createPolicyForDataset(
            datasetId, PAYOUT, address(0), price, false, POLICY_METADATA_HASH, conditions
        );
    }

    function _registerBuyerAgent(address owner, string memory agentDomain) internal returns (uint256 agentId) {
        vm.prank(owner);
        agentId = agentIdentityRegistry.registerAgent(agentDomain, string.concat("ipfs://", agentDomain));
    }

    function _createUaidBoundPolicy(uint96 price, uint64 expiresAt, string memory requiredBuyerUaid, uint256 agentId)
        internal
        returns (uint256 policyId)
    {
        uint256 datasetId = _registerDataset();
        PolicyVault.PolicyConditionInput[] memory conditions =
            _buildConditions(expiresAt, false, address(0), requiredBuyerUaid, agentId);
        vm.prank(PROVIDER);
        policyId = policyVault.createPolicyForDataset(
            datasetId, PAYOUT, address(0), price, false, POLICY_METADATA_HASH, conditions
        );
    }

    function _buildConditions(
        uint64 expiresAt,
        bool includeAllowlist,
        address allowlistedBuyer,
        string memory requiredBuyerUaid,
        uint256 agentId
    ) internal view returns (PolicyVault.PolicyConditionInput[] memory conditions) {
        uint256 conditionCount = 0;
        if (expiresAt != 0) {
            conditionCount++;
        }
        if (includeAllowlist) {
            conditionCount++;
        }
        if (agentId != 0) {
            conditionCount++;
        }

        conditions = new PolicyVault.PolicyConditionInput[](conditionCount);
        uint256 nextIndex = 0;

        if (expiresAt != 0) {
            conditions[nextIndex] = PolicyVault.PolicyConditionInput({
                evaluator: address(timeRangeCondition),
                configData: abi.encode(TimeRangeCondition.TimeRangeConfig({notBefore: 0, notAfter: expiresAt}))
            });
            nextIndex++;
        }

        if (includeAllowlist) {
            address[] memory allowlist = new address[](1);
            allowlist[0] = allowlistedBuyer;
            conditions[nextIndex] = PolicyVault.PolicyConditionInput({
                evaluator: address(addressAllowlistCondition), configData: abi.encode(allowlist)
            });
            nextIndex++;
        }

        if (agentId != 0) {
            conditions[nextIndex] = PolicyVault.PolicyConditionInput({
                evaluator: address(uaidOwnershipCondition),
                configData: abi.encode(
                    UaidOwnershipCondition.UaidOwnershipConfig({
                        requiredBuyerUaidHash: keccak256(bytes(requiredBuyerUaid)),
                        identityRegistry: address(agentIdentityRegistry),
                        agentId: agentId
                    })
                )
            });
        }
    }

    function _emptyRuntimeInputs(uint256 length) internal pure returns (bytes[] memory runtimeInputs) {
        runtimeInputs = new bytes[](length);
    }

    function _runtimeInputsForUaid(uint256 conditionCount, uint256 uaidConditionIndex, string memory buyerUaid)
        internal
        pure
        returns (bytes[] memory runtimeInputs)
    {
        runtimeInputs = new bytes[](conditionCount);
        runtimeInputs[uaidConditionIndex] = abi.encode(buyerUaid);
    }

    function _assertPolicyConditionFailure(
        address buyer,
        uint256 policyId,
        address recipient,
        bytes[] memory runtimeInputs,
        uint256 value,
        uint256
    ) internal {
        vm.prank(buyer);
        (bool success,) = address(paymentModule).call{value: value}(
            abi.encodeCall(PaymentModule.purchase, (policyId, recipient, runtimeInputs))
        );

        assertTrue(!success);
    }
}
