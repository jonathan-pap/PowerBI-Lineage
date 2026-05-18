/**
 * CLI smoke test — `powerbi-lineage prompt …` subcommand.
 *
 * Spawned as a subprocess because runPromptSubcommand calls
 * process.exit() — importing it directly would kill the test runner.
 * The compiled app.js lives at dist-test/src/app.js under the test
 * tsconfig output dir, same layout as the other server-side modules.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const APP_JS = path.resolve("dist-test/src/app.js");
const FIXTURE = "test/Health_and_Safety.Report";
const APP_EXISTS = fs.existsSync(APP_JS);
const FIXTURE_EXISTS = fs.existsSync(path.resolve(FIXTURE));

function runCli(args: string[]): { code: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [APP_JS, ...args], {
    encoding: "utf8",
    // Generous — the parser has to walk the H&S model.
    timeout: 30_000,
  });
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

test("CLI prompt — missing --category exits non-zero with usage on stderr", { skip: !APP_EXISTS }, () => {
  const r = runCli(["prompt", "--report", "anywhere"]);
  assert.notEqual(r.code, 0, "expected non-zero exit for missing --category");
  assert.ok(r.stderr.includes("--category"), "stderr should mention --category");
});

test("CLI prompt — unknown --category exits non-zero", { skip: !APP_EXISTS }, () => {
  const r = runCli(["prompt", "--category", "nonsense", "--report", "anywhere"]);
  assert.notEqual(r.code, 0, "expected non-zero exit for unknown category");
});

test("CLI prompt — missing --report exits non-zero", { skip: !APP_EXISTS }, () => {
  const r = runCli(["prompt", "--category", "unused-measures"]);
  assert.notEqual(r.code, 0, "expected non-zero exit for missing --report");
  assert.ok(r.stderr.includes("--report"), "stderr should mention --report");
});

test("CLI prompt — --help prints usage and exits 0", { skip: !APP_EXISTS }, () => {
  const r = runCli(["prompt", "--help"]);
  assert.equal(r.code, 0, "expected exit 0 on --help");
  assert.ok(r.stderr.includes("--category") || r.stdout.includes("--category"),
    "usage output should describe --category");
});

test("CLI prompt — emits prompt to stdout against H&S fixture", { skip: !APP_EXISTS || !FIXTURE_EXISTS }, () => {
  const r = runCli(["prompt", "--category", "measures-all", "--report", path.resolve(FIXTURE)]);
  assert.equal(r.code, 0, `expected exit 0, got ${r.code}. stderr: ${r.stderr}`);
  assert.ok(r.stdout.startsWith("# Cleanup task"),
    "expected prompt to start with the Cleanup task H1");
  assert.ok(r.stdout.includes("## Safety constraints"),
    "expected safety constraints section");
  assert.ok(r.stdout.includes("## Targets"),
    "expected Targets section");
});

test("CLI prompt — --output writes to file instead of stdout", { skip: !APP_EXISTS || !FIXTURE_EXISTS }, () => {
  const outFile = path.resolve("dist-test/cli-prompt-output.tmp.md");
  // Best-effort cleanup if a prior run crashed mid-flight.
  try { fs.unlinkSync(outFile); } catch {}
  const r = runCli(["prompt", "--category", "unused-measures", "--report", path.resolve(FIXTURE), "--output", outFile]);
  try {
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}. stderr: ${r.stderr}`);
    assert.equal(r.stdout, "", "stdout should be empty when --output is set");
    assert.ok(fs.existsSync(outFile), "output file should exist after run");
    const body = fs.readFileSync(outFile, "utf8");
    assert.ok(body.includes("# Cleanup task"), "file should contain the prompt header");
  } finally {
    try { fs.unlinkSync(outFile); } catch {}
  }
});
