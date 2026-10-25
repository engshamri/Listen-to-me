import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export class ProcessError extends Error {
  constructor(public reason: "ABORTED" | "TIMEOUT" | "NOT_FOUND" | "SPAWN_FAILED", message?: string) {
    super(message ?? reason);
  }
}

/**
 * Runs a program with an argument array (never through a shell, so user input
 * cannot inject commands). The process is killed when `signal` aborts or the
 * timeout elapses.
 */
export function runProcess(
  command: string,
  args: string[],
  { signal, timeoutMs, cwd }: { signal?: AbortSignal; timeoutMs: number; cwd?: string },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ProcessError("ABORTED"));
    const proc = spawn(command, args, { cwd, windowsHide: true, shell: false });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const kill = () => {
      try {
        proc.kill("SIGKILL");
      } catch {}
    };
    const onAbort = () => {
      kill();
      finish(() => reject(new ProcessError("ABORTED")));
    };
    const timer = setTimeout(() => {
      kill();
      finish(() => reject(new ProcessError("TIMEOUT")));
    }, timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });

    proc.stdout.on("data", (d) => {
      if (stdout.length < 64_000) stdout += d.toString();
    });
    proc.stderr.on("data", (d) => {
      if (stderr.length < 64_000) stderr += d.toString();
    });
    proc.on("error", (e: NodeJS.ErrnoException) =>
      finish(() => reject(new ProcessError(e.code === "ENOENT" ? "NOT_FOUND" : "SPAWN_FAILED", e.message))),
    );
    proc.on("close", (code) => finish(() => resolve({ code, stdout, stderr })));
  });
}

/** Creates a private temporary directory, runs `fn`, and always deletes it. */
export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "asmani-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
