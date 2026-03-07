#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

function toAbsolutePath(value) {
  if (!value) {
    return null;
  }

  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

function resolveExtraCaPath(env) {
  if (env.NODE_EXTRA_CA_CERTS && env.NODE_EXTRA_CA_CERTS.trim()) {
    return {
      source: "NODE_EXTRA_CA_CERTS",
      path: toAbsolutePath(env.NODE_EXTRA_CA_CERTS.trim())
    };
  }

  if (env.CARVER_EXTRA_CA_BUNDLE && env.CARVER_EXTRA_CA_BUNDLE.trim()) {
    return {
      source: "CARVER_EXTRA_CA_BUNDLE",
      path: toAbsolutePath(env.CARVER_EXTRA_CA_BUNDLE.trim())
    };
  }

  return {
    source: null,
    path: null
  };
}

function run() {
  const env = { ...process.env };
  const hasCarverCaPem = Boolean(env.CARVER_CA_PEM && env.CARVER_CA_PEM.trim());
  const resolved = resolveExtraCaPath(env);

  if (hasCarverCaPem) {
    console.log("[dev:carver] Using CARVER_CA_PEM from environment.");
  } else if (!resolved.path) {
    console.warn(
      "[dev:carver] No extra CA bundle configured. Carver county lookups may fall back to estimates if TLS chain validation fails."
    );
    console.warn(
      "[dev:carver] Set CARVER_CA_PEM (preferred), CARVER_EXTRA_CA_BUNDLE=/abs/path/to/bundle.pem, or NODE_EXTRA_CA_CERTS=/abs/path/to/bundle.pem before launching."
    );
  } else {
    if (!fs.existsSync(resolved.path)) {
      console.error(
        `[dev:carver] ${resolved.source} points to a missing file: ${resolved.path}`
      );
      process.exit(1);
    }

    const pemContent = fs.readFileSync(resolved.path, "utf8");
    env.CARVER_CA_PEM = pemContent;
    env.NODE_EXTRA_CA_CERTS = resolved.path;
    console.log(
      `[dev:carver] Loaded CARVER_CA_PEM from ${resolved.path} and set NODE_EXTRA_CA_CERTS=${resolved.path} (source: ${resolved.source})`
    );
  }

  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(npmCmd, ["run", "dev"], {
    stdio: "inherit",
    env
  });

  child.on("exit", (code, signal) => {
    if (typeof code === "number") {
      process.exit(code);
    }

    if (signal) {
      console.warn(`[dev:carver] Exited from signal ${signal}`);
      process.exit(1);
    }

    process.exit(0);
  });
}

run();
