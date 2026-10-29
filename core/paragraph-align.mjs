// Transformaciones acotadas al bloque bajo el puntero; offsets UTF-16 como CodeMirror.
const BLOCK_START = /^(?:\s*(?:#{1,6}\s|:::|```|~~~|>|[-*+]\s|\d+[.)]\s|\|)|\s*<(?:table|pre|ul|ol|li|blockquote|script|style)\b)/i;

function inlineHtml(value) {
  const escaped = value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const code = [];
  const protectedText = escaped.replace(/`([^`]+)`/g, (_, content) => {
    const index = code.push(`<code>${content}</code>`) - 1;
    return `\uE000${index}\uE001`;
  });
  return protectedText
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\uE000(\d+)\uE001/g, (_, index) => code[Number(index)]);
}

function centeredOpening(tag) {
  let updated = tag.replace(/\s+align\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, "");
  updated = updated.replace(/\s+style\s*=\s*(?:"([^"]*)"|'([^']*)')/i, (whole, double, single) => {
    const style = (double ?? single).replace(/(?:^|;)\s*text-align\s*:\s*[^;]*/gi, "").replace(/^\s*;+|;+\s*$/g, "").trim();
    return style ? ` style="${style}"` : "";
  });
  return updated.replace(/>$/, ' align="center">');
}

export function centerParagraphAt(source, lineNumber) {
  const lines = source.split("\n");
  const at = lineNumber - 1;
  if (at < 0 || at >= lines.length || !lines[at].trim()) return null;
  const offsets = [];
  let cursor = 0;
  for (const line of lines) { offsets.push(cursor); cursor += line.length + 1; }

  // Edita la etiqueta existente sin duplicar wrappers ni perder contenido HTML.
  for (let first = at; first >= 0 && at - first < 80 && lines[first].trim(); first -= 1) {
    const opening = /<(p|div|h[1-6])\b[^>]*>/i.exec(lines[first]);
    if (!opening) continue;
    const close = new RegExp(`<\\/${opening[1]}>`, "i");
    let last = first;
    while (last < lines.length && last - first < 80 && !close.test(lines[last])) last += 1;
    if (last >= lines.length || at > last) continue;
    const from = offsets[first] + opening.index;
    return { from, to: from + opening[0].length, insert: centeredOpening(opening[0]) };
  }

  const heading = /^\s*(#{1,6})\s+(.+?)\s*$/.exec(lines[at]);
  if (heading) {
    const content = heading[2].replace(/\s+\{#[^}]+\}\s*$/, "");
    const identifier = /\{#(sec:[\w.-]+)\}/.exec(heading[2])?.[1];
    const level = heading[1].length;
    return { from: offsets[at], to: offsets[at] + lines[at].length,
      insert: `<h${level} align="center"${identifier ? ` id="${identifier}"` : ""}>${inlineHtml(content)}</h${level}>` };
  }

  // No reescribir tablas, código, listas ni imágenes como HTML plano.
  let fence = false;
  for (let index = 0; index <= at; index += 1) {
    if (/^\s*(?:```|~~~)/.test(lines[index])) fence = !fence;
  }
  if (fence || BLOCK_START.test(lines[at]) || /!\[|<[^>]+>/.test(lines[at])) return null;
  let first = at;
  let last = at;
  while (first > 0 && lines[first - 1].trim() && !BLOCK_START.test(lines[first - 1]) && !/!\[|<[^>]+>/.test(lines[first - 1])) first -= 1;
  while (last + 1 < lines.length && lines[last + 1].trim() && !BLOCK_START.test(lines[last + 1]) && !/!\[|<[^>]+>/.test(lines[last + 1])) last += 1;
  const text = lines.slice(first, last + 1).map((line) => inlineHtml(line.trim())).join("<br>\n");
  return { from: offsets[first], to: offsets[last] + lines[last].length, insert: `<p align="center">${text}</p>` };
}
