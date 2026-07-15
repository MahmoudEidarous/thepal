import { spawnSync } from "node:child_process";

function run(label, script) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync("npm", ["run", script], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  return result.status ?? 1;
}

let status = run("memory release regression gate", "eval:memory-release");
if (status === 0) status = run("production build", "build");

// The live/model-backed suites intentionally use the eval namespace. Always
// remove their provider and canonical residue, including after a failed gate.
const resetStatus = run("evaluation-space cleanup", "memory:eval:reset");
if (status === 0 && resetStatus !== 0) status = resetStatus;

if (status === 0) status = run("live integration readiness", "memory:preflight:runtime");
if (status !== 0) {
  console.error("\nMemory preflight did not reach a release-ready state.");
  process.exit(status);
}

console.log("\n✅  Full memory preflight passed: release gate, build, cleanup, and live readiness.");
