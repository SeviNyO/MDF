// Reparación de tablas HTML que quedaron partidas por líneas en blanco.
// CommonMark termina un bloque HTML en la primera línea vacía. Algunas
// versiones del editor dejaban esos huecos entre <tr>; aquí los neutralizamos
// sólo para el análisis, conservando el número de líneas del documento.

const BLANK_MARK = "<!-- mdpdf-table-blank -->";

function isBlank(line) {
  return !String(line).trim();
}

/**
 * Sustituye las líneas vacías interiores de cada <table> por un comentario
 * HTML. No se tocan los bloques de código cercados ni el texto exterior.
 */
export function protectHtmlTableBlankLines(markdown) {
  const lines = String(markdown ?? "").split("\n");
  let fence = null;
  let inTable = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);

    if (!inTable && fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;

    if (!inTable) {
      if (/^\s*(?:<[^>]+>\s*)*<table\b/i.test(line)) {
        inTable = !/<\/table>/i.test(line);
      }
      continue;
    }

    if (isBlank(line)) {
      lines[i] = BLANK_MARK;
      continue;
    }
    if (/<\/table>/i.test(line)) inTable = false;
  }

  return lines.join("\n");
}
