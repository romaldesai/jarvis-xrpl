import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

const E = (n: string) => ethers.parseEther(n);
const REF = ethers.id("payment-1");

async function deploy() {
  const [admin, funder, agent, payout, stranger, relayer] = await ethers.getSigners();
  const token = await ethers.deployContract("MockRLUSD", [admin.address]);
  const registry = await ethers.deployContract("ParticipantRegistry", [admin.address]);
  const ledger = await ethers.deployContract("PaymentLedger", [
    await token.getAddress(),
    await registry.getAddress(),
    admin.address,
  ]);
  await registry.register(agent.address, payout.address, ethers.id("kya:agent-1"));
  await token.mint(funder.address, E("1000"));
  await token.connect(funder).approve(await ledger.getAddress(), ethers.MaxUint256);
  await ledger.connect(funder).openChannel(agent.address, E("100"));
  const channelId = 1n;

  const domain = {
    name: "AP4M PaymentLedger",
    version: "1",
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract: await ledger.getAddress(),
  };
  const types = {
    Voucher: [
      { name: "channelId", type: "uint256" },
      { name: "cumulativeAmount", type: "uint256" },
      { name: "ref", type: "bytes32" },
      { name: "expiry", type: "uint256" },
    ],
  };
  const sign = async (signer: typeof agent, cumulativeAmount: bigint, ref = REF, expiry = 0n, id = channelId) => {
    const v = { channelId: id, cumulativeAmount, ref, expiry };
    const sig = await signer.signTypedData(domain, types, v);
    return { v, sig };
  };
  return { admin, funder, agent, payout, stranger, relayer, token, registry, ledger, channelId, sign };
}

describe("ParticipantRegistry (KYA)", () => {
  it("only owner can register / revoke", async () => {
    const { registry, stranger, payout } = await loadFixture(deploy);
    await expect(registry.connect(stranger).register(stranger.address, payout.address, REF)).to.be.revertedWithCustomError(
      registry,
      "OwnableUnauthorizedAccount",
    );
    await expect(registry.connect(stranger).revoke(stranger.address)).to.be.revertedWithCustomError(
      registry,
      "OwnableUnauthorizedAccount",
    );
  });

  it("binds the payout address", async () => {
    const { registry, agent, payout } = await loadFixture(deploy);
    expect(await registry.isVerified(agent.address)).to.equal(true);
    expect(await registry.payoutOf(agent.address)).to.equal(payout.address);
  });
});

describe("PaymentLedger", () => {
  describe("openChannel", () => {
    it("rejects an unregistered agent", async () => {
      const { ledger, funder, stranger } = await loadFixture(deploy);
      await expect(ledger.connect(funder).openChannel(stranger.address, E("1"))).to.be.revertedWithCustomError(
        ledger,
        "AgentNotVerified",
      );
    });

    it("rejects a revoked agent", async () => {
      const { ledger, registry, funder, agent } = await loadFixture(deploy);
      await registry.revoke(agent.address);
      await expect(ledger.connect(funder).openChannel(agent.address, E("1"))).to.be.revertedWithCustomError(
        ledger,
        "AgentNotVerified",
      );
    });

    it("rejects zero cap", async () => {
      const { ledger, funder, agent } = await loadFixture(deploy);
      await expect(ledger.connect(funder).openChannel(agent.address, 0)).to.be.revertedWithCustomError(ledger, "ZeroCap");
    });

    it("locks the cap in escrow and records the bound payout", async () => {
      const { ledger, token, funder, agent, payout } = await loadFixture(deploy);
      expect(await token.balanceOf(await ledger.getAddress())).to.equal(E("100"));
      expect(await token.balanceOf(funder.address)).to.equal(E("900"));
      const c = await ledger.channels(1);
      expect(c.agent).to.equal(agent.address);
      expect(c.payout).to.equal(payout.address);
      expect(c.cap).to.equal(E("100"));
    });
  });

  describe("redeemVoucher", () => {
    it("accepts a valid agent signature and emits VoucherRedeemed", async () => {
      const { ledger, relayer, sign } = await loadFixture(deploy);
      const { v, sig } = await sign((await ethers.getSigners())[2], E("10"));
      await expect(ledger.connect(relayer).redeemVoucher(v, sig))
        .to.emit(ledger, "VoucherRedeemed")
        .withArgs(1n, E("10"), E("10"), REF);
      expect((await ledger.channels(1)).redeemed).to.equal(E("10"));
      expect(await ledger.remaining(1)).to.equal(E("90"));
    });

    it("rejects a bad signature (wrong signer)", async () => {
      const { ledger, stranger, sign } = await loadFixture(deploy);
      const { v, sig } = await sign(stranger, E("10"));
      await expect(ledger.redeemVoucher(v, sig)).to.be.revertedWithCustomError(ledger, "BadSignature");
    });

    it("rejects a tampered voucher (amount changed after signing)", async () => {
      const { ledger, agent, sign } = await loadFixture(deploy);
      const { v, sig } = await sign(agent, E("10"));
      await expect(ledger.redeemVoucher({ ...v, cumulativeAmount: E("50") }, sig)).to.be.revertedWithCustomError(
        ledger,
        "BadSignature",
      );
    });

    it("rejects replay of the same voucher", async () => {
      const { ledger, agent, sign } = await loadFixture(deploy);
      const { v, sig } = await sign(agent, E("10"));
      await ledger.redeemVoucher(v, sig);
      await expect(ledger.redeemVoucher(v, sig)).to.be.revertedWithCustomError(ledger, "NonMonotonic");
    });

    it("rejects a non-monotonic (lower) cumulative amount", async () => {
      const { ledger, agent, sign } = await loadFixture(deploy);
      const a = await sign(agent, E("20"));
      await ledger.redeemVoucher(a.v, a.sig);
      const b = await sign(agent, E("15"), ethers.id("payment-2"));
      await expect(ledger.redeemVoucher(b.v, b.sig)).to.be.revertedWithCustomError(ledger, "NonMonotonic");
    });

    it("enforces the cap: exactly at cap ok, over cap rejected", async () => {
      const { ledger, agent, sign } = await loadFixture(deploy);
      const over = await sign(agent, E("100") + 1n);
      await expect(ledger.redeemVoucher(over.v, over.sig)).to.be.revertedWithCustomError(ledger, "OverCap");
      const at = await sign(agent, E("100"));
      await ledger.redeemVoucher(at.v, at.sig);
      expect(await ledger.remaining(1)).to.equal(0n);
    });

    it("rejects an expired voucher", async () => {
      const { ledger, agent, sign } = await loadFixture(deploy);
      const now = BigInt(await time.latest());
      const { v, sig } = await sign(agent, E("1"), REF, now + 60n);
      await time.increase(120);
      await expect(ledger.redeemVoucher(v, sig)).to.be.revertedWithCustomError(ledger, "Expired");
    });

    it("rejects a voucher for an unknown channel", async () => {
      const { ledger, agent, sign } = await loadFixture(deploy);
      const { v, sig } = await sign(agent, E("1"), REF, 0n, 99n);
      await expect(ledger.redeemVoucher(v, sig)).to.be.revertedWithCustomError(ledger, "UnknownChannel");
    });

    it("rejects a voucher signed for another ledger/chain domain", async () => {
      const { ledger, agent } = await loadFixture(deploy);
      const domain = { name: "AP4M PaymentLedger", version: "1", chainId: 1n, verifyingContract: await ledger.getAddress() };
      const types = {
        Voucher: [
          { name: "channelId", type: "uint256" },
          { name: "cumulativeAmount", type: "uint256" },
          { name: "ref", type: "bytes32" },
          { name: "expiry", type: "uint256" },
        ],
      };
      const v = { channelId: 1n, cumulativeAmount: E("1"), ref: REF, expiry: 0n };
      const sig = await agent.signTypedData(domain, types, v);
      await expect(ledger.redeemVoucher(v, sig)).to.be.revertedWithCustomError(ledger, "BadSignature");
    });

    it("stops redemptions once the agent is revoked", async () => {
      const { ledger, registry, agent, sign } = await loadFixture(deploy);
      await registry.revoke(agent.address);
      const { v, sig } = await sign(agent, E("1"));
      await expect(ledger.redeemVoucher(v, sig)).to.be.revertedWithCustomError(ledger, "AgentNotVerified");
    });
  });

  describe("settle", () => {
    it("pays exactly (redeemed - settled) to the payout address", async () => {
      const { ledger, token, agent, payout, sign } = await loadFixture(deploy);
      const a = await sign(agent, E("10"));
      await ledger.redeemVoucher(a.v, a.sig);
      await expect(ledger.settle(1))
        .to.emit(ledger, "ClaimPaid")
        .withArgs(1n, payout.address, E("10"))
        .and.to.emit(ledger, "SettlementRecorded")
        .withArgs(1n, E("10"), E("10"));
      expect(await token.balanceOf(payout.address)).to.equal(E("10"));

      const b = await sign(agent, E("35"), ethers.id("payment-2"));
      await ledger.redeemVoucher(b.v, b.sig);
      await expect(ledger.settle(1)).to.changeTokenBalances(token, [payout, ledger], [E("25"), -E("25")]);
      expect(await token.balanceOf(payout.address)).to.equal(E("35"));
    });

    it("second settle with nothing new pays zero", async () => {
      const { ledger, token, agent, payout, sign } = await loadFixture(deploy);
      const a = await sign(agent, E("10"));
      await ledger.redeemVoucher(a.v, a.sig);
      await ledger.settle(1);
      await expect(ledger.settle(1)).to.not.emit(ledger, "ClaimPaid");
      expect(await token.balanceOf(payout.address)).to.equal(E("10"));
    });

    it("invariant settled <= redeemed <= cap holds across a sequence", async () => {
      const { ledger, agent, sign } = await loadFixture(deploy);
      for (const [i, amt] of ["5", "17", "40", "99", "100"].entries()) {
        const s = await sign(agent, E(amt), ethers.id(`p-${i}`));
        await ledger.redeemVoucher(s.v, s.sig);
        if (i % 2 === 0) await ledger.settle(1);
        const c = await ledger.channels(1);
        expect(c.settled <= c.redeemed).to.equal(true);
        expect(c.redeemed <= c.cap).to.equal(true);
      }
    });
  });

  describe("kill switch (pause) and close", () => {
    it("pause blocks open/redeem/settle; only owner can pause", async () => {
      const { ledger, funder, agent, stranger, sign } = await loadFixture(deploy);
      await expect(ledger.connect(stranger).pause()).to.be.revertedWithCustomError(ledger, "OwnableUnauthorizedAccount");
      await ledger.pause();
      const { v, sig } = await sign(agent, E("1"));
      await expect(ledger.redeemVoucher(v, sig)).to.be.revertedWithCustomError(ledger, "EnforcedPause");
      await expect(ledger.settle(1)).to.be.revertedWithCustomError(ledger, "EnforcedPause");
      await expect(ledger.connect(funder).openChannel(agent.address, E("1"))).to.be.revertedWithCustomError(
        ledger,
        "EnforcedPause",
      );
      await ledger.unpause();
      await ledger.redeemVoucher(v, sig);
    });

    it("funder close settles redeemed and refunds the rest", async () => {
      const { ledger, token, funder, agent, payout, stranger, sign } = await loadFixture(deploy);
      const s = await sign(agent, E("30"));
      await ledger.redeemVoucher(s.v, s.sig);
      await expect(ledger.connect(stranger).closeChannel(1)).to.be.revertedWithCustomError(ledger, "NotFunder");
      await expect(ledger.connect(funder).closeChannel(1)).to.emit(ledger, "ChannelClosed").withArgs(1n, E("70"));
      expect(await token.balanceOf(payout.address)).to.equal(E("30"));
      expect(await token.balanceOf(funder.address)).to.equal(E("970"));
      const s2 = await sign(agent, E("40"));
      await expect(ledger.redeemVoucher(s2.v, s2.sig)).to.be.revertedWithCustomError(ledger, "ChannelIsClosed");
    });
  });
});
