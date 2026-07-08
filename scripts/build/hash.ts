import { createHash } from "node:crypto";
import { promises as fsp } from "node:fs";
import * as path from "node:path";

/**
 * SHA-256 over the sorted concatenation of `(relative-path, file-bytes)` for
 * every file in `paths`. The hash is stable across machines and OS path
 * separators (we always normalise to POSIX slashes for the path part).
 *
 * Returns a hex digest. Use `hashShort` for log display.
 */
export const hashFiles = async (
  root: string,
  paths: readonly string[],
): Promise<string> => {
  const h = createHash("sha256");
  const sorted = [...paths].sort();
  for (const abs of sorted) {
    const rel = path.relative(root, abs).split(path.sep).join("/");
    h.update(rel);
    h.update("\0");
    try {
      const bytes = await fsp.readFile(abs);
      h.update(bytes);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        // Skip vanished files — they'll be re-detected next run.
        continue;
      }
      throw error;
    }
    h.update("\0\0");
  }
  return h.digest("hex");
};

export const hashShort = (hex: string): string => hex.slice(0, 12);
