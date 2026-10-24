// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IParticipantRegistry} from "./interfaces/IParticipantRegistry.sol";
import {IPaymentLedger} from "./interfaces/IPaymentLedger.sol";

/// @title PaymentLedger
/// @notice Funded agent spending limit (ASL). A funder locks `cap` RLUSD for a KYA-verified agent.
///         The agent signs EIP-712 vouchers carrying a cumulative amount; anyone may redeem them.
///         settle() pays (redeemed - settled) to the payout address bound in the registry.
///         Invariant: settled <= redeemed <= cap.
contract PaymentLedger is IPaymentLedger, EIP712, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant VOUCHER_TYPEHASH =
        keccak256("Voucher(uint256 channelId,uint256 cumulativeAmount,uint256 nonce,uint256 deadline,bytes32 ref)");

    struct Channel {
        address funder;
        address agent;
        address payout;
        uint256 cap;
        uint256 redeemed;
        uint256 settled;
        uint256 lastNonce;
        bool closed;
    }

    IERC20 public immutable token;
    IParticipantRegistry public immutable registry;
    uint256 public nextChannelId = 1;
    mapping(uint256 => Channel) public channels;

    error AgentNotVerified();
    error NoPayout();
    error ZeroCap();
    error UnknownChannel();
    error ChannelIsClosed();
    error BadSignature();
    error NonMonotonic();
    error OverCap();
    error Expired();
    error NonceUsed();
    error NotFunder();

    constructor(IERC20 token_, IParticipantRegistry registry_, address admin)
        EIP712("AP4M PaymentLedger", "1")
        Ownable(admin)
    {
        token = token_;
        registry = registry_;
    }

    /// @notice Lock `cap` tokens in escrow for `agent`. KYA is checked here.
    function openChannel(address agent, uint256 cap) external whenNotPaused nonReentrant returns (uint256 channelId) {
        if (cap == 0) revert ZeroCap();
        if (!registry.isVerified(agent)) revert AgentNotVerified();
        address payout = registry.payoutOf(agent);
        if (payout == address(0)) revert NoPayout();

        channelId = nextChannelId++;
        channels[channelId] = Channel({
            funder: msg.sender,
            agent: agent,
            payout: payout,
            cap: cap,
            redeemed: 0,
            settled: 0,
            lastNonce: 0,
            closed: false
        });
        token.safeTransferFrom(msg.sender, address(this), cap);
        emit ChannelOpened(channelId, msg.sender, agent, payout, cap);
    }

    function hashVoucher(Voucher calldata v) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(VOUCHER_TYPEHASH, v.channelId, v.cumulativeAmount, v.nonce, v.deadline, v.ref)));
    }

    /// @notice Verify the agent's signature and advance the redeemed watermark.
    /// Rejects: unknown/closed channel, expired, bad/wrong-chain signature, replayed nonce,
    /// non-monotonic amount, over-cap, revoked agent.
    function redeemVoucher(Voucher calldata v, bytes calldata signature) external whenNotPaused {
        Channel storage c = channels[v.channelId];
        if (c.agent == address(0)) revert UnknownChannel();
        if (c.closed) revert ChannelIsClosed();
        if (block.timestamp > v.deadline) revert Expired();
        if (ECDSA.recover(hashVoucher(v), signature) != c.agent) revert BadSignature();
        if (v.nonce <= c.lastNonce) revert NonceUsed();
        if (v.cumulativeAmount <= c.redeemed) revert NonMonotonic();
        if (v.cumulativeAmount > c.cap) revert OverCap();
        // Agent may be revoked after the channel opened: stop new redemptions immediately.
        if (!registry.isVerified(c.agent)) revert AgentNotVerified();

        uint256 delta = v.cumulativeAmount - c.redeemed;
        c.redeemed = v.cumulativeAmount;
        c.lastNonce = v.nonce;
        emit VoucherRedeemed(v.channelId, v.cumulativeAmount, delta, v.nonce, v.ref);
    }

    /// @notice Pay (redeemed - settled) to the bound payout address.
    function settle(uint256 channelId) public whenNotPaused nonReentrant returns (uint256 paid) {
        paid = _settle(channelId);
    }

    /// @notice Funder closes the channel: settles what was redeemed, refunds the rest.
    function closeChannel(uint256 channelId) external nonReentrant {
        Channel storage c = channels[channelId];
        if (c.agent == address(0)) revert UnknownChannel();
        if (msg.sender != c.funder) revert NotFunder();
        if (c.closed) revert ChannelIsClosed();
        _settle(channelId);
        c.closed = true;
        uint256 refund = c.cap - c.settled;
        if (refund > 0) token.safeTransfer(c.funder, refund);
        emit ChannelClosed(channelId, refund);
    }

    function remaining(uint256 channelId) external view returns (uint256) {
        Channel storage c = channels[channelId];
        return c.cap - c.redeemed;
    }

    /// @notice Ledger-side kill switch.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _settle(uint256 channelId) internal returns (uint256 paid) {
        Channel storage c = channels[channelId];
        if (c.agent == address(0)) revert UnknownChannel();
        paid = c.redeemed - c.settled;
        c.settled = c.redeemed;
        if (paid > 0) {
            token.safeTransfer(c.payout, paid);
            emit ClaimPaid(channelId, c.payout, paid);
        }
        emit SettlementRecorded(channelId, c.settled, c.redeemed);
    }
}
