// One command for the complete memory release gate.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const manifest = JSON.parse(
  readFileSync(join(here, "fixtures", "memory-regression-manifest.json"), "utf8"),
);
const startedAt = Date.now();

function runSuite(suite) {
  return new Promise((resolve, reject) => {
    const [command, ...args] = suite.command.split(/\s+/);
    const child = spawn(command, args, {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
      process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) return reject(new Error(`process exited with ${code}`));
      if (!output.includes(suite.successMarker)) {
        return reject(new Error(`missing success marker: ${suite.successMarker}`));
      }
      resolve();
    });
  });
}

for (const [index, suite] of manifest.suites.entries()) {
  console.log(`\n[${index + 1}/${manifest.suites.length}] ${suite.name}`);
  try {
    await runSuite(suite);
  } catch (error) {
    console.error(
      `\nMemory release gate failed in: ${suite.name} (${error instanceof Error ? error.message : error})`,
    );
    process.exit(1);
  }
}

const duration = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`\n✅  ${manifest.suites.length} memory suites passed in ${duration}s`);
