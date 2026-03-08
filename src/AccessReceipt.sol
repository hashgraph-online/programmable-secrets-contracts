// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {AccessReceiptEvents} from "./Events.sol";
import {
    AlreadyHasReceipt,
    InvalidModuleAddress,
    NotPaymentModule,
    ReceiptHolderAlreadyHasAccess,
    ReceiptNonTransferable
} from "./Errors.sol";

contract AccessReceipt is ERC721, Ownable2Step, AccessReceiptEvents {
    string internal constant RECEIPT_METADATA_URI =
        "ipfs://bafkreibw3osbcrk7w522tcjuz5a4ihffd3bfbjkwmfso5esxyfml2cfal4";

    struct Receipt {
        uint256 policyId;
        uint256 datasetId;
        address buyer;
        address recipient;
        address paymentToken;
        uint96 price;
        uint64 purchasedAt;
        bool receiptTransferable;
        bytes32 ciphertextHash;
        bytes32 keyCommitment;
    }

    uint256 public receiptCount;
    address public paymentModule;

    mapping(uint256 => Receipt) private receipts;
    mapping(uint256 => mapping(address => uint256)) private receiptIdsByPolicyAndHolder;
    mapping(uint256 => mapping(address => uint256)) private receiptIdsByDatasetAndHolder;

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
        uint256 datasetId,
        address paymentToken,
        uint96 price,
        uint64 purchasedAt,
        bool receiptTransferable,
        bytes32 ciphertextHash,
        bytes32 keyCommitment
    ) external onlyPaymentModule returns (uint256 receiptTokenId) {
        if (receiptIdsByPolicyAndHolder[policyId][buyer] != 0) {
            revert AlreadyHasReceipt();
        }

        receiptTokenId = ++receiptCount;
        receipts[receiptTokenId] = Receipt({
            policyId: policyId,
            datasetId: datasetId,
            buyer: buyer,
            recipient: recipient,
            paymentToken: paymentToken,
            price: price,
            purchasedAt: purchasedAt,
            receiptTransferable: receiptTransferable,
            ciphertextHash: ciphertextHash,
            keyCommitment: keyCommitment
        });

        emit ReceiptMinted(
            receiptTokenId,
            policyId,
            datasetId,
            buyer,
            recipient,
            paymentToken,
            price,
            purchasedAt,
            receiptTransferable,
            ciphertextHash,
            keyCommitment
        );

        _safeMint(buyer, receiptTokenId);
    }

    function hasAccess(uint256 policyId, address buyer) external view returns (bool) {
        return receiptIdsByPolicyAndHolder[policyId][buyer] != 0;
    }

    function receiptOfPolicyAndBuyer(uint256 policyId, address buyer) external view returns (uint256) {
        return receiptIdsByPolicyAndHolder[policyId][buyer];
    }

    function receiptOfDatasetAndBuyer(uint256 datasetId, address buyer) external view returns (uint256) {
        return receiptIdsByDatasetAndHolder[datasetId][buyer];
    }

    function receiptOfPolicyAndHolder(uint256 policyId, address holder) external view returns (uint256) {
        return receiptIdsByPolicyAndHolder[policyId][holder];
    }

    function receiptOfDatasetAndHolder(uint256 datasetId, address holder) external view returns (uint256) {
        return receiptIdsByDatasetAndHolder[datasetId][holder];
    }

    function getReceipt(uint256 receiptTokenId) external view returns (Receipt memory) {
        if (_ownerOf(receiptTokenId) == address(0)) {
            revert ERC721NonexistentToken(receiptTokenId);
        }
        return receipts[receiptTokenId];
    }

    function tokenURI(uint256 receiptTokenId) public view override returns (string memory) {
        if (_ownerOf(receiptTokenId) == address(0)) {
            revert ERC721NonexistentToken(receiptTokenId);
        }
        return RECEIPT_METADATA_URI;
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        Receipt storage receipt = receipts[tokenId];

        if (from == address(0) && to != address(0)) {
            receiptIdsByPolicyAndHolder[receipt.policyId][to] = tokenId;
            receiptIdsByDatasetAndHolder[receipt.datasetId][to] = tokenId;
        } else if (from != address(0) && to == address(0)) {
            receiptIdsByPolicyAndHolder[receipt.policyId][from] = 0;
            receiptIdsByDatasetAndHolder[receipt.datasetId][from] = 0;
        } else if (from != address(0) && to != address(0)) {
            if (!receipt.receiptTransferable) {
                revert ReceiptNonTransferable();
            }
            if (
                receiptIdsByPolicyAndHolder[receipt.policyId][to] != 0
                    || receiptIdsByDatasetAndHolder[receipt.datasetId][to] != 0
            ) {
                revert ReceiptHolderAlreadyHasAccess();
            }
            receiptIdsByPolicyAndHolder[receipt.policyId][from] = 0;
            receiptIdsByDatasetAndHolder[receipt.datasetId][from] = 0;
            receiptIdsByPolicyAndHolder[receipt.policyId][to] = tokenId;
            receiptIdsByDatasetAndHolder[receipt.datasetId][to] = tokenId;
        }
        return super._update(to, tokenId, auth);
    }

    function _onlyPaymentModule() internal view {
        if (msg.sender != paymentModule) {
            revert NotPaymentModule();
        }
    }
}
