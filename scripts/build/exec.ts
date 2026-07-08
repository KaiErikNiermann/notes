import { spawn } from "node:child_process";
import type { ExecOpts, StageError } from "./types";

export class StageExecError extends Error {
  constructor(public readonly stageError: StageError) {
    super(formatStageError(stageError));
    this.name = "StageExecError";
  }
}

export const formatStageError = (e: StageError): string => {
  switch (e.kind) {
    case "missing-tool": {
      return `missing tool: ${e.tool}${e.hint ? ` — ${e.hint}` : ""}`;
    }
    case "subprocess-failed": {
      return `subprocess failed (exit ${e.exitCode}): ${e.cmd}\n${e.stderr.trimEnd()}`;
    }
    case "input-not-found": {
      return `input not found: ${e.path}`;
    }
    case "output-not-produced": {
      return `output not produced: ${e.expected}`;
    }
    case "stage-threw": {
      return `stage threw: ${e.message}${e.stack ? `\n${e.stack}` : ""}`;
    }
  }
};

/**
 * Spawn a subprocess and throw `StageExecError` on non-zero exit / signal.
 * stdout is buffered and printed on completion (or via `verbose` for live).
 * stderr is always streamed to parent stderr.
 */
export const runSubprocess = async (
  cmd: string,
  args: readonly string[],
  opts: ExecOpts = {},
): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args as string[], {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      const s = chunk.toString();
      stdout += s;
      if (opts.verbose) process.stdout.write(s);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const s = chunk.toString();
      stderr += s;
      process.stderr.write(s);
    });

    child.on("error", (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        reject(new StageExecError({ kind: "missing-tool", tool: cmd }));
      } else {
        reject(
          new StageExecError({
            kind: "subprocess-failed",
            cmd: `${cmd} ${args.join(" ")}`,
            exitCode: -1,
            stderr: err.message,
          }),
        );
      }
    });

    child.on("close", (code) => {
      if (code === 0) {
        if (!opts.verbose && stdout) process.stdout.write(stdout);
        resolve();
      } else {
        reject(
          new StageExecError({
            kind: "subprocess-failed",
            cmd: `${cmd} ${args.join(" ")}`,
            exitCode: code ?? -1,
            stderr,
          }),
        );
      }
    });
  });
};
