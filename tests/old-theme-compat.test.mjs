import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureProjectScaffold, loadConfig, writeBook } from "../core/project.mjs";
import { renderChapterHtml } from "../core/md2html.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("an existing project theme without fit-image still compiles HTML images", async () => {
  const tempParent = fs.existsSync("/tmp/opencode") ? "/tmp/opencode" : os.tmpdir();
  const root = fs.mkdtempSync(path.join(tempParent, "informe-old-theme-"));
  try {
    ensureProjectScaffold(root, path.join(repo, "theme"));
    const themePath = path.join(root, "theme", "theme.typ");
    const theme = fs.readFileSync(themePath, "utf8");
    const oldTheme = theme.replace(/\/\/ Limita imágenes excepcionalmente altas[\s\S]*?\n#let callout/, "#let callout");
    assert.notEqual(oldTheme, theme);
    fs.writeFileSync(themePath, oldTheme);
    fs.mkdirSync(path.join(root, "assets"));
    fs.copyFileSync(path.join(repo, "assets", "figura-arquitectura.png"), path.join(root, "assets", "logo.png"));
    fs.writeFileSync(path.join(root, "test.md"), '<div align="center">\n<img src="assets/logo.png" width="150" alt="Logo UPC">\n</div>\n\n<p align="center" style="text-align:center"><strong>Universidad Peruana de Ciencias Aplicadas</strong></p>\n\n<h2 align="center" style="text-align:center">Informe del Trabajo Final</h2>\n');

    await writeBook(root);
    const book = fs.readFileSync(path.join(root, "build", "book.typ"), "utf8");
    assert.match(book, /#let fit-image\(/);
    assert.match(book, /#fit-image\("\/assets\/logo\.png"/);
    assert.match(book, /#align\(center\)\[\*Universidad Peruana de Ciencias Aplicadas\*\]/);
    const reading = await renderChapterHtml(root, loadConfig(root), "test.md");
    assert.match(reading, /<p align="center" style="text-align:center"><strong>Universidad Peruana de Ciencias Aplicadas<\/strong><\/p>/);
    if (spawnSync(process.env.TYPST_PATH || "typst", ["--version"]).status === 0) {
      execFileSync(process.env.TYPST_PATH || "typst", ["compile", "--root", root, "--font-path", path.join(root, "theme", "fonts"), path.join(root, "build", "book.typ"), path.join(root, "check.pdf")]);
      assert.ok(fs.statSync(path.join(root, "check.pdf")).size > 0);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
