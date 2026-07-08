import type { Logger } from "./types";

const ts = (): string => new Date().toLocaleTimeString("en-GB", { hour12: false });

const make = (prefix: string): Logger => ({
  info: (msg) => process.stderr.write(`[${ts()}] ${prefix}${msg}\n`),
  warn: (msg) => process.stderr.write(`[${ts()}] ${prefix}WARN ${msg}\n`),
  error: (msg) => process.stderr.write(`[${ts()}] ${prefix}ERR  ${msg}\n`),
  child: (sub) => make(`${prefix}[${sub}] `),
});

export const rootLogger: Logger = make("");
