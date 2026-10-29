// Marcado HTML de imagen que usa el menú `/`. Se mantiene independiente de
// la UI para que el formato sea estable y se pueda probar sin Electron.

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function imageMarkupHtml(rel, alt = "", width = "75%") {
  return `<img alt="${escapeAttr(alt)}" src="${escapeAttr(rel)}" width="${escapeAttr(width)}">`;
}
