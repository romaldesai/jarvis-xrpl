import { describe, expect, it } from "vitest";
import { Wallet } from "xrpl";
import { XrplRail, assertTestnet, centsToDrops, xrplTxUrl } from "../src/index";

const seed = Wallet.generate().seed!; // throwaway, generated per run, never persisted

function fakeClient(result = "tesSUCCESS") {
  const calls: string[] = [];
  const client = {
    connect: async () => void calls.push("connect"),
    disconnect: async () => void calls.push("disconnect"),
    autofill: async (tx: any) => ({ ...tx, Sequence: 1, Fee: "12", LastLedgerSequence: 100 }),
    submitAndWait: async () => ({ result: { meta: { TransactionResult: result }, ledger_index: 99 } }),
  };
  return { client, calls };
}

describe("XRPL fallback rail", () => {
  it("refuses non-testnet endpoints", () => {
    expect(() => assertTestnet("wss://xrplcluster.com")).toThrow(/testnet-only/);
    expect(() => assertTestnet("wss://s.altnet.rippletest.net:51233")).not.toThrow();
  });

  it("converts cents to integer drops", () => {
    expect(centsToDrops(5781n, 1000n)).toBe("5781000");
    expect(() => centsToDrops(0n, 1000n)).toThrow();
  });

  it("builds explorer link", () => {
    expect(xrplTxUrl("https://testnet.xrpl.org", "ABC")).toBe("https://testnet.xrpl.org/transactions/ABC");
  });

  it("asks the guard before signing, returns hash + link on tesSUCCESS", async () => {
    const { client, calls } = fakeClient();
    const rail = new XrplRail(
      { wsUrl: "wss://s.altnet.rippletest.net:51233", explorerUrl: "https://testnet.xrpl.org", senderSeed: seed, payoutAddress: Wallet.generate().address, dropsPerCent: 1000n },
      () => client as any,
    );
    let asked = 0;
    const r = await rail.execute({ id: "p1", totalCents: 100n }, { assertMaySign: () => void asked++ });
    expect(asked).toBe(1);
    expect(r.proofs[0].txHash).toMatch(/^[0-9A-F]{64}$/);
    expect(r.proofs[0].explorerUrl).toContain("/transactions/");
    expect(calls).toEqual(["connect", "disconnect"]);
  });

  it("does not sign when the guard refuses", async () => {
    const { client } = fakeClient();
    const rail = new XrplRail(
      { wsUrl: "wss://s.altnet.rippletest.net:51233", explorerUrl: "https://testnet.xrpl.org", senderSeed: seed, payoutAddress: Wallet.generate().address, dropsPerCent: 1000n },
      () => client as any,
    );
    await expect(
      rail.execute({ id: "p1", totalCents: 100n }, { assertMaySign: () => { throw new Error("KILL_SWITCH"); } }),
    ).rejects.toThrow("KILL_SWITCH");
  });

  it("throws on a non-success result code", async () => {
    const { client } = fakeClient("tecUNFUNDED_PAYMENT");
    const rail = new XrplRail(
      { wsUrl: "wss://s.altnet.rippletest.net:51233", explorerUrl: "https://testnet.xrpl.org", senderSeed: seed, payoutAddress: Wallet.generate().address, dropsPerCent: 1000n },
      () => client as any,
    );
    await expect(rail.execute({ id: "p1", totalCents: 100n }, { assertMaySign: () => {} })).rejects.toThrow(/tecUNFUNDED_PAYMENT/);
  });
});
