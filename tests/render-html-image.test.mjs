import test from "node:test";
import assert from "node:assert/strict";
import { convert } from "../core/md2typst.mjs";

test("HTML images retain width and alignment in Typst", () => {
  const markdown = '<div align="center">\n<img src="assets/logo.png" alt="Logo" width="40%">\n</div>';
  const { typst } = convert(markdown, { resolveImage: (src) => src });
  assert.match(typst, /#align\(center\)\[#block\(breakable: false\)\[#fit-image\("\/assets\/logo\.png", alt: "Logo", width: 40%\)\]\]/);
});

test("HTML caption stays in the same indivisible PDF figure", () => {
  const { typst } = convert('<div align="center"><img src="assets/logo.png" width="50%" alt="UPC" id="fig:upc"><br><em class="image-caption">Nota del logo</em></div>');
  assert.match(typst, /#align\(center\)\[#figure\(fit-image\(/);
  assert.match(typst, /caption: \[Nota del logo\]/);
  assert.match(typst, /<fig:upc>/);
});

test("a paragraph containing an image does not recurse forever", () => {
  const markdown = '<p align="center" style="text-align:center"><img src="assets/logo.png" width="150" alt="Logo UPC"></p>';
  const { typst } = convert(markdown, { resolveImage: (src) => src });
  assert.match(typst, /#align\(center\)\[.*#fit-image\("\/assets\/logo\.png"/s);
});

test("a cover div with image, centered paragraph and heading emits all three", () => {
  const markdown = '<div align="center">\n<img src="assets/logo.png" width="150" alt="Logo UPC">\n<p align="center"><strong>Universidad Peruana de Ciencias Aplicadas</strong></p>\n<h2 align="center">Informe del Trabajo Final</h2>\n</div>';
  const { typst } = convert(markdown, { resolveImage: (src) => src });
  assert.match(typst, /#fit-image\("\/assets\/logo\.png"/);
  assert.match(typst, /#align\(center\)\[\*Universidad Peruana de Ciencias Aplicadas\*\]/);
  assert.match(typst, /#align\(center\)\[#heading\(level: 2\)\[Informe del Trabajo Final\]\]/);
});

test("an HTML pixel width is kept as a PDF length", () => {
  const { typst } = convert('<img src="assets/logo.png" width="150" alt="UPC">');
  assert.match(typst, /width: 112\.5pt/);
});

test("Markdown figure uses the bounded image helper and keeps its caption", () => {
  const { typst } = convert('![Nota de la imagen](assets/figura.png){#fig:prueba width=85%}');
  assert.match(typst, /#figure\(\s*fit-image\(/);
  assert.match(typst, /caption: \[Nota de la imagen\]/);
});

test("extended table column alignment and style reach PDF source", () => {
  const markdown = ':::table{widths="40 60" style="horizontal"}\n| Uno | Dos |\n|:---|:---:|\n| A | Integrante |\n:::';
  const { typst } = convert(markdown);
  assert.match(typst, /columns: \(40%, 60%\)/);
  assert.match(typst, /stroke: \(x: none, y: 0\.5pt \+ luma\(200\)\)/);
  assert.match(typst, /align: \(left, center\)/);
});

test("GFM table with invisible metadata retains widths and reference in PDF", () => {
  const meta = encodeURIComponent(JSON.stringify({ widths: "40 60", id: "tbl:contribuyentes", caption: "Contribuyentes" }));
  const { typst } = convert(`<!-- mdpdf-table:${meta} -->\n\n| Integrante | Aporte |\n|:---|:---:|\n| Ana | Edición |`);
  assert.match(typst, /columns: \(40%, 60%\)/);
  assert.match(typst, /align: \(left, center\)/);
  assert.match(typst, /<tbl:contribuyentes>/);
});
