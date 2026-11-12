import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skill = join(root, "skills", "travel-unslop");
const original = join(root, "skills", "unslop");

const read = (...parts) => readFileSync(join(...parts), "utf8");
const docs = ["SKILL.md", ...readdirSync(join(skill, "references")).filter((f) => f.endsWith(".md")).map((f) => join("references", f))];

const frontmatter = (text) => {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, "SKILL.md starts with frontmatter");
  const fields = {};
  for (const line of match[1].split("\n")) {
    const m = line.match(/^([a-z_]+):\s*(.*)$/);
    if (m) fields[m[1]] = m[2];
  }
  return fields;
};

// 헤딩을 GitHub 방식의 앵커로 바꾼다
const slug = (heading) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");

test("frontmatter names the skill after its folder and stays within limits", () => {
  const fields = frontmatter(read(skill, "SKILL.md"));
  assert.equal(fields.name, "travel-unslop");
  assert.ok(fields.description.length > 0, "description is present");
  assert.ok(fields.description.length <= 1024, `description is ${fields.description.length} chars, limit 1024`);
  assert.equal(fields.license, "CC-BY-4.0");
  for (const word of ["여행사", "검색", "예약", "travel"]) {
    assert.ok(fields.description.includes(word), `description mentions ${word}`);
  }
});

test("every relative link in the skill docs points at a real file or heading", () => {
  for (const doc of docs) {
    const text = read(skill, doc);
    const headings = new Set([...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => slug(m[1])));
    for (const [, target] of text.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^https?:/.test(target)) continue;
      if (target.startsWith("#")) {
        assert.ok(headings.has(decodeURIComponent(target.slice(1))), `${doc}: anchor ${target} has no heading`);
        continue;
      }
      const path = resolve(dirname(join(skill, doc)), target.split("#")[0]);
      assert.ok(existsSync(path), `${doc}: link ${target} does not exist`);
    }
  }
});

test("every doc keeps the credit the CC BY 4.0 license asks for", () => {
  for (const doc of docs) {
    const text = read(skill, doc);
    assert.match(text, /Damir Sokolovsky/, `${doc} credits the original author`);
    assert.match(text, /CC BY 4\.0/, `${doc} names the license`);
  }
});

test("SKILL.md covers the three pillars, both modes and all nine passes", () => {
  const text = read(skill, "SKILL.md");
  for (const heading of ["세 개의 축", "개선 모드", "신규 모드", "방향", "보고서", "하지 말 것", "체크리스트"]) {
    assert.match(text, new RegExp(`^#{2,3} ${heading}$`, "m"), `has a ${heading} section`);
  }
  const passes = [...text.matchAll(/^## (\d)\. (.+)$/gm)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(passes, ["1 간격", "2 색", "3 아이콘", "4 카피", "5 타입", "6 레이아웃", "7 디테일", "8 비주얼", "9 모션"]);
  for (const ref of ["signs", "pages", "search", "booking", "visuals", "tokens"]) {
    assert.ok(text.includes(`references/${ref}.md`), `links references/${ref}.md`);
  }
  assert.ok(text.split("\n").length <= 500, "SKILL.md stays under 500 lines");
});

test("the checklist has a group for each pillar", () => {
  const checklist = read(skill, "SKILL.md").split(/^## 체크리스트$/m)[1];
  for (const group of ["기본", "검색", "감성", "신뢰", "마지막"]) {
    assert.match(checklist, new RegExp(`^${group}$`, "m"), `checklist has a ${group} group`);
  }
  assert.ok((checklist.match(/^- \[ \]/gm) || []).length >= 30, "checklist has at least 30 items");
});

test("booking.md refuses to give legal advice or invent facts", () => {
  const text = read(skill, "references", "booking.md");
  assert.match(text, /법률 자문이 아닙니다/);
  assert.match(text, /지어내지/);
});

test("the snapshot script is an unmodified copy of the original", () => {
  assert.equal(read(skill, "scripts", "snapshot.mjs"), read(original, "scripts", "snapshot.mjs"));
});

test("the original unslop skill is untouched by the fork", () => {
  assert.equal(frontmatter(read(original, "SKILL.md")).name, "unslop");
});

test("the example page carries the travel signs the audit should find", () => {
  const html = read(root, "examples", "travel-home.html");
  const signs = {
    "auto carousel hero": /animation: slide/,
    "fake countdown timer": /class="timer"/,
    "fake viewers": /명이 보고 있어요/,
    "fake booking popup": /방금 김\*\*님이/,
    "badge pile": /class="badge/,
    "struck through list price": /<s>/,
    "mixed price formats": /₩1200000/,
    "hype copy": /초특가/,
    "emoji navigation": /🏝️ 패키지/,
    "placeholder as label": /placeholder="언제 떠나시나요/,
    "destination as a select": /<select>/,
    "gradient text": /gradient-text/,
    "price excludes mandatory fees": /제세공과금 불포함/,
  };
  for (const [name, pattern] of Object.entries(signs)) {
    assert.match(html, pattern, `example shows: ${name}`);
  }
  assert.ok(html.indexOf('class="search') > html.indexOf('class="grid"'), "search sits below the product grid");
});
