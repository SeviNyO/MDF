import test from "node:test";
import assert from "node:assert/strict";
import { formatInlineSelection } from "../core/inline-format.mjs";

test("selected text receives native Markdown formatting", () => {
  const source = "Una palabra útil";
  const from = 4;
  const to = 11;
  assert.equal(formatInlineSelection(source, from, to, "bold").insert, "**palabra**");
  assert.equal(formatInlineSelection(source, from, to, "italic").insert, "*palabra*");
  assert.equal(formatInlineSelection(source, from, to, "strike").insert, "~~palabra~~");
  assert.equal(formatInlineSelection(source, from, to, "underline").insert, "<u>palabra</u>");
  assert.equal(formatInlineSelection(source, from, to, "code").insert, "`palabra`");
  assert.equal(formatInlineSelection(source, from, to, "math").insert, "$palabra$");
  assert.equal(formatInlineSelection(source, from, to, "link", "https://example.com").insert, "[palabra](https://example.com)");
  assert.equal(formatInlineSelection(source, from, to, "link", "javascript:alert(1)"), null);
  assert.equal(formatInlineSelection(source, from, from, "bold"), null);
});

test("clearing inline formatting and code fences does not alter neighboring text", () => {
  const source = "Antes **[palabra](https://example.com)** después";
  const from = 6;
  const to = source.indexOf(" después");
  const change = formatInlineSelection(source, from, to, "clear");
  assert.equal(source.slice(0, change.from) + change.insert + source.slice(change.to), "Antes palabra después");
  assert.equal(formatInlineSelection("a`b", 0, 3, "code").insert, "``a`b``");
});
