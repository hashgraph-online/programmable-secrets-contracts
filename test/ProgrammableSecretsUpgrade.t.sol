// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ProgrammableSecrets} from "../src/ProgrammableSecrets.sol";
import {ProgrammableSecretsTestBase} from "./ProgrammableSecretsTestBase.sol";

contract ProgrammableSecretsV2 is ProgrammableSecrets {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract ProgrammableSecretsUpgradeTest is ProgrammableSecretsTestBase {
    function testProxyInitializesUpgradeOwner() public view {
        assertEqAddress(programmableSecrets.owner(), UPGRADE_OWNER);
    }

    function testImplementationInitializerIsLocked() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        implementation.initialize(UPGRADE_OWNER);
    }

    function testProxyRejectsSecondInitialization() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        programmableSecrets.initialize(UPGRADE_OWNER);
    }

    function testOnlyOwnerCanUpgrade() public {
        ProgrammableSecretsV2 v2Implementation = new ProgrammableSecretsV2();

        vm.prank(BUYER);
        (bool success,) = address(programmableSecrets)
            .call(abi.encodeCall(programmableSecrets.upgradeToAndCall, (address(v2Implementation), bytes(""))));

        assertTrue(!success);
    }

    function testOwnerCanUpgradeAndStatePersists() public {
        uint256 offerId = _createOffer(1 ether, uint64(block.timestamp + 1 days), true);

        vm.prank(BUYER);
        programmableSecrets.purchase{value: 1 ether}(offerId, RECIPIENT);

        ProgrammableSecretsV2 v2Implementation = new ProgrammableSecretsV2();

        vm.prank(UPGRADE_OWNER);
        programmableSecrets.upgradeToAndCall(address(v2Implementation), bytes(""));

        ProgrammableSecretsV2 upgraded = ProgrammableSecretsV2(address(programmableSecrets));
        ProgrammableSecrets.Offer memory offer = upgraded.getOffer(offerId);

        assertEqUint(upgraded.version(), uint256(2));
        assertEqAddress(upgraded.owner(), UPGRADE_OWNER);
        assertEqUint(upgraded.offerCount(), uint256(1));
        assertEqBool(upgraded.hasAccess(offerId, BUYER), true);
        assertEqUint64(upgraded.purchasedTimestamp(offerId, BUYER), upgraded.purchasedAt(offerId, BUYER));
        assertEqAddress(offer.provider, PROVIDER);
        assertEqAddress(offer.payout, PAYOUT);
        assertEqUint(uint256(offer.price), uint256(1 ether));
        assertEqBytes32(offer.ciphertextHash, CIPHERTEXT_HASH);
        assertEqBytes32(offer.keyCommitment, KEY_COMMITMENT);
        assertEqBytes32(offer.metadataHash, METADATA_HASH);
        assertEqBytes32(offer.providerUaidHash, PROVIDER_UAID_HASH);
    }
}
