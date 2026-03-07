import https from "node:https";
import { IncomingHttpHeaders } from "node:http";
import {
  CookieAwareFetch,
  CookieAwareFetchResult
} from "./authoritativeCountyUtils";

const CARVER_HOST = "publicaccess.carvercountymn.gov";
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

type CarverTlsDiagnostics = {
  carverCaPemConfigured: boolean;
  carverCaPemValid: boolean;
  nodeExtraCaCertsConfigured: boolean;
  requestScopedCaEnabled: boolean;
  trustPath: "carver_ca_pem" | "default_trust_store";
  configurationError: string | null;
};

type CarverFetchFactoryOptions = {
  env?: NodeJS.ProcessEnv;
  fallbackFetch?: typeof fetch;
  requestWithCaImpl?: (
    url: string,
    init: RequestInit,
    caPem: string
  ) => Promise<CookieAwareFetchResult>;
};

type CarverPemResolution = {
  caPem: string | null;
  configured: boolean;
  valid: boolean;
  error: string | null;
};

function normalizePem(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\\n/g, "\n").trim();
}

function resolveCarverPem(env: NodeJS.ProcessEnv): CarverPemResolution {
  const raw = env.CARVER_CA_PEM;
  if (!raw || !raw.trim()) {
    return {
      caPem: null,
      configured: false,
      valid: false,
      error: null
    };
  }

  const normalized = normalizePem(raw);
  const hasPemMarkers =
    /-----BEGIN CERTIFICATE-----/.test(normalized) &&
    /-----END CERTIFICATE-----/.test(normalized);
  if (!hasPemMarkers) {
    return {
      caPem: null,
      configured: true,
      valid: false,
      error:
        "CARVER_CA_PEM is set but does not contain a valid PEM certificate block."
    };
  }

  return {
    caPem: normalized,
    configured: true,
    valid: true,
    error: null
  };
}

function normalizeRequestUrl(url: string): string {
  return new URL(url).toString();
}

function toRequestBodyBuffer(
  body: RequestInit["body"]
): Promise<Buffer | null> {
  if (body == null) {
    return Promise.resolve(null);
  }

  if (typeof body === "string") {
    return Promise.resolve(Buffer.from(body));
  }

  if (body instanceof URLSearchParams) {
    return Promise.resolve(Buffer.from(body.toString()));
  }

  if (Buffer.isBuffer(body)) {
    return Promise.resolve(body);
  }

  if (body instanceof Uint8Array) {
    return Promise.resolve(Buffer.from(body));
  }

  if (body instanceof ArrayBuffer) {
    return Promise.resolve(Buffer.from(body));
  }

  if (ArrayBuffer.isView(body)) {
    return Promise.resolve(
      Buffer.from(body.buffer, body.byteOffset, body.byteLength)
    );
  }

  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return body.arrayBuffer().then((arrayBuffer) => Buffer.from(arrayBuffer));
  }

  throw Object.assign(
    new Error("Unsupported request body type for Carver county TLS fetch."),
    { code: "UNSUPPORTED_CARVER_REQUEST_BODY" }
  );
}

function appendIncomingHeaders(
  target: Headers,
  headers: IncomingHttpHeaders
): string[] {
  const setCookies: string[] = [];

  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "undefined") {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        target.append(name, item);
      }
      if (name.toLowerCase() === "set-cookie") {
        setCookies.push(...value);
      }
      continue;
    }

    target.set(name, value);
    if (name.toLowerCase() === "set-cookie") {
      setCookies.push(value);
    }
  }

  return setCookies;
}

function extractCookiePairs(setCookies: string[]): string[] {
  const pairs = new Map<string, string>();
  for (const raw of setCookies) {
    const firstPart = raw.split(";")[0]?.trim();
    if (!firstPart) {
      continue;
    }
    const separatorIndex = firstPart.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const name = firstPart.slice(0, separatorIndex).trim();
    const value = firstPart.slice(separatorIndex + 1).trim();
    if (!name) {
      continue;
    }
    pairs.set(name, value);
  }
  return Array.from(pairs.entries()).map(([name, value]) => `${name}=${value}`);
}

async function requestWithCarverCa(
  url: string,
  init: RequestInit,
  caPem: string,
  redirectCount = 0,
  setCookieAccumulator: string[] = []
): Promise<CookieAwareFetchResult> {
  const requestUrl = new URL(url);
  const method = (init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers ?? {});
  const bodyBuffer = await toRequestBodyBuffer(init.body);

  if (bodyBuffer && !headers.has("content-length")) {
    headers.set("content-length", String(bodyBuffer.byteLength));
  }

  const responseData = await new Promise<{
    status: number;
    headers: IncomingHttpHeaders;
    body: Buffer;
    finalUrl: string;
  }>((resolve, reject) => {
    const request = https.request(
      {
        protocol: requestUrl.protocol,
        hostname: requestUrl.hostname,
        port: requestUrl.port ? Number.parseInt(requestUrl.port, 10) : undefined,
        path: `${requestUrl.pathname}${requestUrl.search}`,
        method,
        headers: Object.fromEntries(headers.entries()),
        rejectUnauthorized: true,
        ca: caPem
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode || 500,
            headers: response.headers,
            body: Buffer.concat(chunks),
            finalUrl: requestUrl.toString()
          });
        });
      }
    );

    request.on("error", (error) => {
      reject(error);
    });

    if (bodyBuffer && method !== "GET" && method !== "HEAD") {
      request.write(bodyBuffer);
    }

    request.end();
  });

  const responseHeaders = new Headers();
  const setCookies = appendIncomingHeaders(responseHeaders, responseData.headers);
  const mergedSetCookies = [...setCookieAccumulator, ...setCookies];
  const locationHeader = responseHeaders.get("location");
  const redirectMode = init.redirect ?? "follow";

  if (
    redirectMode === "follow" &&
    REDIRECT_STATUS.has(responseData.status) &&
    locationHeader
  ) {
    if (redirectCount >= MAX_REDIRECTS) {
      throw Object.assign(
        new Error(
          `Too many redirects while querying Carver county source (>${MAX_REDIRECTS}).`
        ),
        {
          code: "TOO_MANY_REDIRECTS"
        }
      );
    }

    const redirectedUrl = new URL(locationHeader, responseData.finalUrl).toString();
    const redirectedHeaders = new Headers(headers);
    const cookiePairs = extractCookiePairs(mergedSetCookies);
    if (cookiePairs.length) {
      redirectedHeaders.set("cookie", cookiePairs.join("; "));
    }
    let redirectedMethod = method;
    let redirectedBody = bodyBuffer;

    if (
      responseData.status === 303 ||
      ((responseData.status === 301 || responseData.status === 302) &&
        method === "POST")
    ) {
      redirectedMethod = "GET";
      redirectedBody = null;
      redirectedHeaders.delete("content-length");
      redirectedHeaders.delete("content-type");
    }

    return requestWithCarverCa(
      redirectedUrl,
      {
        ...init,
        method: redirectedMethod,
        headers: redirectedHeaders,
        body: redirectedBody
      },
      caPem,
      redirectCount + 1,
      mergedSetCookies
    );
  }

  const response = new Response(responseData.body, {
    status: responseData.status,
    headers: responseHeaders
  });

  return {
    response,
    finalUrl: responseData.finalUrl,
    setCookies: mergedSetCookies,
    transport: "carver_ca_pem"
  };
}

export function getCarverTlsDiagnostics(
  env: NodeJS.ProcessEnv = process.env
): CarverTlsDiagnostics {
  const resolvedPem = resolveCarverPem(env);
  const nodeExtraCaCertsConfigured = Boolean(
    env.NODE_EXTRA_CA_CERTS && env.NODE_EXTRA_CA_CERTS.trim()
  );

  return {
    carverCaPemConfigured: resolvedPem.configured,
    carverCaPemValid: resolvedPem.valid,
    nodeExtraCaCertsConfigured,
    requestScopedCaEnabled: resolvedPem.valid,
    trustPath: resolvedPem.valid ? "carver_ca_pem" : "default_trust_store",
    configurationError: resolvedPem.error
  };
}

function buildDefaultCookieAwareFetch(
  fallbackFetch: typeof fetch
): CookieAwareFetch {
  return async (url, init) => {
    const response = await fallbackFetch(url, {
      ...init,
      redirect: "follow",
      cache: "no-store"
    });

    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    const setCookies =
      typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : (() => {
            const single = response.headers.get("set-cookie");
            return single ? [single] : [];
          })();

    return {
      response,
      finalUrl: response.url || normalizeRequestUrl(url),
      setCookies,
      transport: "default_fetch"
    };
  };
}

export function createCarverCookieAwareFetch(
  options: CarverFetchFactoryOptions = {}
): CookieAwareFetch {
  const env = options.env ?? process.env;
  const fallbackFetch =
    options.fallbackFetch ??
    ((input: string | URL | Request, init?: RequestInit) =>
      globalThis.fetch(input, init));
  const defaultFetch = buildDefaultCookieAwareFetch(fallbackFetch);
  const requestWithCa = options.requestWithCaImpl ?? requestWithCarverCa;

  return async (url, init) => {
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname.toLowerCase() !== CARVER_HOST) {
      return defaultFetch(url, init);
    }

    const resolvedPem = resolveCarverPem(env);
    if (resolvedPem.error) {
      throw Object.assign(new Error(resolvedPem.error), {
        code: "INVALID_CARVER_CA_PEM"
      });
    }

    if (!resolvedPem.caPem) {
      return defaultFetch(url, init);
    }

    return requestWithCa(url, init, resolvedPem.caPem);
  };
}
