import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { compilePreview, ensureProjectScaffold } from "../core/project.mjs";

test("preview pages keep their hash so unchanged sheets reuse the decoded image", async (t) => {
  const root = fs.mkdtempSync("/tmp/opencode/preview-cache-");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  ensureProjectScaffold(root, path.resolve("theme"));

  const chapter = path.join(root, "capitulo.md");
  const source = [
    "# Primera sección",
    "",
    "Contenido estable de la primera sección.",
    "",
    "<!-- pdf-pagebreak -->",
    "",
    "# Segunda sección",
    "",
    "Contenido estable de la segunda sección.",
    "",
  ].join("\n");
  fs.writeFileSync(chapter, source);

  const first = await compilePreview(root);
  assert.ok(first.ok);
  assert.ok(first.pages.length >= 2);
  for (const page of first.pages) assert.match(page.hash, /^[a-f0-9]{16}$/);

  const repeated = await compilePreview(root);
  assert.deepEqual(repeated.pages.map((page) => page.hash), first.pages.map((page) => page.hash));

  fs.writeFileSync(chapter, source.replace("Contenido estable de la primera", "Contenido modificado de la primera"));
  const edited = await compilePreview(root);
  const changed = edited.pages.filter((page, index) => page.hash !== first.pages[index]?.hash).length;
  // Solo la hoja que contiene el texto editado cambia de URL; el resto
  // conserva su imagen ya decodificada en el renderer.
  assert.equal(changed, 1);
});
