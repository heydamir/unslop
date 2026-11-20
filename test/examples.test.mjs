import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "skills", "unslop", "scripts", "snapshot.mjs");
const NO_BROWSER = /Playwright is not installed|Executable doesn't exist/;

// The examples are the first thing a new user opens, and nothing else in
// the suite looks at them, so a broken one ships unnoticed.
const examples = ["dashboard.html", "hero.html", "store.html"];

const run = (args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 120_000 });

for (const name of examples) {
  test(`examples/${name} renders and snapshots with its styles intact`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), "unslop-example-"));
    const out = join(dir, "out.html");
    const result = run([join(root, "examples", name), out]);
    if (NO_BROWSER.test(result.stderr ?? "")) {
      t.skip("Playwright or Chromium is not installed here");
      return;
    }
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(out), "the snapshot was not written");

    const html = readFileSync(out, "utf8");
    assert.doesNotMatch(html, /<style>\s*<\/style>/, "the page lost its styles");
    assert.ok(html.length > 5_000, `the snapshot is suspiciously small (${html.length} bytes)`);
    assert.doesNotMatch(html, /<script/, "scripts should be stripped from a snapshot");
  });
}
