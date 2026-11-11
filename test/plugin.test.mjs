import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = (root, name) => join(root, ".claude-plugin", name);
const json = (file) => JSON.parse(readFileSync(file, "utf8"));

function validate(root) {
  const marketplace = json(manifest(root, "marketplace.json"));
  const plugin = json(manifest(root, "plugin.json"));

  assert.equal(marketplace.name, "unslop", "marketplace install name changed");
  assert.equal(plugin.name, "unslop", "plugin command namespace changed");
  assert.ok(marketplace.owner?.name, "marketplace owner is missing");

  const entries = marketplace.plugins?.filter((entry) => entry.name === plugin.name);
  assert.equal(entries?.length, 1, "marketplace must list the unslop plugin exactly once");
  const source = entries[0].source;
  assert.equal(typeof source, "string", "plugin source must be a local path");
  assert.ok(source.startsWith("./"), "plugin source must be relative to the marketplace root");

  const pluginRoot = resolve(root, source);
  const fromRoot = relative(root, pluginRoot);
  assert.ok(!isAbsolute(fromRoot) && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`), "plugin source escapes the marketplace root");
  assert.equal(json(join(pluginRoot, ".claude-plugin", "plugin.json")).name, plugin.name, "plugin source has a different name");
  assert.ok(existsSync(join(pluginRoot, "skills", "unslop", "SKILL.md")), "plugin source does not expose the unslop skill");
}

function fixture(t, change = () => {}) {
  const root = mkdtempSync(join(tmpdir(), "unslop-plugin-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".claude-plugin"));
  mkdirSync(join(root, "skills", "unslop"), { recursive: true });
  const marketplace = { name: "unslop", owner: { name: "heydamir" }, plugins: [{ name: "unslop", source: "./" }] };
  const plugin = { name: "unslop" };
  change({ marketplace, plugin, root });
  writeFileSync(manifest(root, "marketplace.json"), JSON.stringify(marketplace));
  writeFileSync(manifest(root, "plugin.json"), JSON.stringify(plugin));
  writeFileSync(join(root, "skills", "unslop", "SKILL.md"), "---\nname: unslop\n---\n");
  return root;
}

test("the repository marketplace exposes the unslop skill", (t) => {
  const files = [manifest(repo, "marketplace.json"), manifest(repo, "plugin.json")];
  if (files.every((file) => !existsSync(file))) {
    t.skip("plugin manifests are being added by PR #26");
    return;
  }
  validate(repo);
});

test("valid marketplace and plugin layout passes", (t) => {
  assert.doesNotThrow(() => validate(fixture(t)));
});

test("a marketplace entry with a different name fails", (t) => {
  const root = fixture(t, ({ marketplace }) => { marketplace.plugins[0].name = "other"; });
  assert.throws(() => validate(root), /list the unslop plugin exactly once/);
});

test("a missing skill fails", (t) => {
  const root = fixture(t);
  rmSync(join(root, "skills", "unslop", "SKILL.md"));
  assert.throws(() => validate(root), /does not expose the unslop skill/);
});

test("a source outside the marketplace fails", (t) => {
  const root = fixture(t, ({ marketplace }) => { marketplace.plugins[0].source = "./../other"; });
  assert.throws(() => validate(root), /escapes the marketplace root/);
});
