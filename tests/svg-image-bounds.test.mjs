import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { svgImageBounds } from "../core/svg-image-bounds.mjs";
import { compilePreview, ensureProjectScaffold } from "../core/project.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("image marker uses the painted SVG image rectangle, not the figure plus caption", () => {
  const svg = '<svg><g transform="translate(89 73.7)"><image xlink:href="data:image/png;base64,AAAA" width="417.25" height="199.35" preserveAspectRatio="none"/></g></svg>';
  assert.deepEqual(svgImageBounds(svg), [{ x: 89, y: 73.7, width: 417.25, height: 199.35 }]);
  assert.deepEqual(svgImageBounds('<svg><text>sin imagen</text></svg>'), []);
});

test("preview exposes real per-page image bounds", async (t) => {
  const root = fs.mkdtempSync("/tmp/opencode/image-bounds-");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  ensureProjectScaffold(root, path.join(repo, "theme"));
  fs.mkdirSync(path.join(root, "assets"));
  fs.copyFileSync(path.join(repo, "assets", "figura-arquitectura.png"), path.join(root, "assets", "figura-arquitectura.png"));
  fs.writeFileSync(path.join(root, "test.md"), "# Figura\n\n![Diagrama](assets/figura-arquitectura.png) {#fig:diagrama}\n");
  const result = await compilePreview(root);
  assert.equal(result.ok, true, result.error);
  assert.ok(result.pages.some((page) => page.imageBoxes.some((box) => box.width > 0 && box.height > 0 && box.x > 0)));
});
