import test from "node:test";
import assert from "node:assert/strict";
import { imageMarkupHtml } from "../core/image-markup.mjs";

test("el menú / inserta la imagen como HTML con ancho 75%", () => {
  assert.equal(
    imageMarkupHtml("assets/insight_av1_1.jpg", "Colaboración en GitHub: evidencia 1"),
    '<img alt="Colaboración en GitHub: evidencia 1" src="assets/insight_av1_1.jpg" width="75%">',
  );
});

test("el marcado de imagen escapa comillas y ampersands", () => {
  assert.equal(
    imageMarkupHtml("assets/a&b.jpg", 'Evidencia "1"'),
    '<img alt="Evidencia &quot;1&quot;" src="assets/a&amp;b.jpg" width="75%">',
  );
});
