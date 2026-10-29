import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { convert } from "../core/md2typst.mjs";

test("URLs do not start Typst comments in captions or text", () => {
  const generated = convert(
    "Texto con https://example.com/uno.\n\n" +
      "![Captura https://example.com/dos](assets/imagen.png){#fig:captura}",
    { resolveImage: (src) => src },
  ).typst;

  assert.match(generated, /\[https:\\\/\\\/example\.com\\\/uno\]/);
  assert.match(generated, /caption: \[Captura https:\\\/\\\/example\.com\\\/dos\]/);
});

test("generated text with a URL compiles with Typst", (t) => {
  if (spawnSync("typst", ["--version"]).status !== 0) return;
  const root = fs.mkdtempSync("/tmp/opencode/typst-url-");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const source = convert("Texto con https://example.com/uno.").typst;
  const input = path.join(root, "test.typ");
  const output = path.join(root, "test.pdf");
  fs.writeFileSync(
    input,
    ["#set page(width: 10cm, height: 5cm)", source, ""].join("\n"),
  );

  const result = spawnSync("typst", ["compile", "--root", root, input, output], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.statSync(output).size > 0);
});
