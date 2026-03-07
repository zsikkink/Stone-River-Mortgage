const DEFAULT_SERVER_FETCH_TIMEOUT_MS = 12000;

type FetchWithTimeoutOptions = {
  timeoutMs?: number;
};

function mergeAbortSignals(
  signal: AbortSignal | null | undefined,
  timeoutSignal: AbortSignal
): AbortSignal {
  if (!signal) {
    return timeoutSignal;
  }

  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([signal, timeoutSignal]);
  }

  return signal;
}

export async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  options: FetchWithTimeoutOptions = {}
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SERVER_FETCH_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const mergedSignal = mergeAbortSignals(init.signal, timeoutSignal);

  return fetch(input, {
    ...init,
    signal: mergedSignal
  });
}
