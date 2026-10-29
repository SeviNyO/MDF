import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildOutline } from "../core/outline.mjs";
import { ensureProjectScaffold, loadConfig, writeBook } from "../core/project.mjs";
import { exportHtml } from "../core/md2html.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("sidebar, HTML and PDF keep exactly the authored heading number", async (t) => {
  const root = fs.mkdtempSync("/tmp/opencode/exact-outline-");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  ensureProjectScaffold(root, path.join(repo, "theme"));
  fs.writeFileSync(path.join(root, "test.md"), "### 2.6.5.6 Prueba\n");
  const outline = buildOutline(root, loadConfig(root), "test.md");
  assert.deepEqual(outline.filter((entry) => entry.file === "test.md"), [
    { file: "test.md", line: 1, depth: 3, text: "2.6.5.6 Prueba" },
  ]);
  await writeBook(root);
  const typ = fs.readFileSync(path.join(root, "build", "book.typ"), "utf8");
  assert.match(typ, /#set heading\(numbering: none\)/);
  assert.doesNotMatch(typ, /#(?:cover|toc-page|lof-page)\(/);
  const output = path.join(root, "check.html");
  await exportHtml(root, loadConfig(root), output);
  const html = fs.readFileSync(output, "utf8");
  assert.match(html, /<h3[^>]*>2\.6\.5\.6 Prueba<\/h3>/);
  assert.doesNotMatch(html, /class="cover"|class="toc"/);
  if (spawnSync("typst", ["--version"]).status === 0 && spawnSync("pdftotext", ["-v"]).status === 0) {
    const pdf = path.join(root, "check.pdf");
    const result = spawnSync("typst", ["compile", "--root", root, "--font-path", path.join(root, "theme", "fonts"), path.join(root, "build", "book.typ"), pdf], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const text = spawnSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8" }).stdout;
    assert.match(text, /2\.6\.5\.6 Prueba/);
    assert.doesNotMatch(text, /\d+\.2\.6\.5\.6 Prueba/);
  }
});
