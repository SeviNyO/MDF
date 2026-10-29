import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureProjectScaffold, loadConfig, writeBook } from "../core/project.mjs";
import { exportHtml } from "../core/md2html.mjs";
import { createDocumentTheme, deleteDocumentTheme, listDocumentThemes, selectDocumentTheme, tableColors, themePath } from "../core/document-themes.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("presets and user templates switch without overwriting the current theme", async (t) => {
  const root = fs.mkdtempSync("/tmp/opencode/document-themes-");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  ensureProjectScaffold(root, path.join(repo, "theme"));
  const current = path.join(root, "theme", "theme.typ");
  const original = fs.readFileSync(current, "utf8");
  fs.appendFileSync(path.join(root, "book.yaml"), "# comentario propio\n");
  const themes = listDocumentThemes(root).map((theme) => theme.id);
  assert.deepEqual(themes.slice(0, 4), ["actual", "beautiful-pdf", "academico", "editorial"]);
  assert.equal(tableColors(root, "beautiful-pdf").header, "#0369a1");
  assert.equal(tableColors(root, "academico").header, "#e8f5fc");
  fs.mkdirSync(path.join(root, "manuscript"));
  fs.mkdirSync(path.join(root, "assets"));
  fs.copyFileSync(path.join(repo, "assets", "figura-arquitectura.png"), path.join(root, "assets", "figura-arquitectura.png"));
  fs.writeFileSync(path.join(root, "manuscript", "01-test.md"),
    "# 2.6 Título escrito\n\nTexto.\n\n| Columna | Valor |\n| :--- | ---: |\n| dato | 12 |\n\n![Diagrama](assets/figura-arquitectura.png) {#fig:diagrama}\n");

  await writeBook(root);
  assert.match(fs.readFileSync(path.join(root, "build", "book.typ"), "utf8"), /theme\/presets\/beautiful-pdf\.typ/);
  for (const id of ["beautiful-pdf", "academico", "editorial"]) {
    selectDocumentTheme(root, id);
    assert.equal(loadConfig(root).documentTheme, id);
    const htmlPath = path.join(root, `${id}.html`);
    await exportHtml(root, loadConfig(root), htmlPath);
    assert.match(fs.readFileSync(htmlPath, "utf8"), new RegExp(`--table-head:${tableColors(root, id).header}`));
    assert.match(fs.readFileSync(path.join(root, "book.yaml"), "utf8"), /# comentario propio/);
    await writeBook(root);
    const book = fs.readFileSync(path.join(root, "build", "book.typ"), "utf8");
    assert.match(book, new RegExp(`#import "../theme/presets/${id}\\.typ"`));
    if (spawnSync("typst", ["--version"]).status === 0) {
      const pdf = path.join(root, `${id}.pdf`);
      const result = spawnSync("typst", ["compile", "--root", root, "--font-path", path.join(root, "theme", "fonts"), path.join(root, "build", "book.typ"), pdf], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      assert.ok(fs.statSync(pdf).size > 1000);
    }
  }

  const custom = createDocumentTheme(root, "Mi tema de tesis");
  assert.deepEqual(custom, { id: "custom:mi-tema-de-tesis", path: "theme/custom/mi-tema-de-tesis.typ" });
  assert.ok(listDocumentThemes(root).some((theme) => theme.id === custom.id));
  assert.throws(() => createDocumentTheme(root, "Mi tema de tesis"), /Ya existe/);
  assert.throws(() => themePath(root, "custom:../../otro"), /no válido/);
  selectDocumentTheme(root, custom.id);
  await writeBook(root);
  assert.match(fs.readFileSync(path.join(root, "build", "book.typ"), "utf8"), /theme\/custom\/mi-tema-de-tesis\.typ/);
  selectDocumentTheme(root, "actual");
  ensureProjectScaffold(root, path.join(repo, "theme"));
  assert.equal(fs.readFileSync(current, "utf8"), original);
  assert.ok(fs.existsSync(path.join(root, custom.path)));
  assert.equal(loadConfig(root).documentTheme, "actual");
  assert.throws(() => deleteDocumentTheme(root, "actual", "actual"), /protegido/);
  assert.throws(() => deleteDocumentTheme(root, custom.id, "tema equivocado"), /Escribe exactamente/);
  assert.ok(fs.existsSync(path.join(root, custom.path)));
  deleteDocumentTheme(root, custom.id, custom.id);
  assert.ok(!fs.existsSync(path.join(root, custom.path)));
  selectDocumentTheme(root, "beautiful-pdf");
  const deleted = deleteDocumentTheme(root, "beautiful-pdf", "Beautiful PDF (Proposal)");
  assert.equal(deleted.selected, "actual");
  ensureProjectScaffold(root, path.join(repo, "theme"));
  assert.ok(!fs.existsSync(path.join(root, "theme", "presets", "beautiful-pdf.typ")));
  assert.ok(!listDocumentThemes(root).some((theme) => theme.id === "beautiful-pdf"));
});
