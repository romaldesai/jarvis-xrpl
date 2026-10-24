// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IParticipantRegistry} from "./interfaces/IParticipantRegistry.sol";

/// @title ParticipantRegistry
/// @notice Only KYA-verified agents may transact. Each agent is bound to one merchant payout address.
///         Spec-compatible stand-in for the official Mastercard AP4M registry.
contract ParticipantRegistry is Ownable, IParticipantRegistry {
    struct Participant {
        bool verified;
        address payout;
        bytes32 kyaRef;
    }

    mapping(address => Participant) public participants;

    error ZeroAddress();

    constructor(address admin) Ownable(admin) {}

    function register(address agent, address payout, bytes32 kyaRef) external onlyOwner {
        if (agent == address(0) || payout == address(0)) revert ZeroAddress();
        participants[agent] = Participant({verified: true, payout: payout, kyaRef: kyaRef});
        emit ParticipantRegistered(agent, payout, kyaRef);
    }

    function revoke(address agent) external onlyOwner {
        participants[agent].verified = false;
        emit ParticipantRevoked(agent);
    }

    function isVerified(address agent) external view returns (bool) {
        return participants[agent].verified;
    }

    function payoutOf(address agent) external view returns (address) {
        return participants[agent].payout;
    }
}
