import test from "node:test";
import assert from "node:assert/strict";
import { parsePdfWords, findPdfPhrase } from "../core/pdf-words.mjs";

test("coordinates remain on their own PDF page", () => {
  const words = parsePdfWords('<page width="595" height="842"><word xMin="10" yMin="20" xMax="40" yMax="32">Antecedentes</word></page><page width="595" height="842"><word xMin="12" yMin="5" xMax="42" yMax="16">Integrante</word></page>');
  assert.deepEqual(findPdfPhrase(words, "Integrante", { startPage: 2, startY: 0, endPage: 2, endY: 20 }).map((w) => w.page), [2]);
  assert.deepEqual(findPdfPhrase(words, "Antecedentes", { startPage: 2, startY: 0, endPage: 2, endY: 20 }), []);
});

test("highlight bounds select the exact word and not the following paragraph", () => {
  const words = parsePdfWords('<page><word xMin="10" yMin="20" xMax="30" yMax="31">Integrante</word><word xMin="10" yMin="51" xMax="30" yMax="62">Integrante</word></page>');
  const match = findPdfPhrase(words, "Integrante", { startPage: 1, startY: 18, endPage: 1, endY: 40 });
  assert.equal(match.length, 1);
  assert.equal(match[0].y1, 20);
});
