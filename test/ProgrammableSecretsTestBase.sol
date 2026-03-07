// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ProgrammableSecrets} from "../src/ProgrammableSecrets.sol";

abstract contract ProgrammableSecretsTestBase is Test {
    address internal constant UPGRADE_OWNER = address(0xABCD);
    address internal constant PROVIDER = address(0xA11CE);
    address internal constant PAYOUT = address(0xBEEF);
    address internal constant BUYER = address(0xCAFE);
    address internal constant RECIPIENT = address(0xD00D);

    bytes32 internal constant CIPHERTEXT_HASH = keccak256("ciphertext");
    bytes32 internal constant KEY_COMMITMENT = keccak256("content-key");
    bytes32 internal constant METADATA_HASH = keccak256("metadata");
    bytes32 internal constant PROVIDER_UAID_HASH = keccak256("uaid");

    ProgrammableSecrets internal programmableSecrets;
    ProgrammableSecrets internal implementation;
    ERC1967Proxy internal proxy;

    function setUp() public virtual {
        implementation = new ProgrammableSecrets();
        proxy =
            new ERC1967Proxy(address(implementation), abi.encodeCall(ProgrammableSecrets.initialize, (UPGRADE_OWNER)));
        programmableSecrets = ProgrammableSecrets(address(proxy));
        vm.deal(BUYER, 100 ether);
    }

    function _createOffer(uint96 price, uint64 expiresAt, bool active) internal returns (uint256 offerId) {
        vm.prank(PROVIDER);
        offerId = programmableSecrets.createOffer(
            PAYOUT, address(0), price, expiresAt, CIPHERTEXT_HASH, KEY_COMMITMENT, METADATA_HASH, PROVIDER_UAID_HASH
        );

        if (!active) {
            vm.prank(PROVIDER);
            programmableSecrets.updateOffer(offerId, price, expiresAt, false, METADATA_HASH);
        }
    }

    function _createOfferForPayout(address payout, uint96 price, uint64 expiresAt) internal returns (uint256 offerId) {
        vm.prank(PROVIDER);
        offerId = programmableSecrets.createOffer(
            payout, address(0), price, expiresAt, CIPHERTEXT_HASH, KEY_COMMITMENT, METADATA_HASH, PROVIDER_UAID_HASH
        );
    }
}
