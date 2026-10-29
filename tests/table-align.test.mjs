import test from "node:test";
import assert from "node:assert/strict";
import { convert } from "../core/md2typst.mjs";
import {
  alignTableBlock,
  htmlTableAlign,
  normalizeTableAlign,
  setHtmlTableAlign,
} from "../core/table-align.mjs";

test("una tabla HTML con align=center se centra en Typst", () => {
  const markdown = '<table align="center" style="margin-left:auto;margin-right:auto">\n  <tr><th>Código</th><th>Apellidos y nombres</th></tr>\n  <tr><td>u202318309</td><td>Aguilar Untiveros, Rodrigo Fabrizio</td></tr>\n</table>';
  const { typst } = convert(`# Integrantes\n\n${markdown}`, { source: "cap.md" });
  assert.match(typst, /#align\(center\)\[\n#table\(/);
  assert.match(typst, /table\.header\(\[#text\(weight: "bold"\)\[Código\]\]/);
});

test("los márgenes automáticos también centran aunque falte align", () => {
  assert.equal(htmlTableAlign('<table style="margin-left: auto; margin-right: auto">'), "center");
  assert.equal(htmlTableAlign('<table style="margin-left:auto">'), "right");
  assert.equal(htmlTableAlign('<table style="margin-right:auto">'), "left");
  assert.equal(htmlTableAlign('<table align="right">'), "right");
});

test("la alineación GFM llega al PDF", () => {
  const meta = encodeURIComponent(JSON.stringify({ align: "center" }));
  const markdown = `<!-- mdpdf-table:${meta} -->\n\n| A | B |\n|:---|---:|\n| 1 | 2 |`;
  const { typst } = convert(markdown, { source: "cap.md" });
  assert.match(typst, /#align\(center\)\[\n#table\(/);
});

test("la directiva de tabla acepta align", () => {
  const markdown = ':::table{align="right"}\n| A | B |\n|---|---|\n| 1 | 2 |\n:::';
  const { typst } = convert(markdown, { source: "cap.md" });
  assert.match(typst, /#align\(right\)\[\n#table\(/);
});

test("alinear una tabla HTML conserva sus demás atributos y estilos", () => {
  const source = '<table class="datos" id="integrantes" style="width:80%;color:red" align="left"><tr><td>A</td></tr></table>';
  const centered = setHtmlTableAlign(source, "center");
  assert.match(centered, /class="datos"/);
  assert.match(centered, /id="integrantes"/);
  assert.match(centered, /style="width:80%;color:red;margin-left:auto;margin-right:auto"/);
  assert.match(centered, /align="center"/);
  assert.equal(htmlTableAlign(centered), "center");

  const left = setHtmlTableAlign(centered, "left");
  assert.doesNotMatch(left, /align="left"/);
  assert.match(left, /style="width:80%;color:red;margin-left:0;margin-right:auto"/);
});

test("los valores de alineación se normalizan", () => {
  assert.equal(normalizeTableAlign(" CENTER "), "center");
  assert.equal(normalizeTableAlign("justify"), null);
  assert.equal(alignTableBlock("#table()", "left"), "#table()");
  assert.equal(alignTableBlock("#table()", "center"), "#align(center)[\n#table()\n]");
});
