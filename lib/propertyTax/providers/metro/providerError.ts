export type MetroProviderFailureKind =
  | "tls_certificate_validation"
  | "network_error"
  | "response_error"
  | "parse_error"
  | "unknown";

export type MetroProviderFailureDetails = {
  kind: MetroProviderFailureKind;
  code: string | null;
  message: string;
};

const TLS_ERROR_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "INVALID_CARVER_CA_PEM"
]);

const NETWORK_ERROR_CODES = new Set([
  "ENOTFOUND",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT"
]);

export class MetroProviderError extends Error {
  kind: MetroProviderFailureKind;
  code: string | null;

  constructor(params: {
    kind: MetroProviderFailureKind;
    message: string;
    code?: string | null;
    cause?: unknown;
  }) {
    super(params.message, {
      cause: params.cause
    });
    this.name = "MetroProviderError";
    this.kind = params.kind;
    this.code = params.code ?? null;
  }
}

function readNestedCode(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const candidate = error as Record<string, unknown>;
  if (typeof candidate.code === "string" && candidate.code.trim()) {
    return candidate.code.trim();
  }

  if (candidate.cause) {
    return readNestedCode(candidate.cause);
  }

  return null;
}

function readNestedMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string") {
    if (error.cause) {
      const causeMessage = readNestedMessage(error.cause);
      if (causeMessage && causeMessage !== error.message) {
        return `${error.message} | cause: ${causeMessage}`;
      }
    }
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "unknown";
}

function classifyByCodeOrMessage(code: string | null, message: string): MetroProviderFailureKind {
  if (code && TLS_ERROR_CODES.has(code)) {
    return "tls_certificate_validation";
  }

  if (/UNABLE_TO_VERIFY_LEAF_SIGNATURE|unable to verify the first certificate|certificate/i.test(message)) {
    return "tls_certificate_validation";
  }

  if (code && NETWORK_ERROR_CODES.has(code)) {
    return "network_error";
  }

  if (/ECONN|ENOTFOUND|timed out|network|fetch failed/i.test(message)) {
    return "network_error";
  }

  return "unknown";
}

export function classifyMetroProviderFailure(
  error: unknown
): MetroProviderFailureDetails {
  if (error instanceof MetroProviderError) {
    return {
      kind: error.kind,
      code: error.code,
      message: error.message || "unknown"
    };
  }

  const code = readNestedCode(error);
  const message = readNestedMessage(error);
  const kind = classifyByCodeOrMessage(code, message);

  return {
    kind,
    code,
    message
  };
}
