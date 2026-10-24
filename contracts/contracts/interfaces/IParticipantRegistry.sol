// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice KYA (Know Your Agent) registry interface, AP4M-spec compatible.
interface IParticipantRegistry {
    event ParticipantRegistered(address indexed agent, address indexed payout, bytes32 kyaRef);
    event ParticipantRevoked(address indexed agent);

    function isVerified(address agent) external view returns (bool);
    function payoutOf(address agent) external view returns (address);
}
