// ============================================================================
//  Exportación HTML autocontenida: mismo Markdown, tema del PDF, MathML.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkDirective from "remark-directive";
import remarkFrontmatter from "remark-frontmatter";
import { visit } from "unist-util-visit";
import { toString } from "mdast-util-to-string";
import temml from "temml";
import { chapterPaths, prepareDerivedAssets } from "./project.mjs";
import { attachTableMetadata } from "./table-meta.mjs";
import { DEFAULT_DOCUMENT_THEME, tableColors } from "./document-themes.mjs";
import { protectHtmlTableBlankLines } from "./table-source.mjs";

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkDirective);

const SENTINEL = "\uE000";

function preprocess(markdown) {
  return protectHtmlTableBlankLines(markdown)
    .replace(/@(fig|tbl|sec):([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)/g, (_, kind, id) => `@${kind}${SENTINEL}${id}`)
    .replace(/(\{(?:[#.][^{}\n]*)\})\s*$/gm, (block) => block.replace(/:/g, SENTINEL));
}

function parseAttrs(raw) {
  const attrs = {};
  const tokens = raw.replace(new RegExp(SENTINEL, "g"), ":").match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  for (const token of tokens) {
    if (token.startsWith("#")) attrs.id = token.slice(1);
    else if (token.startsWith(".")) (attrs.class ??= []).push(token.slice(1));
    else {
      const eq = token.indexOf("=");
      if (eq > 0) attrs[token.slice(0, eq)] = token.slice(eq + 1).replace(/^["']|["']$/g, "");
      else attrs[token] = true;
    }
  }
  return attrs;
}

function takeAttrs(node) {
  const last = node.children?.at(-1);
  if (last?.type !== "text") return {};
  const match = last.value.match(/^\s*\{([^{}]*)\}\s*$/);
  if (!match) return {};
  last.value = last.value.slice(0, match.index);
  if (!last.value) node.children.pop();
  return parseAttrs(match[1]);
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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function widthStyle(value) {
  if (!value || value === true) return "";
  if (value === "full") return "width:100%";
  if (/^\d+(\.\d+)?%$/.test(value)) return `width:${value}`;
  if (/^\d+(\.\d+)?(mm|cm|pt|em|in|px)$/.test(value)) return `width:${value}`;
  if (/^\d+(\.\d+)?$/.test(value)) return `width:${value}%`;
  return "";
}

// --- preparación del documento ---------------------------------------------

function refKey(id) {
  return String(id).replace(/^(fig|tbl|sec):/, "");
}

function collectDocument(chapters) {
  const ctx = {
    sections: new Map(),
    figures: new Map(),
    tables: new Map(),
    headings: [],
    ids: new Set(),
    figCounter: 0,
    tblCounter: 0,
    footnotes: new Map(),
    footnoteNumbers: new Map(),
    footnoteOrder: [],
  };

  const uniqueId = (candidate) => {
    let id = candidate;
    let n = 2;
    while (ctx.ids.has(id)) id = `${candidate}-${n++}`;
    ctx.ids.add(id);
    return id;
  };

  for (const chapter of chapters) {
    const nodes = chapter.tree.children;

    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];

      if (node.type === "heading") {
        const attrs = takeAttrs(node);
        const number = "";
        const id = uniqueId(attrs.id ? attrs.id : `sec:${slugify(toString(node))}`);
        node._id = id;
        node._number = number;
        ctx.sections.set(refKey(id), { number, text: toString(node), id });
        ctx.headings.push({ level: node.depth, number, text: toString(node), id });
        continue;
      }

      // figura: párrafo con una sola imagen
      if (node.type === "paragraph") {
        const before = node.children?.length;
        const attrs = takeAttrs(node);
        if (before !== node.children?.length || attrs.id) {
          // los attrs se consumieron; seguimos
        }
        if (node.children?.length === 1 && node.children[0].type === "image" && attrs.id) {
          ctx.figCounter += 1;
          node._figure = { number: ctx.figCounter, caption: node.children[0].alt ?? "", id: uniqueId(attrs.id), width: attrs.width };
          ctx.figures.set(refKey(node._figure.id), {
            number: ctx.figCounter,
            caption: node._figure.caption,
            id: node._figure.id,
          });
        }
      }

      // tabla con directiva
      if ((node.type === "containerDirective" && node.name === "table") || (node.type === "table" && node.data?.tableMeta)) {
        const attrs = node.data?.tableMeta ?? node.attributes ?? {};
        if (attrs.id) {
          ctx.tblCounter += 1;
          const id = uniqueId(attrs.id);
          node._table = {
            number: ctx.tblCounter,
            caption: attrs.caption ?? "",
            widths: attrs.widths ?? "",
            id,
          };
          ctx.tables.set(refKey(id), {
            number: ctx.tblCounter,
            caption: attrs.caption ?? "",
            id,
          });
        } else if (attrs.caption || attrs.widths) {
          ctx.tblCounter += 1;
          node._table = { number: ctx.tblCounter, caption: attrs.caption ?? "", widths: attrs.widths ?? "", id: null };
        }
      }
    }

    visit(chapter.tree, "footnoteDefinition", (definition) => {
      ctx.footnotes.set(definition.identifier, definition);
    });
  }

  return ctx;
}

// --- emisión ----------------------------------------------------------------

function emitInline(nodes, ctx, chapter) {
  return (nodes ?? []).map((node) => emitInlineNode(node, ctx, chapter)).join("");
}

function emitInlineNode(node, ctx, chapter) {
  switch (node.type) {
    case "text":
      return emitText(node.value, ctx).replace(new RegExp(SENTINEL, "g"), ":");

    case "strong":
      return `<strong>${emitInline(node.children, ctx, chapter)}</strong>`;

    case "emphasis":
      return `<em>${emitInline(node.children, ctx, chapter)}</em>`;

    case "delete":
      return `<del>${emitInline(node.children, ctx, chapter)}</del>`;

    case "inlineCode":
      return `<code>${escapeHtml(node.value)}</code>`;

    case "link":
      return `<a href="${escapeHtml(node.url)}">${emitInline(node.children, ctx, chapter)}</a>`;

    case "image": {
      const src = imageDataUri(ctx.root, node.url, ctx.imageMap, chapter.baseDir, ctx.imageMode);
      const style = widthStyle(node.width ?? "100%");
      return `<img src="${src}" alt="${escapeHtml(node.alt ?? "")}" data-src="${escapeHtml(node.url)}" decoding="async"${style ? ` style="${style}"` : ""}>`;
    }

    case "break":
      return "<br>";

    case "footnoteReference": {
      const number = footnoteNumber(node.identifier, ctx);
      return `<sup class="fn-ref" id="fnref-${number}"><a href="#fn-${number}">${number}</a></sup>`;
    }

    case "inlineMath":
      return `<span class="math-inline" data-tex="${escapeHtml(node.value)}">${renderMath(node.value, false)}</span>`;

    case "math":
      return `<span class="math-display-inline" data-tex="${escapeHtml(node.value)}">${renderMath(node.value, true)}</span>`;

    case "html": {
      if (/^\s*<!--\s*pdf-pagebreak\s*-->\s*$/i.test(node.value)) {
        return '<div class="pagebreak"></div>';
      }
      return cleanHtml(node.value, ctx, chapter.baseDir);
    }

    default:
      return node.children ? emitInline(node.children, ctx, chapter) : "";
  }
}

function emitText(text, ctx) {
  const refRe = new RegExp(`@(fig|tbl|sec)${SENTINEL}([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)`, "g");
  let out = "";
  let last = 0;

  for (const match of text.matchAll(refRe)) {
    out += escapeHtml(text.slice(last, match.index));
    const [, kind, id] = match;
    const target = kind === "fig" ? ctx.figures.get(id) : kind === "tbl" ? ctx.tables.get(id) : ctx.sections.get(id);
    if (!target) {
      out += escapeHtml(`@${kind}:${id}`);
    } else {
       const label = kind === "fig" ? `Figura ${target.number}` : kind === "tbl" ? `Tabla ${target.number}` : `Sección ${target.text}`;
      out += `<a class="xref" href="#${escapeHtml(target.id)}">${escapeHtml(label)}</a>`;
    }
    last = match.index + match[0].length;
  }
  out += escapeHtml(text.slice(last));
  return out;
}

function renderMath(latex, display) {
  try {
    return temml.renderToString(latex, { displayMode: display, throwOnError: false, strict: false });
  } catch {
    return `<code>${escapeHtml(latex)}</code>`;
  }
}

function footnoteNumber(identifier, ctx) {
  if (!ctx.footnoteNumbers.has(identifier)) {
    const number = ctx.footnoteNumbers.size + 1;
    ctx.footnoteNumbers.set(identifier, number);
    ctx.footnoteOrder.push(identifier);
  }
  return ctx.footnoteNumbers.get(identifier);
}

function decodePath(value) {
  try {
    return decodeURIComponent(String(value));
  } catch {
    return String(value);
  }
}

function resolveImageFile(root, url, imageMap, baseDir) {
  const raw = String(url).split("#")[0].split("?")[0];
  const clean = decodePath(raw).replace(/^\.?\//, "");
  const derived = imageMap?.get(clean);
  const candidates = [];
  if (derived) candidates.push(path.resolve(root, derived));
  candidates.push(path.resolve(baseDir ?? root, clean));
  candidates.push(path.resolve(root, clean));
  const base = path.basename(clean);
  candidates.push(path.resolve(root, "assets", base));
  candidates.push(path.resolve(root, "assets", base.replace(/_v\d+(?=\.[a-z0-9]+$)/i, "")));
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function imageDataUri(root, url, imageMap, baseDir, mode = "embed") {
  const raw = String(url);
  if (/^data:/i.test(raw)) return raw;
  if (/^(https?:)?\/\//i.test(raw)) return raw;

  const file = resolveImageFile(root, raw, imageMap, baseDir);
  if (!file) {
    const name = path.basename(String(raw).split("#")[0].split("?")[0]);
    const label = `Imagen no encontrada: ${name}`.replace(/[<>&"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[ch]);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="120"><rect width="100%" height="100%" fill="#eef1f5"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#7c8794">${label}</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }
  if (mode === "url") return pathToFileURL(file).href;

  const ext = path.extname(file).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".svg" ? "image/svg+xml" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : "application/octet-stream";
  return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
}

function cleanHtml(html, ctx, baseDir) {
  let out = String(html ?? "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "")
    .replace(/<(object|embed)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\b(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, "");

  // Algunos editores exportan grupos de filas como div con display:table-row-group.
  // El navegador expulsa esos div fuera de <table>; usar tbody conserva las filas.
  out = out.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (table) => table.replace(
    /(<div\b(?=[^>]*\bstyle\s*=\s*["'][^"']*\bdisplay\s*:\s*table-row-group\b)[^>]*>)([\s\S]*?)<\/div>/gi,
    (_match, opening, rows) => `${opening.replace(/^<div/i, "<tbody")}${rows}</tbody>`,
  ));

  out = out.replace(/<img\b[^>]*>/gi, (tag) => {
    const original = /\bsrc\s*=\s*("|')([^"']+)\1/i.exec(tag)?.[2] ?? "";
    let next = tag.replace(/\bsrc\s*=\s*("|')([^"']+)\1/i, (match, quote, src) => {
      if (/^(data:|https?:|\/\/)/i.test(src)) return match;
      return `src=${quote}${imageDataUri(ctx.root, src, ctx.imageMap, baseDir, ctx.imageMode)}${quote}`;
    });
    if (original && !/\bdata-src\s*=/i.test(next)) {
      next = next.replace(/^<img/i, `<img data-src="${escapeHtml(original)}"`);
    }
    return next;
  });

  return out;
}

function emitBlocks(nodes, ctx, chapter) {
  return (nodes ?? [])
    .map((node) => emitBlock(node, ctx, chapter))
    .filter((value) => value && value.trim())
    .join("\n");
}

function emitBlock(node, ctx, chapter) {
  switch (node.type) {
    case "heading": {
      const tag = `h${Math.min(6, node.depth)}`;
      const line = node.position?.start?.line ?? 0;
      return `<${tag} id="${node._id ?? ""}" data-line="${line}">${emitInline(node.children, ctx, chapter)}</${tag}>`;
    }

    case "paragraph": {
      const children = node.children ?? [];
      if (children.length === 1 && children[0].type === "image" && node._figure) {
        const figure = node._figure;
        const image = children[0];
        const src = imageDataUri(ctx.root, image.url, ctx.imageMap, chapter.baseDir, ctx.imageMode);
        const style = widthStyle(figure.width ?? image.width ?? "100%");
        return `<figure id="${figure.id}" data-line="${node.position?.start?.line ?? 0}"><img src="${src}" alt="${escapeHtml(image.alt ?? "")}" data-src="${escapeHtml(image.url)}" decoding="async"${style ? ` style="${style}"` : ""}><figcaption><span class="label">Figura ${figure.number}.</span> ${escapeHtml(figure.caption)}</figcaption></figure>`;
      }
      return `<p data-line="${node.position?.start?.line ?? 0}">${emitInline(children, ctx, chapter)}</p>`;
    }

    case "list": {
      const tag = node.ordered ? "ol" : "ul";
      const start = node.ordered && node.start && node.start !== 1 ? ` start="${node.start}"` : "";
      const items = node.children
        .map((item) => {
          const checkbox =
            typeof item.checked === "boolean"
              ? `<input type="checkbox" disabled${item.checked ? " checked" : ""}> `
              : "";
          const content = item.children
            .map((child) => (child.type === "paragraph" ? emitInline(child.children, ctx, chapter) : emitBlock(child, ctx, chapter)))
            .join("");
          return `<li class="${checkbox ? "task" : ""}">${checkbox}${content}</li>`;
        })
        .join("");
      return `<${tag}${start}>${items}</${tag}>`;
    }

    case "blockquote":
      return `<blockquote>${emitBlocks(node.children, ctx, chapter)}</blockquote>`;

    case "code":
      return `<pre><code${node.lang ? ` class="language-${escapeHtml(node.lang)}"` : ""}>${escapeHtml(node.value)}</code></pre>`;

    case "table": {
      const table = node._table;
      return renderTable(
        node,
        { widths: table?.widths, caption: table?.caption, id: table?.id, line: node.position?.start?.line ?? 0 },
        ctx,
        chapter,
      );
    }

    case "thematicBreak":
      return "<hr>";

    case "math":
      return `<div class="math-display" data-tex="${escapeHtml(node.value)}">${renderMath(node.value, true)}</div>`;

    case "html":
      if (/^\s*<!--\s*pdf-pagebreak\s*-->\s*$/i.test(node.value)) {
        return '<div class="pagebreak"></div>';
      }
      return cleanHtml(node.value, ctx, chapter.baseDir);

    case "containerDirective":
    case "leafDirective":
      return emitDirective(node, ctx, chapter);

    case "footnoteDefinition":
    case "yaml":
      return "";

    default:
      return node.children ? emitBlocks(node.children, ctx, chapter) : "";
  }
}

function renderTable(node, meta, ctx, chapter) {
  const columns = node.children[0]?.children.length ?? 1;
  const widths = (meta.widths ? String(meta.widths).split(/[\s,]+/).filter(Boolean) : []).slice(0, columns);
  const colgroup = widths.length
    ? `<colgroup>${widths.map((width) => `<col style="width:${width}%">`).join("")}</colgroup>`
    : "";

  const [head, ...body] = node.children;
  const merges = new Map();
  const covered = new Set();
  for (const token of String(meta.merges ?? node.data?.tableMeta?.merges ?? "").split(";")) {
    const spec = /^r(\d+)c(\d+):(\d+)x(\d+)$/.exec(token.trim());
    if (!spec) continue;
    const [, row, col, height, width] = spec.map(Number);
    if (row < 1 || col < 1 || height < 1 || width < 1 || row + height - 1 > node.children.length || col + width - 1 > columns) continue;
    merges.set(`${row}-${col}`, { height, width });
    for (let r = row; r < row + height; r += 1) for (let c = col; c < col + width; c += 1) {
      if (r !== row || c !== col) covered.add(`${r}-${c}`);
    }
  }
  const renderCells = (row, rowIndex, tag) => row.children.map((cell, colIndex) => {
    const key = `${rowIndex}-${colIndex + 1}`;
    if (covered.has(key)) return "";
    const merge = merges.get(key);
    const span = `${merge?.width > 1 ? ` colspan="${merge.width}"` : ""}${merge?.height > 1 ? ` rowspan="${merge.height}"` : ""}`;
    return `<${tag}${span} style="text-align:${node.align?.[colIndex] ?? "left"}">${emitInline(cell.children, ctx, chapter)}</${tag}>`;
  }).join("");
  const thead = head
    ? `<thead><tr>${renderCells(head, 1, "th")}</tr></thead>`
    : "";
  const tbody = `<tbody>${body
    .map((row, index) => `<tr>${renderCells(row, index + 2, "td")}</tr>`)
    .join("")}</tbody>`;

  const table = `<table data-line="${meta.line ?? node.position?.start?.line ?? 0}">${colgroup}${thead}${tbody}</table>`;
  if (!meta.caption && !meta.id) return table;

  const caption = meta.caption
    ? `<figcaption><span class="label">Tabla ${meta.number ?? ""}.</span> ${escapeHtml(meta.caption)}</figcaption>`
    : "";
  return `<figure class="table-figure"${meta.id ? ` id="${meta.id}"` : ""} data-line="${meta.line ?? node.position?.start?.line ?? 0}">${caption}${table}</figure>`;
}

function emitDirective(node, ctx, chapter) {
  const attrs = node.attributes ?? {};

  switch (node.name) {
    case "pagebreak":
      return '<div class="pagebreak"></div>';

    case "keep":
      return `<div class="keep">${emitBlocks(node.children, ctx, chapter)}</div>`;

    case "callout": {
      const type = (attrs.type ?? "info").toLowerCase();
      const title = attrs.title ? `<div class="callout-title">${escapeHtml(attrs.title)}</div>` : "";
      return `<div class="callout ${escapeHtml(type)}">${title}${emitBlocks(node.children, ctx, chapter)}</div>`;
    }

    case "table": {
      const table = (node.children ?? []).find((child) => child.type === "table");
      if (!table) return emitBlocks(node.children, ctx, chapter);
      const meta = node._table;
      return renderTable(
        table,
        {
          widths: attrs.widths,
          merges: attrs.merges,
          caption: attrs.caption,
          id: attrs.id,
          number: meta?.number,
          line: node.position?.start?.line ?? table.position?.start?.line ?? 0,
        },
        ctx,
        chapter,
      );
    }

    case "figure": {
      const image = (node.children ?? []).find((child) => child.type === "image");
      if (image && attrs.src) image.url = attrs.src;
      if (image) {
        const src = imageDataUri(ctx.root, image.url, ctx.imageMap);
        const style = widthStyle(attrs.width);
        return `<figure${attrs.id ? ` id="${attrs.id}"` : ""}><img src="${src}" alt="${escapeHtml(image.alt ?? "")}"${style ? ` style="${style}"` : ""}>${attrs.caption ? `<figcaption>${escapeHtml(attrs.caption)}</figcaption>` : ""}</figure>`;
      }
      return emitBlocks(node.children, ctx, chapter);
    }

    default:
      return emitBlocks(node.children, ctx, chapter);
  }
}

// --- documento --------------------------------------------------------------

function fontFace(root, family, file, weight, style) {
  const full = path.join(root, "theme", "fonts", file);
  if (!fs.existsSync(full)) return "";
  const data = fs.readFileSync(full).toString("base64");
  const mime = file.endsWith(".otf") ? "font/otf" : "font/ttf";
  return `@font-face{font-family:"${family}";font-weight:${weight};font-style:${style};src:url(data:${mime};base64,${data}) format("${file.endsWith(".otf") ? "opentype" : "truetype"}");}`;
}

function css(root, cfg) {
  const tableTheme = tableColors(root, cfg.documentTheme ?? DEFAULT_DOCUMENT_THEME);
  const fonts = [
    fontFace(root, "Source Serif 4", "SourceSerif4-Regular.otf", 400, "normal"),
    fontFace(root, "Source Serif 4", "SourceSerif4-It.otf", 400, "italic"),
    fontFace(root, "Source Serif 4", "SourceSerif4-Bold.otf", 700, "normal"),
    fontFace(root, "Source Sans 3", "SourceSans3-Semibold.otf", 600, "normal"),
    fontFace(root, "Source Sans 3", "SourceSans3-Bold.otf", 700, "normal"),
    fontFace(root, "JetBrains Mono", "JetBrainsMono-Regular.ttf", 400, "normal"),
  ].join("\n");

  return `${fonts}
 :root{--navy:#1e3a5f;--ink:#1b1d21;--muted:#5d6672;--line:#d7dee7;--soft:#eaf0f6;--table-text:${tableTheme.text};--table-line:${tableTheme.border};--table-head:${tableTheme.header};--table-head-text:${tableTheme.headerText};}
*{box-sizing:border-box}
body{margin:0;background:#eef1f5;color:var(--ink);font:16px/1.65 "Source Serif 4",Georgia,serif;}
.doc{width:210mm;min-height:297mm;margin:28px auto;padding:24mm 25mm;background:#fff;box-shadow:0 10px 40px rgba(20,32,48,.18);}
.cover{min-height:230mm;display:flex;flex-direction:column;justify-content:center;text-align:center;border-bottom:1px solid var(--line);}
.cover .inst{font:600 11px "Source Sans 3",sans-serif;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
.cover .rule{width:36mm;height:2px;background:var(--navy);margin:14px auto 34px}
.cover h1{font:700 34px/1.2 "Source Sans 3",sans-serif;color:var(--navy);margin:0 0 14px;border:0;padding:0}
.cover .sub{font:400 16px "Source Sans 3",sans-serif;color:var(--muted)}
.cover .meta{margin-top:70px;font:400 14px "Source Sans 3",sans-serif;color:var(--muted);line-height:1.9}
.toc{page-break-after:always;padding-top:10mm}
.toc h2{font:700 26px "Source Sans 3",sans-serif;color:var(--navy);border:0;margin:0 0 6px}
.toc .rule{height:2px;background:var(--navy);margin-bottom:18px}
.toc ol{list-style:none;padding:0;margin:0}
.toc li{font:400 14px/1.9 "Source Sans 3",sans-serif;display:flex;gap:8px}
.toc li a{color:var(--ink);text-decoration:none;flex:1}
.toc li .dots{flex:1;border-bottom:1px dotted #b9c4d1;transform:translateY(-4px)}
.toc .lvl2{padding-left:18px}
.toc .lvl3{padding-left:36px;font-size:13px;color:var(--muted)}
article h1{font:700 30px/1.25 "Source Sans 3",sans-serif;color:var(--navy);margin:0 0 18px;padding-bottom:8px;border-bottom:2px solid var(--navy);page-break-before:always}
article section.chapter:first-child h1{page-break-before:auto}
h2{font:600 21px/1.3 "Source Sans 3",sans-serif;color:var(--navy);margin:30px 0 10px}
h3{font:600 17px/1.35 "Source Sans 3",sans-serif;color:#2c5282;margin:22px 0 8px}
h4{font:600 15px "Source Sans 3",sans-serif;color:#2c5282;margin:18px 0 6px}
.num{color:var(--navy);margin-right:.35em}
p{margin:0 0 .85em;text-align:justify;hyphens:auto}
a{color:#1e5f9e}
a.xref{color:var(--navy);text-decoration:none;border-bottom:1px dotted #9db8d4}
code{font:13px "JetBrains Mono",monospace;background:#f4f6f8;padding:1px 4px;border-radius:3px}
pre{background:#f4f6f8;padding:12px 14px;border-radius:6px;overflow:auto}
pre code{background:none;padding:0;font-size:13px;line-height:1.55}
blockquote{margin:1em 0;padding:2px 0 2px 14px;border-left:3px solid var(--line);color:var(--muted);font-style:italic}
figure{margin:18px 0;text-align:center;break-inside:avoid}
figure img{max-width:100%;height:auto}
figcaption{font:12.5px "Source Sans 3",sans-serif;color:var(--muted);margin-top:7px}
figcaption .label{color:var(--navy);font-weight:600}
.table-figure{text-align:left}
 table{width:100%!important;table-layout:fixed!important;border-collapse:collapse;font:13.5px "Source Sans 3",sans-serif;margin:8px 0}
 th,td{padding:7px 9px;border-bottom:1px solid var(--table-line);vertical-align:top;overflow-wrap:anywhere;word-break:break-word;white-space:normal!important;min-width:0;color:var(--table-text)}
 th *,td *{overflow-wrap:anywhere;word-break:break-word;white-space:normal!important}
 th img,td img{display:inline-block;max-width:100%!important;height:auto!important;object-fit:contain;vertical-align:middle}
 th{background:var(--table-head);color:var(--table-head-text);font-weight:600;text-align:left}
thead tr:first-child th{border-top:1px solid var(--line)}
.callout{margin:16px 0;padding:12px 14px;background:var(--soft);border-left:4px solid var(--navy);border-radius:0 4px 4px 0;break-inside:avoid}
.callout.warning{background:#fff8ed;border-color:#b45309}
.callout.danger{background:#fef2f2;border-color:#b91c1c}
.callout.success{background:#f0fdf4;border-color:#15803d}
.callout-title{font:600 13px "Source Sans 3",sans-serif;color:var(--navy);margin-bottom:4px}
.keep{break-inside:avoid}
.pagebreak{height:0}
.math-display{text-align:center;margin:14px 0;overflow-x:auto}
.math-inline{white-space:nowrap}
.footnotes{margin-top:40px;border-top:1px solid var(--line);padding-top:10px;font:13px "Source Sans 3",sans-serif;color:var(--muted)}
.footnotes ol{padding-left:20px}
.fn-ref a{text-decoration:none;color:var(--navy);font-weight:600}
hr{border:0;border-top:1px solid var(--line);margin:22px 0}
ul,ol{margin:0 0 1em 1.2em;padding:0}
li{margin:.2em 0}
li.task{list-style:none;margin-left:-1.2em}
@media print{
  body{background:#fff}
  .doc{width:auto;min-height:0;margin:0;padding:0;box-shadow:none}
  .pagebreak{break-after:page}
  article h1{page-break-before:always}
  article section.chapter:first-child h1{page-break-before:auto}
  .toc{page-break-after:always}
}
@media (max-width:760px){.doc{width:auto;padding:20px;margin:0;box-shadow:none}}
`;
}

function footnotesHtml(ctx) {
  if (!ctx.footnoteOrder.length) return "";
  const items = ctx.footnoteOrder
    .map((identifier) => {
      const number = ctx.footnoteNumbers.get(identifier);
      const definition = ctx.footnotes.get(identifier);
      if (!definition) return "";
      const chapter = { root: ctx.root };
      const body = emitBlocks(definition.children, ctx, chapter);
      return `<li id="fn-${number}">${body} <a href="#fnref-${number}">↩</a></li>`;
    })
    .join("");
  return `<section class="footnotes"><ol>${items}</ol></section>`;
}

export async function exportHtml(root, cfg, outPath) {
  const imageMap = await prepareDerivedAssets(root);
  const chapters = chapterPaths(root, cfg).map((rel) => {
    const abs = path.join(root, rel);
    const source = fs.readFileSync(abs, "utf8");
    return { rel, root, baseDir: path.dirname(abs), tree: attachTableMetadata(processor.parse(preprocess(source))) };
  });

  const ctx = collectDocument(chapters);
  ctx.root = root;
  ctx.imageMap = imageMap;
  ctx.imageMode = "embed";

  const body = chapters
    .map((chapter) => `<section class="chapter">${emitBlocks(chapter.tree.children, ctx, chapter)}</section>`)
    .join("\n");

  const html = `<!doctype html>
<html lang="${escapeHtml(cfg.lang ?? "es")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(cfg.title)}</title>
 <style>${css(root, cfg)}</style>
</head>
<body>
<main class="doc">
<article>
${body}
</article>
${footnotesHtml(ctx)}
</main>
</body>
</html>`;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, "utf8");
  return { output: outPath, bytes: Buffer.byteLength(html) };
}

function blockKind(node) {
  if (node.type === "heading") return "heading";
  if (node.type === "paragraph") return node._figure ? "figure" : "paragraph";
  if (node.type === "list") return "list";
  if (node.type === "blockquote") return "blockquote";
  if (node.type === "code") return "code";
  if (node.type === "math") return "math";
  if (node.type === "table") return "table";
  if (node.type === "html") return "html";
  if (node.type === "containerDirective") {
    if (node.name === "table") return "table";
    if (node.name === "figure") return "figure";
    if (node.name === "callout") return "callout";
    return "container";
  }
  return node.children ? "container" : "noop";
}

/** Bloques de primer nivel con sus líneas de origen, para editar en la vista. */
function emitTopBlocks(nodes, ctx, chapter) {
  return (nodes ?? [])
    .map((node) => {
      const html = emitBlock(node, ctx, chapter).trim();
      if (!html) return "";
      const kind = blockKind(node);
      if (kind === "noop") return html;
      const start = node.position?.start?.line ?? 0;
      const end = node.position?.end?.line ?? start;
      return `<div class="md-block" data-kind="${kind}" data-start="${start}" data-end="${end}">${html}</div>`;
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * Fragmento HTML de un capítulo, para el modo lectura del editor.
 * Usa el mismo parser/numeración que la exportación HTML.
 */
export async function renderChapterHtml(root, cfg, rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return "";

  const imageMap = await prepareDerivedAssets(root);
  const source = fs.readFileSync(abs, "utf8");
  const chapter = {
    rel,
    root,
    baseDir: path.dirname(abs),
    tree: attachTableMetadata(processor.parse(preprocess(source))),
  };

  const ctx = collectDocument([chapter]);
  ctx.root = root;
  ctx.imageMap = imageMap;
  ctx.imageMode = "url";

  return emitTopBlocks(chapter.tree.children, ctx, chapter);
}
