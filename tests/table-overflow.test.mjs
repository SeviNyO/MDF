import test from "node:test";
import assert from "node:assert/strict";
import { convert } from "../core/md2typst.mjs";
import { parsePdfWords } from "../core/pdf-words.mjs";

const ZWSP = "\u200b";

test("inline code inside a table never overflows its column", () => {
  const markdown = [
    ':::table{widths="25 25 25 25"}',
    "| A | B | C | D |",
    "| --- | --- | --- | --- |",
    "| `document.querySelector` | `getElementById` | `XMLHttpRequest` | Texto normal |",
  ].join("\n");
  const { typst } = convert(markdown);

  // El código se emite como texto monoespaciado con puntos de corte, no como
  // `#raw`, que Typst no puede partir dentro de una celda.
  assert.match(typst, /#text\(font: "JetBrains Mono", size: 0\.9em\)\[docu/);
  assert.doesNotMatch(typst, /#raw\("document\.querySelector"\)/);
  assert.ok(typst.includes(`docu${ZWSP}`));
  assert.ok(typst.includes(`getE${ZWSP}`));
});

test("code and CamelCase in raw HTML tables also get break points", () => {
  const html = "<table><tr><th>A</th><th>B</th></tr><tr><td><code>document.querySelector</code></td><td>getElementById</td></tr></table>";
  const { typst } = convert(html);
  assert.match(typst, /#text\(font: "JetBrains Mono", size: 0\.9em\)\[/);
  assert.ok(typst.includes(ZWSP));
});

test("short ordinary words keep natural hyphenation and are not fragmented", () => {
  const markdown = [
    "| Palabra | Otra |",
    "| --- | --- |",
    "| Responsabilidad | Extraordinariamente |",
  ].join("\n");
  const { typst } = convert(markdown);
  assert.ok(!typst.includes(`Respon${ZWSP}`));
  assert.ok(!typst.includes(`Extraordi${ZWSP}`));
});

test("zero-width break points do not break PDF phrase matching", () => {
  const xml = `<page><word xMin="0" yMin="0" xMax="1" yMax="1">Supercali${ZWSP}fragilistico</word></page>`;
  const [word] = parsePdfWords(xml);
  assert.equal(word.text, "Supercalifragilistico");
});
