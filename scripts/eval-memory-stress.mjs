import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryEventLedger } from "../lib/memory/event-ledger.ts";

const directory = mkdtempSync(join(tmpdir(), "recall-memory-stress-"));
const databasePath = join(directory, "memory.sqlite");
const writer = fileURLToPath(new URL("./helpers/memory-ledger-writer.mjs", import.meta.url));
let checks = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  checks += 1;
  console.log(`✅  ${message}`);
};

function runWriter(worker, count, shared = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [writer, databasePath, String(worker), String(count), shared], {
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) return reject(new Error(stderr || `writer ${worker} exited ${code}`));
      resolve(JSON.parse(stdout));
    });
  });
}

let ledger = new MemoryEventLedger({ databasePath });
try {
  ledger.close();
  const batches = await Promise.all([
    runWriter(1, 25),
    runWriter(2, 25),
    runWriter(3, 25),
    runWriter(4, 25),
  ]);
  check(batches.flat().length === 100, "four processes completed 100 concurrent captures");
  check(new Set(batches.flat().map((receipt) => receipt.eventId)).size === 100, "concurrent unique captures never collided");

  const duplicateRace = await Promise.all([
    runWriter("race-a", 1, "stress:shared-idempotency"),
    runWriter("race-b", 1, "stress:shared-idempotency"),
  ]);
  const raced = duplicateRace.flat();
  check(raced[0].eventId === raced[1].eventId, "concurrent idempotent requests converge on one event");
  check(raced.some((receipt) => receipt.duplicate), "the losing idempotency racer receives the existing receipt");

  ledger = new MemoryEventLedger({ databasePath });
  let stats = ledger.stats();
  check(stats.events === 101, "stress run persisted exactly 101 canonical events");
  check(stats.jobs.pending === 101 && stats.stateJobs.pending === 101, "both transactional job families match event count");
  check(stats.integrity === "ok", "concurrent WAL writes preserve SQLite integrity");

  const mirrorJob = ledger.claimNextJob();
  const stateJob = ledger.claimNextStateJob();
  check(mirrorJob?.status === "processing" && stateJob?.status === "processing", "jobs can be leased before a simulated crash");
  ledger.close();

  ledger = new MemoryEventLedger({ databasePath });
  const future = new Date(Date.now() + 60_000).toISOString();
  const now = new Date(Date.now() + 120_000).toISOString();
  check(ledger.recoverStaleJobs({ before: future, now }) === 1, "restart recovers an abandoned mirror lease");
  check(ledger.recoverStaleStateJobs({ before: future, now }) === 1, "restart recovers an abandoned projection lease");
  stats = ledger.stats();
  check(stats.jobs.processing === 0 && stats.stateJobs.processing === 0, "no processing lease remains stranded after recovery");
  check(stats.integrity === "ok", "post-crash recovery leaves the database healthy");

  console.log(`\n${checks} memory-stress checks passed`);
} finally {
  try {
    ledger.close();
  } catch {}
  rmSync(directory, { recursive: true, force: true });
}
