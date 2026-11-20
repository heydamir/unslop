import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skill = join(root, "skills", "unslop");
const read = (file) => readFileSync(file, "utf8");

const frontmatter = (text) => {
  const match = /^---\n([\s\S]*?)\n---/.exec(text);
  return match ? match[1] : "";
};

const description = frontmatter(read(join(skill, "SKILL.md")))
  .split("\n")
  .find((line) => line.startsWith("description:"))
  ?.slice("description:".length)
  .trim();

// Claude Code refuses to load a skill whose description runs past this,
// and the whole skill silently disappears from the list.
test("the skill description fits the 1024 character limit", () => {
  assert.ok(description, "the skill has no description");
  assert.ok(description.length <= 1024, `the description is ${description.length} characters, over the 1024 limit`);
});

// The skill only activates for a screen it recognises, so a screen type it
// handles but never names is a screen it never gets called on.
test("the description names the right to left scripts the skill handles", () => {
  assert.match(description, /Arabic/i);
  assert.match(description, /right-to-left|right to left|RTL/i);
});

// Every relative link in the skill must resolve, because a broken one sends
// the agent to a file it cannot read, or to a missing anchor, silently.
const broken = (file) => {
  const text = read(file);
  const dir = dirname(file);
  const missing = [];
  for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const path = resolve(dir, target);
    if (!existsSync(path)) {
      missing.push(`${target} (from ${file.slice(root.length + 1)})`);
      continue;
    }
    if (target.includes("#") && path.endsWith(".md")) {
      const [, anchor] = target.split("#");
      const heading = anchor.replace(/-/g, " ");
      const body = read(path).toLowerCase();
      if (!body.includes(heading) && !body.includes(anchor.toLowerCase())) {
        missing.push(`${target} (no heading matches the anchor)`);
      }
    }
  }
  return missing;
};

const docs = ["SKILL.md", ...["effects", "refs", "rtl", "scripts", "signs", "story", "tokens", "visuals"].map((name) => join("references", `${name}.md`))];

for (const doc of docs) {
  test(`${doc} has no broken relative links`, () => {
    assert.deepEqual(broken(join(skill, doc)), []);
  });
}

// A reference nothing links to is dead weight that still ships in the
// plugin, and usually means a rule was moved and then lost.
test("every reference is linked from somewhere", () => {
  const sources = ["SKILL.md", "references/story.md"].map((file) => read(join(skill, file)));
  for (const file of ["effects", "refs", "rtl", "signs", "story", "tokens", "visuals"]) {
    const target = `references/${file}.md`;
    assert.ok(sources.some((text) => text.includes(target)), `${target} is never linked`);
  }
});

test("SKILL.md stays small enough to load on every run", () => {
  const size = statSync(join(skill, "SKILL.md")).size;
  assert.ok(size < 30_000, `SKILL.md is ${size} bytes, move a section into references/`);
});

// The README is the first thing a visitor reads, so a count that no longer
// matches the examples folder reads as carelessness.
test("the README example count matches the examples folder", () => {
  const readme = read(join(root, "README.md"));
  const words = { one: 1, two: 2, three: 3, four: 4 };
  const said = /the (\w+) vibecoded screens/i.exec(readme)?.[1]?.toLowerCase();
  assert.ok(said in words, `the README says "${said}" screens`);
  const actual = ["dashboard", "hero", "store"].filter((name) => existsSync(join(root, "examples", `${name}.html`))).length;
  assert.equal(words[said], actual, `the README says ${words[said]} screens but examples has ${actual}`);
});
