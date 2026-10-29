import test from "node:test";
import assert from "node:assert/strict";
import { centerParagraphAt } from "../core/paragraph-align.mjs";
import { convert } from "../core/md2typst.mjs";

function apply(source, line) {
  const change = centerParagraphAt(source, line);
  assert.ok(change);
  return source.slice(0, change.from) + change.insert + source.slice(change.to);
}

test("right-clicked paragraph, not the current editor cursor, is centered", () => {
  const source = "Primer párrafo.\n\nSegundo **importante** párrafo.";
  assert.equal(apply(source, 3), 'Primer párrafo.\n\n<p align="center">Segundo <strong>importante</strong> párrafo.</p>');
});

test("existing HTML alignment changes without nesting tags or losing strong text", () => {
  const result = apply('<p align="left" style="text-align:left; color:red"><strong>Universidad</strong></p>', 1);
  assert.match(result, /<p style="color:red" align="center"><strong>Universidad<\/strong><\/p>/);
  assert.match(convert(result).typst, /#align\(center\)\[\*Universidad\*\]/);
});

test("code and table rows cannot be rewritten as paragraphs", () => {
  assert.equal(centerParagraphAt("```js\nconst a = 1;\n```", 2), null);
  assert.equal(centerParagraphAt("| A | B |\n|---|---|\n| 1 | 2 |", 3), null);
});

test("inline code stays literal and a heading remains a heading", () => {
  assert.equal(apply("Escribe `**texto**` aquí.", 1), '<p align="center">Escribe <code>**texto**</code> aquí.</p>');
  const centered = apply("## Informe del Trabajo Final", 1);
  assert.equal(centered, '<h2 align="center">Informe del Trabajo Final</h2>');
  assert.match(convert(centered).typst, /#align\(center\)\[#heading\(level: 2\)/);
});

test("HTML headings and divs respect align and text-align in PDF", () => {
  const document = '<p align="center" style="text-align:center"><strong>Universidad Peruana de Ciencias Aplicadas</strong></p>\n\n<h2 align="center" style="text-align:center">Informe del Trabajo Final</h2>';
  const { typst } = convert(document);
  assert.match(typst, /#align\(center\)\[\*Universidad Peruana de Ciencias Aplicadas\*\]/);
  assert.match(typst, /#align\(center\)\[#heading\(level: 2\)\[Informe del Trabajo Final\]\]/);
});
