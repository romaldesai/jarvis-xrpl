// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice AP4M PaymentLedger interface: funded channel, EIP-712 vouchers, settlement.
interface IPaymentLedger {
    struct Voucher {
        uint256 channelId;
        uint256 cumulativeAmount; // total redeemable so far (monotonic watermark)
        uint256 nonce; // strictly increasing per channel (replay protection)
        uint256 deadline; // unix seconds; required, voucher invalid after it
        bytes32 ref; // off-chain payment reference (hash), for audit correlation
    }

    event ChannelOpened(uint256 indexed channelId, address indexed funder, address indexed agent, address payout, uint256 cap);
    event VoucherRedeemed(uint256 indexed channelId, uint256 cumulativeAmount, uint256 delta, uint256 nonce, bytes32 ref);
    event ClaimPaid(uint256 indexed channelId, address indexed payout, uint256 amount);
    event SettlementRecorded(uint256 indexed channelId, uint256 settled, uint256 redeemed);
    event ChannelClosed(uint256 indexed channelId, uint256 refunded);

    function openChannel(address agent, uint256 cap) external returns (uint256 channelId);
    function redeemVoucher(Voucher calldata v, bytes calldata signature) external;
    function settle(uint256 channelId) external returns (uint256 paid);
}
