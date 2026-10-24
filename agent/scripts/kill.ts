// npm run kill -- on|off|status   (works before anything is deployed)
import path from "node:path";
import { AuditLog, isKillSwitchOn, loadConfig, loadEnv, repoRoot, setKillSwitch } from "../src/index";
loadEnv();
const root = repoRoot();
const cfg = loadConfig(process.env);
const ks = { ...cfg.killSwitch, file: path.resolve(root, cfg.killSwitch.file) };
const arg = process.argv[2] ?? "status";
if (arg === "on" || arg === "off") {
  setKillSwitch(ks, arg === "on");
  new AuditLog(path.resolve(root, cfg.auditPath)).append({ event: "kill", rule: "KILL_SWITCH", reason: `Kill switch turned ${arg.toUpperCase()} (CLI)` });
}
console.log(`kill switch: ${isKillSwitchOn(ks) ? "ON" : "OFF"}${process.env.KILL_SWITCH && process.env.KILL_SWITCH !== "0" ? " (forced by KILL_SWITCH env)" : ""}`);
