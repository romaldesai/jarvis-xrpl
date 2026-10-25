// Real Mastercard AP4M x402 run on XRPL EVM testnet (chain 1449000).
// Copied exactly from docs/AP4M-PROOF.md. Static data only; nothing here is read at runtime from the chain.

export const AP4M_EXPLORER_TX = "https://explorer.testnet.xrplevm.org/tx/";

export type Ap4mPurchase = {
  n: number;
  amount: string;
  redeemTx: string; // VoucherRedeemed
  payoutTx: string; // ClaimPaid (RLUSD to merchant)
  settlementTx: string; // SettlementRecorded
  receiptUrl: string;
};

export type Ap4mProof = {
  team: string;
  agent: string;
  merchantPayout: string;
  channelId: string;
  channelCap: string;
  purchases: Ap4mPurchase[];
  overCap: { label: string; tx: string };
  killSwitch: { label: string };
};

export const AP4M_PROOF: Ap4mProof = {
  team: "RomsCoin",
  agent: "0xcBcc8c442d312D2D2b4B3d124d268fC235294e2C",
  merchantPayout: "0xf9a20Cc9a8ea389D07B76A4176882e53fFED2A24",
  channelId: "0x2282fc58936acb028b69ff8709a801a918100fac14828404c8d5da5e37b06cbf", // secret-scan:allow (public tx hash / id)
  channelCap: "2 RLUSD",
  purchases: [
    {
      n: 1,
      amount: "0.25 RLUSD",
      redeemTx: "0x6a64a7826c8737745fd01504591341c62987073410b3258d2e964054f620c2cd", // secret-scan:allow (public tx hash / id)
      payoutTx: "0xedf543c168eaa67c0c83ecf8a70cd62bb66797b1cd4e5afc86cebdb66debcf36", // secret-scan:allow (public tx hash / id)
      settlementTx: "0xcf1d7275d9cac23a631f6a78b9ef7395e2abe9a872db95fef37d1c440dccf268", // secret-scan:allow (public tx hash / id)
      receiptUrl:
        "https://hackathon.ap4m.build/public/evidence/claims/0x68d41ed33036995de7b1340e296e1ebaddd29546cd045cdcb408dfc09efbbfe4/0xb523e912184c31ccd3ad935b0549f5879dc894e86b7e4be8225a4df5e5ea18f0.json", // secret-scan:allow (public tx hash / id)
    },
    {
      n: 2,
      amount: "0.25 RLUSD",
      redeemTx: "0x6e2c8cdca92b7a7560bfe604ff638e496fcdbb3d3d0d4d31c7c738110e93c033", // secret-scan:allow (public tx hash / id)
      payoutTx: "0xdffda0c0558dec4c82cd33d7bf037c065d162b45f443988439f494e69568cb5c", // secret-scan:allow (public tx hash / id)
      settlementTx: "0x49dba42a0d58e7b57da8a52f2ef98e660f5040b322887f2ee90d13feb26d0ebd", // secret-scan:allow (public tx hash / id)
      receiptUrl:
        "https://hackathon.ap4m.build/public/evidence/claims/0xaa4346fe78b815a533e3cbf48ee7b84fc86fb431bfa63f3351bdcc95d48b7c7d/0x517f57fbc62ea711bb2e416acc0686eee4ac59db10ca75a27ddeb5ddecef15e7.json", // secret-scan:allow (public tx hash / id)
    },
  ],
  overCap: {
    label: "Over-cap voucher (3 > 2 RLUSD): reverted on-chain",
    tx: "0xc1ba1b65d864c9aa2b6102c6281b1475cccfa9f334f77c83a466ed3a47f9e388", // secret-scan:allow (public tx hash / id)
  },
  killSwitch: { label: "Kill switch: refused" },
};
