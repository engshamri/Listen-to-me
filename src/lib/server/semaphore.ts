/** Caps how many expensive subprocesses (Python, ffmpeg) run at once. */
export class Semaphore {
  private active = 0;
  private queue: (() => void)[] = [];

  constructor(private readonly max: number) {}

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (this.active < this.max) {
      this.active++;
      return this.releaser();
    }
    await new Promise<void>((resolve, reject) => {
      const grant = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      const onAbort = () => {
        this.queue = this.queue.filter((g) => g !== grant);
        reject(new DOMException("Aborted", "AbortError"));
      };
      this.queue.push(grant);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    this.active++;
    return this.releaser();
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.queue.shift()?.();
    };
  }
}
