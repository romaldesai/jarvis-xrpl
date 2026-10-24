import { HardhatUserConfig, subtask } from "hardhat/config";
import { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } from "hardhat/builtin-tasks/task-names";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const SOLC = "0.8.24";

// Use the bundled npm `solc` (solcjs) instead of downloading a compiler. Works offline.
// Set HARDHAT_NATIVE_SOLC=1 to let Hardhat download the native compiler instead.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args: { solcVersion: string }, _hre, runSuper) => {
  if (args.solcVersion === SOLC && process.env.HARDHAT_NATIVE_SOLC !== "1") {
    const solcPkg = require.resolve("solc/package.json");
    const longVersion = require("solc/package.json").version as string;
    return {
      compilerPath: path.join(path.dirname(solcPkg), "soljson.js"),
      isSolcJs: true,
      version: SOLC,
      longVersion,
    };
  }
  return runSuper();
});

const key = process.env.AGENT_PRIVATE_KEY;
const funderKey = process.env.FUNDER_PRIVATE_KEY;
const isHexKey = (k?: string) => !!k && /^0x[0-9a-fA-F]{64}$/.test(k);
const accounts = [key, funderKey].filter(isHexKey) as string[];

const config: HardhatUserConfig = {
  solidity: {
    version: SOLC,
    // "paris": conservative EVM target (no PUSH0) for the XRPL EVM Sidechain.
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris" },
  },
  networks: {
    hardhat: {},
    // Local dev chain. Uses the .env agent key when present (funded by scripts/local-demo.sh).
    localhost: { url: "http://127.0.0.1:8545", chainId: 31337, ...(isHexKey(key) ? { accounts } : {}) },
    xrplevmTestnet: {
      url: process.env.EVM_RPC_URL || "https://rpc.testnet.xrplevm.org",
      chainId: 1449000,
      accounts,
    },
  },
};

export default config;
