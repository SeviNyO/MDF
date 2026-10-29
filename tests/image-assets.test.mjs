import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { copyImageToAssets } from "../core/image-assets.mjs";

test("an image chosen outside the project is physically duplicated in assets", (t) => {
  const outside = fs.mkdtempSync("/tmp/opencode/desktop-image-");
  const root = fs.mkdtempSync("/tmp/opencode/image-project-");
  t.after(() => { fs.rmSync(outside, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); });
  const source = path.join(outside, "imagen del escritorio.png");
  fs.writeFileSync(source, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2]));
  const first = copyImageToAssets(root, source);
  assert.equal(first.rel, "assets/imagen-del-escritorio.png");
  assert.deepEqual(fs.readFileSync(path.join(root, first.rel)), fs.readFileSync(source));
  const second = copyImageToAssets(root, source);
  assert.equal(second.rel, "assets/imagen-del-escritorio-2.png");
  assert.ok(fs.existsSync(source));
});
