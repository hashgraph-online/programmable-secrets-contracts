// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Test-only ERC-8004-style registry mock used by Foundry coverage.
/// @dev Production deployments point policies at an external IdentityRegistry address instead of deploying this contract.
contract AgentIdentityRegistry is ERC721URIStorage, Ownable {
    struct Agent {
        uint256 agentId;
        string agentDomain;
        address agentAddress;
    }

    uint256 public agentCount;

    mapping(uint256 => Agent) private agents;
    mapping(uint256 => mapping(bytes32 => bytes)) private metadataValues;

    event Registered(uint256 indexed agentId, string tokenURI, address indexed owner);
    event URIUpdated(uint256 indexed agentId, string newURI, address indexed owner);

    constructor(address initialOwner) ERC721("Programmable Secrets Agent Identity", "PSAI") Ownable(initialOwner) {}

    function registerAgent(string calldata agentDomain, string calldata agentUri) external returns (uint256 agentId) {
        agentId = ++agentCount;
        agents[agentId] = Agent({agentId: agentId, agentDomain: agentDomain, agentAddress: msg.sender});
        metadataValues[agentId][keccak256(bytes("agentDomain"))] = bytes(agentDomain);
        metadataValues[agentId][keccak256(bytes("agentAddress"))] = abi.encode(msg.sender);
        _mint(msg.sender, agentId);
        _setTokenURI(agentId, agentUri);
        emit Registered(agentId, agentUri, msg.sender);
    }

    function setAgentUri(uint256 agentId, string calldata newUri) public {
        _requireOwned(agentId);
        require(ownerOf(agentId) == msg.sender, "not agent owner");
        _setTokenURI(agentId, newUri);
        emit URIUpdated(agentId, newUri, msg.sender);
    }

    function setAgentURI(uint256 agentId, string calldata newURI) external {
        setAgentUri(agentId, newURI);
    }

    function getAgent(uint256 agentId) external view returns (uint256, string memory, address) {
        Agent memory agent = agents[agentId];
        return (agent.agentId, agent.agentDomain, agent.agentAddress);
    }

    function getAgentCount() external view returns (uint256) {
        return agentCount;
    }

    function getMetadata(uint256 agentId, string calldata key) external view returns (bytes memory) {
        _requireOwned(agentId);
        return metadataValues[agentId][keccak256(bytes(key))];
    }
}
