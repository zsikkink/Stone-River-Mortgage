import fs from "node:fs";
import path from "node:path";

const nextDir = path.join(process.cwd(), ".next");
if (!fs.existsSync(nextDir)) {
  console.log("No .next cache to reset.");
  process.exit(0);
}

const backupDir = path.join(process.cwd(), `.next.stale.${Date.now()}`);

try {
  fs.renameSync(nextDir, backupDir);
  try {
    fs.rmSync(backupDir, { recursive: true, force: true });
    console.log("Reset .next cache.");
  } catch {
    console.log(`Moved stale cache to ${path.basename(backupDir)} (cleanup deferred).`);
  }
} catch (error) {
  console.error("Unable to reset .next cache:", error);
  process.exit(1);
}
