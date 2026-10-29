// ============================================================================
//  Núcleo: Markdown (GFM + matemáticas + directivas) -> Typst
//  Sin dependencias de la UI. La app reutilizará exactamente este módulo.
// ============================================================================

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkDirective from "remark-directive";
import remarkFrontmatter from "remark-frontmatter";
import { visit } from "unist-util-visit";
import { toString } from "mdast-util-to-string";
import YAML from "yaml";
import { attachTableMetadata } from "./table-meta.mjs";
import { alignTableBlock, htmlTableAlign } from "./table-align.mjs";
import { protectHtmlTableBlankLines } from "./table-source.mjs";

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkDirective);

// --- utilidades -------------------------------------------------------------

const TYPST_SPECIAL = /([\\#*_$<>@\[\]~`\/])/g;

/** Escapa texto plano para el marcado de Typst (sin tocar referencias). */
function escapeText(text) {
  return text
    .replace(/\uE000/g, ":")
    .replace(TYPST_SPECIAL, "\\$1")
    .replace(/(^|\n)([ \t]*)([\/\-+=])/g, "$1$2\\$3");
}

/**
 * remark-directive interpreta `:nombre` como directiva de texto y parte las
 * referencias. Antes de parsear cambiamos el `:` por NUL; aquí se restaura.
 */
function emitText(text) {
  const refRe = /@(fig|tbl|sec|eq)\uE000([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)/g;
  let out = "";
  let last = 0;
  for (const m of text.matchAll(refRe)) {
    out += escapeText(text.slice(last, m.index));
    out += `@${m[1]}:${m[2]}`; // Typst ya entiende @fig:x
    last = m.index + m[0].length;
  }
  out += escapeText(text.slice(last));
  return out;
}

/** Protege referencias y bloques de atributos antes de remark-directive. */
function preprocess(markdown) {
  return protectHtmlTableBlankLines(markdown)
    .replace(/@(fig|tbl|sec|eq):([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)/g, (_, kind, id) => `@${kind}\uE000${id}`)
    .replace(/(\{(?:[#.][^{}\n]*)\})\s*$/gm, (block) => block.replace(/:/g, "\uE000"));
}

function escapeString(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function slugify(value) {
  return (
    String(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "seccion"
  );
}

/** Parsea `{#fig:id width=60% placement=top}`. */
function parseAttrs(raw) {
  const attrs = {};
  const tokens = (raw.replace(/\uE000/g, ":").match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []);
  for (const token of tokens) {
    if (token.startsWith("#")) {
      attrs.id = token.slice(1);
    } else if (token.startsWith(".")) {
      (attrs.class ??= []).push(token.slice(1));
    } else {
      const eq = token.indexOf("=");
      if (eq > 0) {
        attrs[token.slice(0, eq)] = token
          .slice(eq + 1)
          .replace(/^["']|["']$/g, "");
      } else {
        attrs[token] = true;
      }
    }
  }
  return attrs;
}

function takeTrailingAttrs(node, ctx) {
  const last = node.children?.at(-1);
  if (last?.type !== "text") return {};
  const m = last.value.match(/^\s*\{([^{}]*)\}\s*$/);
  if (!m) return {};
  last.value = last.value.slice(0, m.index);
  if (!last.value) node.children.pop();
  return parseAttrs(m[1]);
}

function assetPath(url) {
  if (/^(?:[a-z]+:|\/)/i.test(url)) return url;
  return `/${url}`;
}


// --- matemáticas: subconjunto de LaTeX -> Typst ------------------------------

const MATH_SYMBOLS = {
  in: "in", notin: "in.not", le: "<=", leq: "<=", ge: ">=", geq: ">=",
  ne: "!=", neq: "!=", approx: "approx", sim: "tilde.op", equiv: "equiv",
  times: "times", cdot: "dot", div: "div", pm: "plus.minus", mp: "minus.plus",
  infty: "infinity", partial: "partial", nabla: "nabla", forall: "forall",
  exists: "exists", to: "arrow.r", rightarrow: "arrow.r", leftarrow: "arrow.l",
  Rightarrow: "arrow.r.double", Leftarrow: "arrow.l.double",
  sum: "sum", prod: "product", int: "integral", oint: "integral.cont",
  lim: "lim", log: "log", ln: "ln", sin: "sin", cos: "cos", tan: "tan",
  exp: "exp", max: "max", min: "min", det: "det", mod: "mod",
  cdots: "dots.c", ldots: "dots", dots: "dots",
  alpha: "alpha", beta: "beta", gamma: "gamma", delta: "delta",
  epsilon: "epsilon", varepsilon: "epsilon", zeta: "zeta", eta: "eta",
  theta: "theta", iota: "iota", kappa: "kappa", lambda: "lambda", mu: "mu",
  nu: "nu", xi: "xi", pi: "pi", rho: "rho", sigma: "sigma", tau: "tau",
  upsilon: "upsilon", phi: "phi", varphi: "phi", chi: "chi", psi: "psi",
  omega: "omega", Gamma: "Gamma", Delta: "Delta", Theta: "Theta",
  Lambda: "Lambda", Xi: "Xi", Pi: "Pi", Sigma: "Sigma", Upsilon: "Upsilon",
  Phi: "Phi", Psi: "Psi", Omega: "Omega",
  quad: "wide", qquad: "wide wide",
};

/** Traduce lo habitual de LaTeX matemático al marcado de Typst. */
export function latexToTypstMath(input) {
  let s = String(input);
  // Diferenciales: dx, dy, dt → dif x, dif y, dif t (Typst no acepta "dx").
  s = s.replace(/\\mathrm\{d\}/g, "dif ");
  s = s.replace(/(?<![\\A-Za-z])d([A-Za-z])(?![A-Za-z])/g, "dif $1");
  for (let i = 0; i < 4; i += 1) {
    s = s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "frac($1, $2)");
    s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, "sqrt($1)");
  }
  s = s.replace(/\\text\s*\{([^{}]*)\}/g, (_, t) => `"${t.replace(/"/g, '\\"')}"`);
  s = s.replace(/\\mathrm\s*\{([^{}]*)\}/g, "$1");
  s = s.replace(/\\left|\\right/g, "");
  s = s.replace(/_\{([^{}]*)\}/g, "_($1)").replace(/\^\{([^{}]*)\}/g, "^($1)");
  s = s.replace(/\\([A-Za-z]+)/g, (m, name) => MATH_SYMBOLS[name] ?? name);
  s = s.replace(/\\,|\\;/g, " ").replace(/\\%/g, "%").replace(/\\_/g, "_");
  s = s.replace(/\\\{/g, "\\{").replace(/\\\}/g, "\\}");
  return s;
}

function lengthToTypst(value) {
  if (!value || value === true) return null;
  if (value === "auto") return null;
  if (value === "full") return "100%";
  if (/^\d+(\.\d+)?%$/.test(value)) return value;
  if (/^\d+(\.\d+)?(mm|cm|pt|em|in)$/.test(value)) return value;
  if (/^\d+(\.\d+)?$/.test(value)) return `${value}%`;
  return null;
}

function widthToTypst(value) {  if (!value || value === true) return null;
  if (value === "full") return "100%";
  if (/^\d+(\.\d+)?%$/.test(value)) return value;
  if (/^\d+(\.\d+)?(mm|cm|pt|em|in)$/.test(value)) return value;
  if (/^\d+(\.\d+)?$/.test(value)) return `${value}%`;
  return null;
}

function formatHeights(raw, count) {
  if (!raw || typeof raw !== "string") return null;
  const tokens = raw
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      if (t === "auto") return "auto";
      if (/^\d+(\.\d+)?(mm|cm|pt|em|in)$/.test(t)) return t;
      if (/^\d+(\.\d+)?$/.test(t)) return `${t}mm`;
      return "auto";
    });
  if (!tokens.length) return null;
  const filled = Array.from({ length: count }, (_, i) => tokens[i] ?? "auto");
  return `(${filled.join(", ")})`;
}

function formatColumns(widths, count) {
  if (!widths) return `${count}`;
  const parts = String(widths)
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((w) => (w === "auto" ? "auto" : widthToTypst(w)))
    .filter(Boolean);
  return parts.length === count ? `(${parts.join(", ")})` : `${count}`;
}

function uniqueId(candidate, ctx) {
  let id = candidate;
  let n = 2;
  while (ctx.ids.has(id)) id = `${candidate}-${n++}`;
  ctx.ids.add(id);
  return id;
}

// --- emisión ----------------------------------------------------------------

function emitInline(nodes, ctx) {
  return nodes.map((n) => emitInlineNode(n, ctx)).join("");
}

function emitInlineNode(node, ctx) {
  switch (node.type) {
    case "text":
      return emitText(node.value);

    case "strong":
      return `#strong[${emitInline(node.children, ctx)}]`;

    case "emphasis":
      return `#emph[${emitInline(node.children, ctx)}]`;

    case "delete":
      return `#strike[${emitInline(node.children, ctx)}]`;

    case "inlineCode":
      return `#raw("${escapeString(node.value)}")`;

    case "link":
      return `#link("${escapeString(node.url)}")[${emitInline(node.children, ctx)}]`;

    case "image": {
      const src = ctx.resolveImage ? ctx.resolveImage(node.url) : node.url;
      if (!src || /^(https?:)?\/\//i.test(String(src))) return "";
      const alt = node.alt ?? "";
      return `#fit-image("${escapeString(assetPath(src))}", alt: "${escapeString(alt)}", width: 100%)`;
    }

    case "break":
      return " #linebreak() ";

    case "footnoteReference": {
      const def = ctx.footnotes.get(node.identifier);
      const body = def ? emitBlocks(def.children, ctx) : "";
      return `#footnote[${body}]`;
    }

    case "inlineMath":
      return `$${latexToTypstMath(node.value)}$`;

    case "math":
      return `$ ${latexToTypstMath(node.value)} $`;

    case "html": {
      const value = node.value.trim();
      if (/^<!--\s*pdf-pagebreak\s*-->$/i.test(value)) return "#pagebreak()";
      if (/^<br\s*\/?>$/i.test(value)) return " #linebreak() ";
      if (/^<img\b[^>]*>$/i.test(value)) return emitHtmlImage(value, ctx);
      if (/^<\/?(b|strong)>$/i.test(value)) return "*";
      if (/^<\/?(i|em)>$/i.test(value)) return "_";
      if (/^&[a-z#0-9]+;$/i.test(value)) return escapeText(decodeHtml(value));
      return "";
    }

    case "textDirective": {
      if (/^[a-z]{2}(-[a-z]{2,4})?$/i.test(node.name)) {
        return `#text(lang: "${node.name.toLowerCase()}")[${emitInline(node.children, ctx)}]`;
      }
      return `:${node.name}${emitInline(node.children, ctx)}`;
    }

    case "linkReference":
      return emitInline(node.children, ctx);

    default:
      return "";
  }
}

function emitBlocks(nodes, ctx) {
  return nodes
    .map((n) => {
      const body = emitBlock(n, ctx);
      if (!body || !body.trim()) return "";
      const line = n.position?.start?.line;
      if (!line) return body;

      const fields = [`src: "${escapeString(ctx.source)}"`, `line: ${line}`];
      if (n.type === "heading") fields.push(`kind: "heading"`, `level: ${n.depth}`);
      if (n.type === "table" || (n.type === "containerDirective" && n.name === "table")) {
        fields.push(`kind: "table"`);
      }
      if (n.type === "containerDirective" && n.name === "figure") fields.push(`kind: "figure"`);
      if (n.type === "paragraph") {
        const image = (n.children ?? []).find((child) => child.type === "image");
        if (image) {
          fields.push(`kind: "figure"`);
          fields.push(`img: "${escapeString(image.url)}"`);
        }
        const htmlImage = (n.children ?? []).find((child) => child.type === "html" && /<img\b/i.test(child.value));
        if (!image && htmlImage) {
          fields.push(`kind: "figure"`);
          const src = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i.exec(htmlImage.value)?.[1];
          if (src) fields.push(`img: "${escapeString(src)}"`);
        }
      }
      if (n.type === "html" && /<table\b/i.test(n.value)) fields.push(`kind: "table"`);
      else if (n.type === "html" && /<img\b/i.test(n.value)) {
        fields.push(`kind: "figure"`);
        const img = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i.exec(n.value)?.[1];
        if (img) fields.push(`img: "${escapeString(img)}"`);
      }

      const meta = `#metadata((${fields.join(", ")}))`;
      // En títulos, el metadato va después del título (así queda en la página
      // correcta); la posición real del título se obtiene con `query(heading)`.
      return n.type === "heading" ? `${body}\n${meta}` : `${meta}\n${body}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function emitFigure(node, attrs, ctx) {
  const id = attrs.id ?? null;
  const width = widthToTypst(attrs.width) ?? "100%";
  const placement = ["auto", "top", "bottom"].includes(attrs.placement)
    ? `placement: ${attrs.placement},`
    : "";
  const caption = node.alt ?? attrs.caption ?? "";
  const src = ctx.resolveImage ? ctx.resolveImage(node.url) : node.url;
  if (!src || /^(https?:)?\/\//i.test(String(src))) return "";

  const height = lengthToTypst(attrs.height);
  const fit = ["contain", "cover", "stretch"].includes(attrs.fit) ? attrs.fit : null;
  const imageArgs = [`"${escapeString(assetPath(src))}"`];
  if (width) imageArgs.push(`width: ${width}`);
  if (height) imageArgs.push(`height: ${height}`);
  if (fit) imageArgs.push(`fit: "${fit}"`);
  const image = `fit-image(${imageArgs.join(", ")})`;
  const fig = [
    "#figure(",
    `  ${image},`,
    `  caption: [${escapeText(caption)}],`,
    placement ? `  ${placement}` : null,
    ")",
  ]
    .filter(Boolean)
    .join("\n");

  return id ? `${fig} <${id}>` : fig;
}

function parseMergeSpec(raw) {
  const merges = new Map();
  if (!raw || typeof raw !== "string") return merges;
  for (const token of raw.split(";").map((t) => t.trim()).filter(Boolean)) {
    const [origin, size] = token.split(":");
    const at = origin?.match(/^r(\d+)c(\d+)$/i);
    const dim = size?.match(/^(\d+)x(\d+)$/i);
    if (!at || !dim) continue;
    merges.set(`${at[1]}-${at[2]}`, {
      rowspan: Math.max(1, Number(dim[1])),
      colspan: Math.max(1, Number(dim[2])),
    });
  }
  return merges;
}

function parseCellSpec(raw) {
  const cells = new Map();
  if (!raw || typeof raw !== "string") return cells;
  for (const token of raw.split(";").map((t) => t.trim()).filter(Boolean)) {
    const [origin, value] = token.split(":");
    const at = origin?.match(/^r(\d+)c(\d+)$/i);
    if (!at || !["left", "center", "right"].includes(value)) continue;
    cells.set(`${at[1]}-${at[2]}`, value);
  }
  return cells;
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      try { return String.fromCodePoint(parseInt(hex, 16)); } catch { return ""; }
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      try { return String.fromCodePoint(Number(dec)); } catch { return ""; }
    });
}

function stripHtml(value) {
  return decodeHtml(
    String(value ?? "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  );
}

function escapeCell(text) {
  // Typst no corta identificadores largos por defecto; puntos de corte
  // invisibles mantienen el texto dentro de su columna, también en el PDF.
  return escapeText(breakLongCellWords(text)).replace(/\n/g, " #linebreak() ");
}

function breakLongCellWords(text) {
  return String(text).replace(/[^\s]{22,}/gu, (word) => word.replace(/(.{18})(?=.)/gu, "$1\u200b"));
}

function htmlAttr(tag, name) {
  const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match ? (match[2] ?? match[3] ?? match[4] ?? "") : "";
}

function htmlAlign(html) {
  const opening = /^\s*<(?:p|div|h[1-6])\b[^>]*>/i.exec(html)?.[0];
  if (!opening) return null;
  const style = htmlAttr(opening, "style");
  const fromStyle = /(?:^|;)\s*text-align\s*:\s*(left|center|right)\s*(?:;|$)/i.exec(style)?.[1];
  const align = fromStyle ?? htmlAttr(opening, "align");
  return /^(left|center|right)$/i.test(align) ? align.toLowerCase() : null;
}

function emitHtmlText(html, inCell = false) {
  let result = "";
  let end = 0;
  const escape = inCell ? escapeCell : escapeText;
  const pattern = /<(strong|b|em|i|code|a)\b([^>]*)>([\s\S]*?)<\/\1>|<br\s*\/?>/gi;
  for (const match of html.matchAll(pattern)) {
    result += escape(stripHtml(html.slice(end, match.index)));
    if (match[1]) {
      const text = escape(stripHtml(match[3]));
      if (/^(strong|b)$/i.test(match[1])) result += `*${text}*`;
      else if (/^(em|i)$/i.test(match[1])) result += `_${text}_`;
      else if (match[1].toLowerCase() === "code") result += `#raw("${escapeString(stripHtml(match[3]))}")`;
      else {
        const href = htmlAttr(`<a ${match[2]}>`, "href");
        result += /^(https?:\/\/|mailto:|#)/i.test(href) ? `#link("${escapeString(href)}")[${text}]` : text;
      }
    } else result += " #linebreak() ";
    end = match.index + match[0].length;
  }
  return (result + escape(stripHtml(html.slice(end)))).trim();
}

function emitHtmlImage(tag, ctx, inCell = false) {
  const src = htmlAttr(tag, "src");
  if (!src) return "";
  const alt = htmlAttr(tag, "alt");
  const resolved = ctx.resolveImage ? ctx.resolveImage(src) : src;
  if (!resolved || /^(https?:)?\/\//i.test(String(resolved))) return "";
  const rawWidth = htmlAttr(tag, "width");
  const width = /^\d+(?:\.\d+)?(?:px)?$/i.test(rawWidth)
    ? `${Number((parseFloat(rawWidth) * 0.75).toFixed(2))}pt`
    : /^(?:\d+(?:\.\d+)?%|\d+(?:\.\d+)?(?:mm|cm|pt))$/i.test(rawWidth) ? rawWidth : "auto";
  const rawHeight = htmlAttr(tag, "height");
  const height = /^\d+(?:\.\d+)?(?:px)?$/i.test(rawHeight)
    ? `${Number((parseFloat(rawHeight) * 0.75).toFixed(2))}pt`
    : /^(?:\d+(?:\.\d+)?(?:mm|cm|pt|%))$/i.test(rawHeight) ? rawHeight : null;
  if (inCell) {
    // El ancho relativo se calcula dentro de una caja del ancho de la celda;
    // tamaños en px mayores que la celda se limitan al 100% disponible.
    const cellWidth = /^\d+(?:\.\d+)?%$/.test(width) ? width : "100%";
    return `#box(width: 100%)[#fit-image("${escapeString(assetPath(resolved))}", alt: "${escapeString(alt)}", width: ${cellWidth}, fit: "contain")]`;
  }
  return `#fit-image("${escapeString(assetPath(resolved))}", alt: "${escapeString(alt)}", width: ${width}${height ? `, height: ${height}` : ""})`;
}

function htmlCellContent(html, ctx) {
  const images = [...String(html).matchAll(/<img\b[^>]*>/gi)]
    .map((match) => emitHtmlImage(match[0], ctx, true))
    .filter(Boolean);
  const text = emitHtmlText(String(html).replace(/<img\b[^>]*>/gi, ""), true).trim();
  const parts = [];
  if (images.length) parts.push(images.join("\n"));
  if (text) parts.push(text);
  return parts.join(" #linebreak() ");
}

function htmlTableToTypst(html, ctx) {
  const rows = [];
  const occupied = [];
  const source = String(html).replace(/<\/tr>\s*(?=<td\b)/gi, "</tr><tr>");
  for (const rowMatch of source.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [];
    let header = false;

    const rowIndex = rows.length;
    let col = 0;
    for (const cellMatch of rowMatch[1].matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
      const tag = cellMatch[1].toLowerCase();
      const attrs = cellMatch[2] ?? "";
      if (tag === "th") header = true;
      const content = htmlCellContent(cellMatch[3], ctx);
      const colspan = Math.max(1, Number(/colspan\s*=\s*"?\s*(\d+)/i.exec(attrs)?.[1] ?? 1));
      const rowspan = Math.max(1, Number(/rowspan\s*=\s*"?\s*(\d+)/i.exec(attrs)?.[1] ?? 1));
      while (occupied[rowIndex]?.has(col)) col += 1;
      for (let r = rowIndex; r < rowIndex + rowspan; r += 1) {
        occupied[r] ??= new Set();
        for (let c = col; c < col + colspan; c += 1) occupied[r].add(c);
      }
      col += colspan;
      cells.push({ tag, content, colspan, rowspan });
    }

    if (cells.length) rows.push({ cells, header });
  }

  if (!rows.length) return "";
  const columns = Math.max(
    1,
    ...occupied.map((row) => row.size),
  );
  const align = Array.from({ length: columns }, () => "left");
  const lines = [
    "#table(",
    `  columns: ${columns},`,
    `  align: (${align.join(", ")}),`,
  ];

  rows.forEach((row, index) => {
    const rendered = row.cells.map((cell) => {
      const options = [];
      if (cell.colspan > 1) options.push(`colspan: ${cell.colspan}`);
      if (cell.rowspan > 1) options.push(`rowspan: ${cell.rowspan}`);
      // La cabecera y los bordes los decide el tema, también en HTML crudo.
      const inner =
        cell.tag === "th"
          ? `#text(weight: "bold")[${cell.content}]`
          : cell.content;
      return options.length ? `table.cell(${options.join(", ")})[${inner}]` : `[${inner}]`;
    });

    if (index === 0 && row.header) {
      lines.push(`  table.header(${rendered.join(", ")}),`);
      lines.push("  tline,");
    } else {
      lines.push(`  ${rendered.join(", ")},`);
    }
  });

  lines.push(")");
  return lines.join("\n");
}

function emitHtmlBlock(value, ctx, depth = 0) {
  const html = String(value ?? "");
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)]
    .map((match) => {
      const table = htmlTableToTypst(match[1], ctx);
      return table ? alignTableBlock(table, htmlTableAlign(match[0])) : "";
    })
    .filter(Boolean);
  if (tables.length) return tables.join("\n\n");

  // Un bloque HTML puede contener toda una carátula: no descartar los
  // párrafos y títulos que acompañan a la imagen. Solo se descompone una vez:
  // un <p><img></p> volvería a entrar indefinidamente en esta misma rama.
  if (depth === 0 && /<img\b/i.test(html) && /<(?:p|h[1-6])\b/i.test(html)) {
    const parts = [...html.matchAll(/<img\b[^>]*>(?:\s*<br\s*\/?>\s*<em\s+class=["']image-caption["']>[\s\S]*?<\/em>)?|<(p|h[1-6])\b[^>]*>[\s\S]*?<\/\1>/gi)]
      .map((match) => emitHtmlBlock(match[0], ctx, depth + 1)).filter(Boolean);
    const alignment = htmlAlign(html);
    return alignment ? `#align(${alignment})[${parts.join("\n\n")}]` : parts.join("\n\n");
  }

  const images = [...html.matchAll(/<img\b[^>]*>/gi)]
    .map((match) => {
      const image = emitHtmlImage(match[0], ctx);
      if (!image) return "";
      const id = htmlAttr(match[0], "id");
      const caption = /<em\s+class=["']image-caption["']>([\s\S]*?)<\/em>/i.exec(html)?.[1];
      const href = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i.exec(html)?.[1];
      const content = href ? `#link("${escapeString(decodeHtml(href))}")[${image}]` : image;
      if (!caption && !/^fig:[\w.-]+$/.test(id)) return `#block(breakable: false)[${content}]`;
      return `#figure(${content.replace(/^#/, "")}, caption: [${escapeText(caption ? stripHtml(caption) : htmlAttr(match[0], "alt"))}])${/^fig:[\w.-]+$/.test(id) ? ` <${id}>` : ""}`;
    })
    .filter(Boolean);
  if (images.length) {
    const alignment = htmlAlign(html);
    // En un <p> o <h> con imagen y texto, conservar también el texto.
    const surrounding = depth > 0 && /<(?:p|h[1-6])\b/i.test(html)
      ? emitHtmlText(html
        .replace(/<img\b[^>]*>/gi, "")
        .replace(/<em\s+class=["']image-caption["']>[\s\S]*?<\/em>/gi, ""))
      : "";
    const content = [surrounding, ...images].filter(Boolean).join(" #linebreak() ");
    return alignment ? `#align(${alignment})[${content}]` : content;
  }

  const text = stripHtml(html).trim();
  if (!text) return "";

  const heading = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/i.exec(html);
  if (heading) {
    const title = `#heading(level: ${heading[1]})[${emitHtmlText(heading[2])}]`;
    const id = htmlAttr(html, "id");
    const body = /^sec:[\w.-]+$/.test(id) ? `${title} <${id}>` : title;
    const alignment = htmlAlign(html);
    return alignment ? `#align(${alignment})[${body}]` : body;
  }
  const paragraph = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(html);
  const body = paragraph ? emitHtmlText(paragraph[1]) : escapeText(text).replace(/\n+/g, " ");
  const alignment = htmlAlign(html);
  return alignment ? `#align(${alignment})[${body}]` : body;
}

function emitTable(node, attrs, ctx) {
  const count = node.children[0]?.children.length ?? 1;
  const align = (node.align ?? []).map((a) => a ?? "left");
  const [head, ...body] = node.children;

  const merges = parseMergeSpec(attrs.merges);
  const cellAligns = parseCellSpec(attrs.cells);

  const covered = new Set();
  for (const [key, merge] of merges) {
    const [row, col] = key.split("-").map(Number);
    for (let r = row; r < row + merge.rowspan; r += 1) {
      for (let c = col; c < col + merge.colspan; c += 1) {
        if (r === row && c === col) continue;
        covered.add(`${r}-${c}`);
      }
    }
  }

  const renderRow = (rowNode, rowIndex) => {
    const cells = [];
    rowNode.children.forEach((cell, colIndex) => {
      const key = `${rowIndex + 1}-${colIndex + 1}`;
      if (covered.has(key)) return;

      const merge = merges.get(key);
      const alignment = cellAligns.get(key) ?? align[colIndex] ?? "left";
      const options = [];
      if (merge?.colspan > 1) options.push(`colspan: ${merge.colspan}`);
      if (merge?.rowspan > 1) options.push(`rowspan: ${merge.rowspan}`);
      if (alignment && alignment !== "left") options.push(`align: ${alignment}`);

      const cellNodes = cell.children.map((node) => node.type === "text"
        ? { ...node, value: breakLongCellWords(node.value) } : node);
      const body = `[${cellNodes.map((node) => node.type === "html" && /^<img\b/i.test(node.value.trim())
        ? emitHtmlImage(node.value, ctx, true) : emitInlineNode(node, ctx)).join("")}]`;
      cells.push(options.length ? `table.cell(${options.join(", ")})${body}` : body);
    });
    return cells.join(", ");
  };

  const rows = [];
  if (head) rows.push(`table.header(${renderRow(head, 0)}),`);
  rows.push("tline,");
  body.forEach((row, index) => {
    rows.push(`${renderRow(row, index + 1)},`);
  });
  rows.push("tline,");

  const rowCount = (head ? 1 : 0) + body.length;
  const heights = formatHeights(attrs.heights, rowCount);

  const table = [
    "#table(",
    `  columns: ${formatColumns(attrs.widths, count)},`,
    heights ? `  rows: ${heights},` : null,
    attrs.style === "none" ? "  stroke: none," : attrs.style === "horizontal" ? "  stroke: (x: none, y: 0.5pt + luma(200))," : null,
    `  align: (${align.map((a) => a).join(", ")}),`,
    ...rows.map((r) => `  ${r}`),
    ")",
  ]
    .filter(Boolean)
    .join("\n");

  const caption = attrs.caption ?? null;
  const id = attrs.id ?? null;
  if (!caption && !id) return alignTableBlock(table, attrs.align);

  const fig = [
    "#figure(",
    indent(table.replace(/^#/, ""), 2),
    ",",
    `  caption: [${escapeText(String(caption ?? ""))}],`,
    "  kind: table,",
    ")",
  ].join("\n");
  return alignTableBlock(id ? `${fig} <${id}>` : fig, attrs.align);
}

function indent(text, spaces) {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => pad + line)
    .join("\n");
}

function emitList(node, ctx, depth = 0) {
  const pad = "  ".repeat(depth);
  const lines = [];

  for (const item of node.children) {
    const marker = node.ordered ? "+" : "-";
    let checked = "";
    if (typeof item.checked === "boolean") checked = item.checked ? "☒ " : "☐ ";

    const blocks = item.children ?? [];
    const first = blocks[0];
    const rest = blocks.slice(1);

    if (!first) {
      lines.push(`${pad}${marker} ${checked}`.trimEnd());
      continue;
    }

    if (first.type === "paragraph") {
      lines.push(`${pad}${marker} ${checked}${emitInline(first.children, ctx)}`);
    } else if (first.type === "list") {
      lines.push(`${pad}${marker}`);
      lines.push(emitList(first, ctx, depth + 1));
    } else {
      lines.push(`${pad}${marker}`);
      lines.push(indent(emitBlock(first, ctx), (depth + 1) * 2));
    }

    for (const block of rest) {
      if (block.type === "list") {
        lines.push(emitList(block, ctx, depth + 1));
      } else {
        lines.push(indent(emitBlock(block, ctx), (depth + 1) * 2));
      }
    }
  }

  return lines.join("\n");
}

function emitHeading(node, ctx) {
  const attrs = takeTrailingAttrs(node, ctx);
  const id = attrs.id ? attrs.id : `sec:${slugify(toString(node))}`;
  const unique = uniqueId(id, ctx);
  return `#heading(level: ${node.depth})[${emitInline(node.children, ctx)}] <${unique}>`;
}

function emitDirective(node, ctx) {
  const attrs = node.attributes ?? {};

  switch (node.name) {
    case "pagebreak":
      return "#pagebreak()";

    case "keep":
      return `#block(breakable: false)[\n${indent(emitBlocks(node.children ?? [], ctx), 2)}\n]`;

    case "callout": {
      const type = (attrs.type ?? "info").toLowerCase();
      const title = attrs.title ? `title: [${escapeText(attrs.title)}]` : "title: none";
      const body = indent(emitBlocks(node.children ?? [], ctx), 2);
      return `#callout(type: "${type}", ${title})[\n${body}\n]`;
    }

    case "table": {
      const table = (node.children ?? []).find((c) => c.type === "table");
      if (!table) return emitBlocks(node.children ?? [], ctx);
      return emitTable(table, attrs, ctx);
    }

    case "figure": {
      if (attrs.src) {
        return emitFigure(
          { type: "image", url: attrs.src, alt: attrs.caption ?? "" },
          attrs,
          ctx,
        );
      }
      const img = (node.children ?? []).find((c) => c.type === "image");
      if (img) return emitFigure(img, attrs, ctx);
      return emitBlocks(node.children ?? [], ctx);
    }

    default:
      return emitBlocks(node.children ?? [], ctx);
  }
}

function emitBlock(node, ctx) {
  switch (node.type) {
    case "heading":
      return emitHeading(node, ctx);

    case "paragraph": {
      const attrs = takeTrailingAttrs(node, ctx);
      const children = node.children ?? [];

      // \newpage suelto
      if (children.length === 1 && children[0].type === "text" && /^\s*\\newpage\s*$/.test(children[0].value)) {
        return "#pagebreak()";
      }

      // imagen sola => figura con pie
      if (children.length === 1 && children[0].type === "image") {
        return emitFigure(children[0], attrs, ctx);
      }

      return emitInline(children, ctx);
    }

    case "list":
      return emitList(node, ctx);

    case "listItem":
      return emitList({ type: "list", ordered: false, children: [node] }, ctx);

    case "blockquote":
      return `#quote(block: true)[\n${indent(emitBlocks(node.children, ctx), 2)}\n]`;

    case "code":
      return `#raw("${escapeString(node.value)}"${node.lang ? `, lang: "${escapeString(node.lang)}"` : ""}, block: true)`;

    case "table":
      return emitTable(node, node.data?.tableMeta ?? {}, ctx);

    case "thematicBreak":
      return `#v(2pt)\n#line(length: 100%, stroke: 0.6pt + rgb("#c6d0dc"))\n#v(2pt)`;

    case "math":
      return `$ ${latexToTypstMath(node.value)} $`;

    case "html": {
      if (/^\s*<!--\s*pdf-pagebreak\s*-->\s*$/i.test(node.value)) return "#pagebreak()";
      return emitHtmlBlock(node.value, ctx);
    }

    case "containerDirective":
    case "leafDirective":
      return emitDirective(node, ctx);

    case "footnoteDefinition":
    case "yaml":
      return "";

    case "definition":
      return "";

    default:
      if (node.children) return emitBlocks(node.children, ctx);
      return "";
  }
}

// --- API --------------------------------------------------------------------

export function convert(markdown, { source = "markdown", resolveImage = null } = {}) {
  const tree = attachTableMetadata(processor.parse(preprocess(markdown)));
  const ctx = { ids: new Set(), footnotes: new Map(), source, resolveImage };

  visit(tree, "footnoteDefinition", (node) => {
    ctx.footnotes.set(node.identifier, node);
  });

  const body = emitBlocks(tree.children, ctx);
  const frontmatter = tree.children.find((n) => n.type === "yaml");

  return {
    typst: body,
    meta: frontmatter ? YAML.parse(frontmatter.value) ?? {} : {},
  };
}

export default convert;
