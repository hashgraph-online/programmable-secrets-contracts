// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {AccessReceiptEvents} from "./Events.sol";
import {AlreadyHasReceipt, InvalidModuleAddress, NotPaymentModule, ReceiptNonTransferable} from "./Errors.sol";

contract AccessReceipt is ERC721, Ownable2Step, AccessReceiptEvents {
    struct Receipt {
        uint256 policyId;
        address buyer;
        address recipient;
        address paymentToken;
        uint96 price;
        uint64 purchasedAt;
        bytes32 ciphertextHash;
        bytes32 keyCommitment;
    }

    uint256 public receiptCount;
    address public paymentModule;

    mapping(uint256 => Receipt) private receipts;
    mapping(uint256 => mapping(address => uint256)) private receiptIdsByPolicyAndBuyer;

    constructor(address initialOwner) ERC721("Programmable Secrets Access Receipt", "PSAR") Ownable(initialOwner) {}

    modifier onlyPaymentModule() {
        _onlyPaymentModule();
        _;
    }

    function setPaymentModule(address newPaymentModule) external onlyOwner {
        if (newPaymentModule == address(0)) {
            revert InvalidModuleAddress();
        }
        paymentModule = newPaymentModule;
        emit PaymentModuleUpdated(newPaymentModule);
    }

    function mintReceipt(
        address buyer,
        address recipient,
        uint256 policyId,
        address paymentToken,
        uint96 price,
        uint64 purchasedAt,
        bytes32 ciphertextHash,
        bytes32 keyCommitment
    ) external onlyPaymentModule returns (uint256 receiptTokenId) {
        if (receiptIdsByPolicyAndBuyer[policyId][buyer] != 0) {
            revert AlreadyHasReceipt();
        }

        receiptTokenId = ++receiptCount;
        _safeMint(buyer, receiptTokenId);

        receipts[receiptTokenId] = Receipt({
            policyId: policyId,
            buyer: buyer,
            recipient: recipient,
            paymentToken: paymentToken,
            price: price,
            purchasedAt: purchasedAt,
            ciphertextHash: ciphertextHash,
            keyCommitment: keyCommitment
        });
        receiptIdsByPolicyAndBuyer[policyId][buyer] = receiptTokenId;

        emit ReceiptMinted(
            receiptTokenId, policyId, buyer, recipient, paymentToken, price, purchasedAt, ciphertextHash, keyCommitment
        );
    }

    function hasAccess(uint256 policyId, address buyer) external view returns (bool) {
        return receiptIdsByPolicyAndBuyer[policyId][buyer] != 0;
    }

    function receiptOfPolicyAndBuyer(uint256 policyId, address buyer) external view returns (uint256) {
        return receiptIdsByPolicyAndBuyer[policyId][buyer];
    }

    function getReceipt(uint256 receiptTokenId) external view returns (Receipt memory) {
        if (_ownerOf(receiptTokenId) == address(0)) {
            revert ERC721NonexistentToken(receiptTokenId);
        }
        return receipts[receiptTokenId];
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            revert ReceiptNonTransferable();
        }
        return super._update(to, tokenId, auth);
    }

    function _onlyPaymentModule() internal view {
        if (msg.sender != paymentModule) {
            revert NotPaymentModule();
        }
    }
}
