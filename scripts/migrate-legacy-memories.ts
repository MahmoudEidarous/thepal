import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyLegacyImport,
  listAllSupermemoryDocuments,
  planLegacyImport,
} from "../lib/memory/legacy-import";
import { materializeContinuityKernel } from "../lib/memory/continuity-kernel";
import { getMemoryEventLedger } from "../lib/memory/event-ledger";
import type { MemorySpace } from "../lib/memory/contracts";

const apply = process.argv.includes("--apply");
const spaceArg = process.argv.find((value) => value.startsWith("--space="))?.split("=")[1];
const space: MemorySpace =
  spaceArg === "work" || spaceArg === "health" || spaceArg === "eval" ? spaceArg : "personal";
const root = process.cwd();
const ledger = getMemoryEventLedger();
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const migrationDir = join(root, ".recall", "migrations");
mkdirSync(migrationDir, { recursive: true });

function writePrivate(path: string, value: string) {
  writeFileSync(path, value, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function sha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function createBackup() {
  const directory = join(root, ".recall", "backups", `${stamp}-pre-legacy-import`);
  mkdirSync(directory, { recursive: true });
  const sqlitePath = join(directory, "memory.sqlite");
  const source = new DatabaseSync(ledger.databasePath);
  try {
    source.exec("PRAGMA wal_checkpoint(FULL)");
    const escapedPath = sqlitePath.replaceAll("'", "''");
    source.exec(`VACUUM INTO '${escapedPath}'`);
  } finally {
    source.close();
  }
  chmodSync(sqlitePath, 0o600);
  const corpusPath = join(directory, "supermemory-corpus.json");
  const corpus: Record<string, Awaited<ReturnType<typeof listAllSupermemoryDocuments>>> = {};
  for (const selected of ["personal", "work", "health", "eval"] as const) {
    corpus[selected] = await listAllSupermemoryDocuments(selected);
  }
  writePrivate(
    corpusPath,
    JSON.stringify({ version: 1, createdAt: new Date().toISOString(), corpus }, null, 2),
  );
  const manifestPath = join(directory, "manifest.json");
  writePrivate(
    manifestPath,
    JSON.stringify(
      {
        version: 1,
        createdAt: new Date().toISOString(),
        files: {
          "memory.sqlite": { sha256: sha256(sqlitePath) },
          "supermemory-corpus.json": { sha256: sha256(corpusPath) },
        },
        restore:
          "Stop Recall, restore memory.sqlite to .recall/memory.sqlite, then restore provider documents from the local corpus snapshot only if needed.",
      },
      null,
      2,
    ),
  );
  return directory;
}

const documents = await listAllSupermemoryDocuments(space);
const plan = planLegacyImport({ documents, ledger, space });
const reportPath = join(migrationDir, `${stamp}-${space}-${apply ? "apply" : "dry-run"}.json`);
writePrivate(reportPath, JSON.stringify(plan, null, 2));

console.log(
  JSON.stringify(
    {
      mode: apply ? "apply" : "dry-run",
      space,
      documents: plan.documents,
      counts: plan.counts,
      reportPath,
    },
    null,
    2,
  ),
);

if (!apply) process.exit(0);
if (plan.counts.blocked > 0) {
  throw new Error(`refusing migration with ${plan.counts.blocked} blocked documents; inspect ${reportPath}`);
}

const backupPath = await createBackup();
console.log(`Backup complete: ${backupPath}`);
let lastStage = "";
let lastReported = 0;
const result = await applyLegacyImport({
  plan,
  ledger,
  onProgress(progress) {
    if (
      progress.stage !== lastStage ||
      progress.completed === progress.total ||
      progress.completed - lastReported >= 24
    ) {
      console.log(`${progress.stage}: ${progress.completed}/${progress.total}`);
      lastStage = progress.stage;
      lastReported = progress.completed;
    }
  },
});
const materialized = materializeContinuityKernel({ space, force: true });
const completedPath = join(migrationDir, `${stamp}-${space}-completed.json`);
writePrivate(
  completedPath,
  JSON.stringify(
    {
      version: 1,
      completedAt: new Date().toISOString(),
      backupPath,
      reportPath,
      result,
      kernel: {
        tokenCount: materialized.kernel.tokenCount,
        compiledAt: materialized.kernel.compiledAt,
        hardLimit: 5_000,
      },
      integrity: ledger.stats().integrity,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    {
      migrated: result,
      kernelTokens: materialized.kernel.tokenCount,
      integrity: ledger.stats().integrity,
      completedPath,
    },
    null,
    2,
  ),
);
