import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { convert } from "../core/md2typst.mjs";
import { ensureProjectScaffold, loadConfig, writeBook } from "../core/project.mjs";
import { renderChapterHtml, exportHtml } from "../core/md2html.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const htmlTable = `<table id="iam">
<thead><tr><th colspan="3"><b>IAM Identity Access Management</b></th></tr></thead>
<div style="display:table-row-group"><tr><td rowspan="2">Rol<br><b>principal</b></td><td><img src="assets/logo.png" width="1000" alt="Logo"></td><td>abcdefghijklmnopqrstuvwxyzininterrumpidamente</td></tr>
<tr><td colspan="2"><b>Permisos</b><br>lectura</td></tr></div>
</table>`;

test("complex HTML table retains row groups, spans, bold, breaks and bounded cell images", async (t) => {
  const root = fs.mkdtempSync("/tmp/opencode/complex-table-");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  ensureProjectScaffold(root, path.join(repo, "theme"));
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  fs.copyFileSync(path.join(repo, "assets", "figura-arquitectura.png"), path.join(root, "assets", "logo.png"));
  fs.writeFileSync(path.join(root, "test.md"), htmlTable);
  const reading = await renderChapterHtml(root, loadConfig(root), "test.md");
  assert.match(reading, /<thead>/);
  assert.match(reading, /<tbody style="display:table-row-group"><tr>/);
  assert.match(reading, /colspan="3"/);
  assert.match(reading, /<b>Permisos<\/b><br>lectura/);
  assert.match(reading, /data-src="assets\/logo.png"/);
  const exported = path.join(root, "check.html");
  await exportHtml(root, loadConfig(root), exported);
  assert.match(fs.readFileSync(exported, "utf8"), /table-layout:fixed!important/);
  assert.match(fs.readFileSync(exported, "utf8"), /max-width:100%!important/);

  const typst = convert(htmlTable, { resolveImage: (src) => src }).typst;
  assert.match(typst, /colspan: 3/);
  assert.match(typst, /rowspan: 2/);
  assert.doesNotMatch(typst, /fill: luma\(238\)|stroke: 0\.5pt \+ luma\(200\)/);
  assert.match(typst, /\*Permisos\* #linebreak\(\) lectura/);
  assert.match(typst, /#box\(width: 100%\)\[#fit-image\("\/assets\/logo.png"/);
  await writeBook(root);
  if (spawnSync("typst", ["--version"]).status === 0) {
    const result = spawnSync("typst", ["compile", "--root", root, "--font-path", path.join(root, "theme", "fonts"), path.join(root, "build", "book.typ"), path.join(root, "check.pdf")], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
});

test("GFM table with merged cells and an HTML image remains bounded in reading view and PDF", async (t) => {
  const root = fs.mkdtempSync("/tmp/opencode/merged-table-");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  ensureProjectScaffold(root, path.join(repo, "theme"));
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  fs.copyFileSync(path.join(repo, "assets", "figura-arquitectura.png"), path.join(root, "assets", "logo.png"));
  const metadata = encodeURIComponent(JSON.stringify({ merges: "r2c1:1x2" }));
  const markdown = `<!-- mdpdf-table:${metadata} -->\n\n| Imagen | Descripción |\n| :--- | :--- |\n| <img src="assets/logo.png" width="1500" alt="Logo"> | |`;
  fs.writeFileSync(path.join(root, "test.md"), markdown);
  const reading = await renderChapterHtml(root, loadConfig(root), "test.md");
  assert.match(reading, /colspan="2"/);
  assert.match(reading, /data-src="assets\/logo.png"/);
  const typst = convert(markdown, { resolveImage: (src) => src }).typst;
  assert.match(typst, /colspan: 2/);
  assert.match(typst, /#box\(width: 100%\)\[#fit-image\("\/assets\/logo.png"/);
  await writeBook(root);
  if (spawnSync("typst", ["--version"]).status === 0) {
    const result = spawnSync("typst", ["compile", "--root", root, "--font-path", path.join(root, "theme", "fonts"), path.join(root, "build", "book.typ"), path.join(root, "check.pdf")], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
});
