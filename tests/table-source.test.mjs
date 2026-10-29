import test from "node:test";
import assert from "node:assert/strict";
import { convert } from "../core/md2typst.mjs";
import { protectHtmlTableBlankLines } from "../core/table-source.mjs";

const BROKEN = `<table align="center" style="margin-left:auto;margin-right:auto">
  <tbody>



<tr><th>Código</th><th>Apellidos y nombres</th></tr><tr><td>u202318309</td><td>Aguilar Untiveros, Rodrigo Fabrizio</td></tr></tbody></table>`;

test("una tabla HTML partida por líneas en blanco sigue siendo tabla", () => {
  const protectedSource = protectHtmlTableBlankLines(BROKEN);
  assert.equal(protectedSource.split("\n").length, BROKEN.split("\n").length);
  assert.doesNotMatch(protectedSource, /\n[ \t]*\n/);

  const { typst } = convert(`# Integrantes\n\n${BROKEN}\n\nTexto.`, { source: "cap.md" });
  assert.match(typst, /line: 3, kind: "table"/);
  assert.match(typst, /#align\(center\)\[\n#table\(/);
  assert.match(typst, /\[u202318309\], \[Aguilar Untiveros, Rodrigo Fabrizio\]/);
  assert.doesNotMatch(typst, /CódigoApellidos/);
});

test("la reparación no altera bloques de código cercados", () => {
  const code = "```html\n<table>\n\n</table>\n```";
  assert.equal(protectHtmlTableBlankLines(code), code);
});

test("no toca líneas vacías fuera de una tabla", () => {
  const markdown = "Antes\n\n<table><tr><td>A</td></tr></table>\n\nDespués";
  assert.equal(protectHtmlTableBlankLines(markdown), markdown);
});
