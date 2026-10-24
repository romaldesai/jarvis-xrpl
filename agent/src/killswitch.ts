import fs from "node:fs";

/** Kill switch: env flag KILL_SWITCH=1 OR the flag file exists. Any error reading state = ON (fail closed). */
export function isKillSwitchOn(ks: { envVar: string; file: string }, env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    const v = env.KILL_SWITCH ?? ks.envVar;
    if (v && v !== "0" && v.toLowerCase() !== "false") return true;
    return fs.existsSync(ks.file);
  } catch {
    return true;
  }
}

export function setKillSwitch(ks: { file: string }, on: boolean): void {
  if (on) fs.writeFileSync(ks.file, `killed ${new Date().toISOString()}\n`);
  else if (fs.existsSync(ks.file)) fs.unlinkSync(ks.file);
}
