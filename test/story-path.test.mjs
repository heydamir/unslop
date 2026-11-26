import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeStoryPath, resolveStoryFile } from "../skills/unslop/scripts/story-path.mjs";

// A root with a sibling whose name starts with the root's, the shape
// the prefix check gets wrong: /tmp/x/site vs /tmp/x/site-private.
const setup = () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "unslop-story-path-")));
  const root = join(base, "site");
  const sibling = join(base, "site-private");
  mkdirSync(join(root, "sub"), { recursive: true });
  mkdirSync(sibling, { recursive: true });
  writeFileSync(join(root, "asset.txt"), "asset");
  writeFileSync(join(root, "sub", "inner.txt"), "inner");
  writeFileSync(join(sibling, "secret.txt"), "secret");
  symlinkSync(join(sibling, "secret.txt"), join(root, "link-out"));
  symlinkSync(join(root, "asset.txt"), join(root, "link-in"));
  return { root, sibling };
};

test("serves a file directly under root", () => {
  const { root } = setup();
  assert.equal(resolveStoryFile(root, "/__story/asset.txt"), join(root, "asset.txt"));
});

test("serves a nested file under root", () => {
  const { root } = setup();
  assert.equal(resolveStoryFile(root, "/__story/sub/inner.txt"), join(root, "sub", "inner.txt"));
});

test("serves a path that normalizes back inside root", () => {
  const { root } = setup();
  assert.equal(resolveStoryFile(root, "/__story/sub/../asset.txt"), join(root, "asset.txt"));
});

test("rejects a missing file", () => {
  const { root } = setup();
  assert.equal(resolveStoryFile(root, "/__story/nope.txt"), null);
});

test("rejects the root itself, which is a directory, not a file", () => {
  const { root } = setup();
  assert.equal(resolveStoryFile(root, "/__story/"), null);
});

test("rejects a sibling directory whose name starts with the root's", () => {
  const { root } = setup();
  assert.equal(resolveStoryFile(root, "/__story/../site-private/secret.txt"), null);
});

test("rejects a deeper escape through a nested path", () => {
  const { root } = setup();
  assert.equal(resolveStoryFile(root, "/__story/sub/../../site-private/secret.txt"), null);
});

test("rejects a symlink inside root that points outside it", () => {
  const { root } = setup();
  assert.equal(resolveStoryFile(root, "/__story/link-out"), null);
});

test("serves a symlink inside root that points inside it", () => {
  const { root } = setup();
  assert.equal(resolveStoryFile(root, "/__story/link-in"), join(root, "asset.txt"));
});

test("decodes an escaped request path and drops the query", () => {
  assert.equal(decodeStoryPath("/__story/50%25%20off.png?v=2"), "/__story/50% off.png");
});

test("a malformed escape decodes to null instead of throwing", () => {
  assert.equal(decodeStoryPath("/__story/50%off.png"), null);
  assert.equal(decodeStoryPath("/__story/%E0%A4%A"), null);
});
