// Alineación horizontal de tablas HTML y de tablas GFM con metadatos.
// El PDF y la lectura deben interpretar igual `align` y los márgenes auto.

const VALID = new Set(["left", "center", "right"]);

export function normalizeTableAlign(value) {
  const align = String(value ?? "").trim().toLowerCase();
  return VALID.has(align) ? align : null;
}

function htmlAttr(tag, name) {
  const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match ? (match[2] ?? match[3] ?? match[4] ?? "") : "";
}

/**
 * Alineación de una tabla HTML. En la práctica `align="center"` suele venir
 * acompañado de `margin-left:auto;margin-right:auto`; ambos casos cuentan.
 */
export function htmlTableAlign(openingTag) {
  const tag = String(openingTag ?? "");
  const style = htmlAttr(tag, "style");
  const leftAuto = /(?:^|;)\s*margin-left\s*:\s*auto\s*(?:;|$)/i.test(style);
  const rightAuto = /(?:^|;)\s*margin-right\s*:\s*auto\s*(?:;|$)/i.test(style);

  if (leftAuto && rightAuto) return "center";
  const attr = normalizeTableAlign(htmlAttr(tag, "align"));
  if (attr) return attr;
  if (leftAuto) return "right";
  if (rightAuto) return "left";
  const textAlign = /(?:^|;)\s*text-align\s*:\s*(left|center|right)\s*(?:;|$)/i.exec(style)?.[1];
  return normalizeTableAlign(textAlign);
}

function setHtmlAttr(attrs, name, value) {
  const pattern = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  if (value == null || value === "") return attrs.replace(pattern, "");
  if (!pattern.test(attrs)) return `${attrs} ${name}="${value}"`;
  return attrs.replace(pattern, ` ${name}="${String(value).replace(/"/g, "&quot;")}"`);
}

/**
 * Devuelve el HTML de la tabla con su alineación actualizada, preservando
 * el resto de atributos, estilos y contenido de las celdas.
 */
export function setHtmlTableAlign(html, align) {
  const value = normalizeTableAlign(align) ?? "left";
  const match = /^(\s*<table\b)([^>]*)(>)/i.exec(String(html ?? ""));
  if (!match) return String(html ?? "");

  let attrs = match[2];
  const style = htmlAttr(attrs, "style");
  const declarations = style
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^margin-(?:left|right)\s*:/i.test(part));

  if (value === "center") declarations.push("margin-left:auto", "margin-right:auto");
  else if (value === "right") declarations.push("margin-left:auto", "margin-right:0");
  else if (value === "left") declarations.push("margin-left:0", "margin-right:auto");

  const nextStyle = declarations.join(";");
  attrs = setHtmlAttr(attrs, "style", nextStyle || null);
  attrs = setHtmlAttr(attrs, "align", value === "left" ? null : value);

  return String(html).replace(match[0], `${match[1]}${attrs}${match[3]}`);
}

/** Envuelve el bloque Typst sólo cuando hace falta desplazarlo. */
export function alignTableBlock(body, align) {
  const value = normalizeTableAlign(align);
  return value && value !== "left" ? `#align(${value})[\n${body}\n]` : body;
}
