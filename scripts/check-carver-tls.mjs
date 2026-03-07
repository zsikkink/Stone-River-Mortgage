#!/usr/bin/env node

import https from "node:https";
import { pathToFileURL } from "node:url";

const DEFAULT_CARVER_URL =
  "https://publicaccess.carvercountymn.gov/search/commonsearch.aspx?mode=combined";

export function classifyTlsIssue(error) {
  const code = error?.cause?.code || error?.code || null;
  const message =
    error?.cause?.message || error?.message || "unknown connection error";

  const tlsLike =
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    code === "UNABLE_TO_GET_ISSUER_CERT" ||
    code === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN" ||
    /unable to verify the first certificate|certificate/i.test(message);

  return {
    code,
    message,
    tlsLike
  };
}

function normalizePem(value) {
  return value.replace(/\r\n/g, "\n").replace(/\\n/g, "\n").trim();
}

function resolveCarverPem(env) {
  const raw = env.CARVER_CA_PEM;
  if (!raw || !raw.trim()) {
    return {
      configured: false,
      valid: false,
      error: null,
      pem: null
    };
  }

  const normalized = normalizePem(raw);
  const valid =
    /-----BEGIN CERTIFICATE-----/.test(normalized) &&
    /-----END CERTIFICATE-----/.test(normalized);

  if (!valid) {
    return {
      configured: true,
      valid: false,
      error:
        "CARVER_CA_PEM is set but does not contain a valid PEM certificate block.",
      pem: null
    };
  }

  return {
    configured: true,
    valid: true,
    error: null,
    pem: normalized
  };
}

async function requestWithScopedCa(url, caPem) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = https.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port ? Number.parseInt(target.port, 10) : undefined,
        path: `${target.pathname}${target.search}`,
        method: "GET",
        rejectUnauthorized: true,
        ca: caPem
      },
      (response) => {
        const status = response.statusCode || 0;
        response.resume();

        resolve({
          ok: status >= 200 && status < 400,
          status
        });
      }
    );

    request.on("error", reject);
    request.end();
  });
}

export async function checkCarverTls(options = {}) {
  const {
    fetchImpl = fetch,
    requestWithCaImpl = requestWithScopedCa,
    env = process.env,
    url = env.CARVER_TLS_CHECK_URL || DEFAULT_CARVER_URL
  } = options;

  const carverPem = resolveCarverPem(env);
  const extraCaPath = env.NODE_EXTRA_CA_CERTS || null;
  const nodeExtraCaCertsConfigured = Boolean(extraCaPath);
  const trustPath =
    carverPem.valid === true ? "carver_ca_pem" : "default_trust_store";

  if (carverPem.configured && !carverPem.valid) {
    return {
      ok: false,
      exitCode: 5,
      providerErrorType: "tls_certificate_validation",
      providerErrorCode: "INVALID_CARVER_CA_PEM",
      trustPath,
      carverCaPemConfigured: true,
      carverCaPemValid: false,
      carverCaPemError: carverPem.error,
      nodeExtraCaCertsConfigured,
      nodeExtraCaCertsPath: extraCaPath,
      message: carverPem.error,
      recommendedAction:
        "Set CARVER_CA_PEM to the full PEM certificate chain text (preferred for Vercel), or remove it and rely on trusted startup CA configuration for local development."
    };
  }

  try {
    const response = carverPem.valid
      ? await requestWithCaImpl(url, carverPem.pem)
      : await fetchImpl(url, {
          method: "GET",
          redirect: "follow",
          cache: "no-store"
        });

    if (!response.ok) {
      return {
        ok: false,
        exitCode: 2,
        providerErrorType: "response_error",
        providerErrorCode: null,
        trustPath,
        carverCaPemConfigured: carverPem.configured,
        carverCaPemValid: carverPem.valid,
        carverCaPemError: carverPem.error,
        nodeExtraCaCertsConfigured,
        nodeExtraCaCertsPath: extraCaPath,
        message: `Request reached county host but returned HTTP ${response.status}.`,
        recommendedAction:
          "Confirm county endpoint availability and request path; retry after checking county service status."
      };
    }

    return {
      ok: true,
      exitCode: 0,
      providerErrorType: null,
      providerErrorCode: null,
      trustPath,
      carverCaPemConfigured: carverPem.configured,
      carverCaPemValid: carverPem.valid,
      carverCaPemError: carverPem.error,
      nodeExtraCaCertsConfigured,
      nodeExtraCaCertsPath: extraCaPath,
      message: "Success: TLS handshake and county response succeeded.",
      recommendedAction: null
    };
  } catch (error) {
    const result = classifyTlsIssue(error);

    if (result.tlsLike) {
      return {
        ok: false,
        exitCode: 3,
        providerErrorType: "tls_certificate_validation",
        providerErrorCode: result.code,
        trustPath,
        carverCaPemConfigured: carverPem.configured,
        carverCaPemValid: carverPem.valid,
        carverCaPemError: carverPem.error,
        nodeExtraCaCertsConfigured,
        nodeExtraCaCertsPath: extraCaPath,
        message: result.message,
        recommendedAction: carverPem.configured
          ? "Verify CARVER_CA_PEM contains a valid PEM chain and rerun this check."
          : nodeExtraCaCertsConfigured
            ? "Verify NODE_EXTRA_CA_CERTS points to a PEM bundle that includes the required intermediate certificate chain, then restart Node and rerun this check."
            : "Set CARVER_CA_PEM to PEM certificate-chain text (preferred for Vercel) or set NODE_EXTRA_CA_CERTS before startup for local development, then rerun this check."
      };
    }

    return {
      ok: false,
      exitCode: 4,
      providerErrorType: "network_error",
      providerErrorCode: result.code,
      trustPath,
      carverCaPemConfigured: carverPem.configured,
      carverCaPemValid: carverPem.valid,
      carverCaPemError: carverPem.error,
      nodeExtraCaCertsConfigured,
      nodeExtraCaCertsPath: extraCaPath,
      message: result.message,
      recommendedAction:
        "Check network reachability and county endpoint availability, then rerun the TLS check."
    };
  }
}

export async function runCli() {
  const result = await checkCarverTls();

  console.log(
    `[carver-tls] CARVER_CA_PEM configured: ${
      result.carverCaPemConfigured ? "yes" : "no"
    }${result.carverCaPemConfigured ? ` (valid: ${result.carverCaPemValid ? "yes" : "no"})` : ""}`
  );
  if (result.carverCaPemError) {
    console.log(`[carver-tls] CARVER_CA_PEM error: ${result.carverCaPemError}`);
  }
  console.log(
    `[carver-tls] NODE_EXTRA_CA_CERTS: ${
      result.nodeExtraCaCertsPath ? result.nodeExtraCaCertsPath : "(not set)"
    }`
  );
  console.log(`[carver-tls] Trust path: ${result.trustPath}`);
  console.log(
    `[carver-tls] Probing ${process.env.CARVER_TLS_CHECK_URL || DEFAULT_CARVER_URL}`
  );

  if (result.ok) {
    console.log(`[carver-tls] ${result.message}`);
    process.exit(result.exitCode);
  }

  if (result.providerErrorType === "tls_certificate_validation") {
    console.error(
      `[carver-tls] TLS certificate-chain validation failed (${result.providerErrorCode || "no-code"}).`
    );
  } else {
    console.error(
      `[carver-tls] Connectivity check failed (${result.providerErrorCode || "no-code"}).`
    );
  }

  console.error(`[carver-tls] ${result.message}`);
  if (result.recommendedAction) {
    console.error(`[carver-tls] ${result.recommendedAction}`);
  }

  process.exit(result.exitCode);
}

const invokedFile = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;

if (invokedFile && import.meta.url === invokedFile) {
  runCli();
}
