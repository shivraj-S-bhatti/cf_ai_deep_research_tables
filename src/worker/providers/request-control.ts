export type RequestControl = {
  signal?: AbortSignal | null;
  timeoutMs?: number | null;
};

export function createAbortError(message: string): Error {
  try {
    return new DOMException(message, "AbortError");
  } catch {
    const error = new Error(message);
    error.name = "AbortError";
    return error;
  }
}

export function isAbortLikeError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function createRequestSignal(control?: RequestControl): {
  signal: AbortSignal | undefined;
  cleanup: () => void;
} {
  if (!control?.signal && (!control?.timeoutMs || control.timeoutMs <= 0)) {
    return {
      signal: control?.signal ?? undefined,
      cleanup: () => {},
    };
  }

  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const parentSignal = control.signal ?? null;
  const handleParentAbort = () => {
    controller.abort(parentSignal?.reason ?? createAbortError("Request aborted."));
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason ?? createAbortError("Request aborted."));
    } else {
      parentSignal.addEventListener("abort", handleParentAbort, { once: true });
    }
  }

  if (!controller.signal.aborted && control.timeoutMs && control.timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      controller.abort(createAbortError(`Request timed out after ${control.timeoutMs}ms.`));
    }, control.timeoutMs);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (parentSignal) {
        parentSignal.removeEventListener("abort", handleParentAbort);
      }
    },
  };
}

export async function delayWithSignal(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (!signal) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return;
  }

  if (signal.aborted) {
    throw signal.reason ?? createAbortError("Request aborted.");
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason ?? createAbortError("Request aborted."));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
