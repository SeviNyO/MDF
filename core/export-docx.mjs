// ============================================================================
//  Exportación a Word (.docx) mediante Pandoc, desde el mismo Markdown.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chapterPaths } from "./project.mjs";

const execFileAsync = promisify(execFile);

function parseAttrs(raw) {
  const attrs = {};
  const tokens = raw.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  for (const token of tokens) {
    if (token.startsWith("#")) attrs.id = token.slice(1);
    else {
      const eq = token.indexOf("=");
      if (eq > 0) attrs[token.slice(0, eq)] = token.slice(eq + 1).replace(/^["']|["']$/g, "");
      else attrs[token] = true;
    }
  }
  return attrs;
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

function uniqueKey(map, base) {
  let key = base;
  let n = 2;
  while (map.has(key)) key = `${base}-${n++}`;
  return key;
}

// --- numeración previa -------------------------------------------------------

function scanDocument(chapters) {
  const figures = new Map();
  const tables = new Map();
  const sections = new Map();
  let fig = 0;
  let tbl = 0;
  const counters = [0, 0, 0];
  const ids = new Set();

  for (const chapter of chapters) {
    const lines = chapter.lines;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];

      const heading = line.match(/^(#{1,3})\s+(.*)$/);
      if (heading) {
        const depth = heading[1].length;
        counters[depth - 1] += 1;
        for (let j = depth; j < 3; j += 1) counters[j] = 0;
        const number = counters.slice(0, depth).join(".");

        const attrMatch = heading[2].match(/\{#([^}\s]+)\s*\}\s*$/);
        const explicit = attrMatch?.[1];
        const text = heading[2].replace(/\{[^}]*\}\s*$/, "").trim();
        const base = explicit ? explicit.replace(/^sec:/, "") : slugify(text);
        const key = uniqueKey(sections, base);
        ids.add(key);
        sections.set(key, { number, text: text.replace(/[*_`]/g, "") });
        continue;
      }

      const images = [...line.matchAll(/!\[[^\]]*\]\([^)]+\)\{([^}]*)\}/g)];
      for (const image of images) {
        const attrs = parseAttrs(image[1]);
        if (attrs.id) {
          fig += 1;
          figures.set(attrs.id.replace(/^fig:/, ""), fig);
        }
      }

      const table = line.match(/^\s*:::table\s*\{([^}]*)\}\s*$/);
      if (table) {
        const attrs = parseAttrs(table[1]);
        tbl += 1;
        if (attrs.id) tables.set(attrs.id.replace(/^tbl:/, ""), tbl);
        tables.set(`__caption_${i}`, tbl);
      }
    }
  }

  return { figures, tables, sections };
}

// --- transformación ---------------------------------------------------------

function imageWidth(value) {
  if (!value) return null;
  if (/^\d+(\.\d+)?%$/.test(value)) {
    const pct = Number(value.replace("%", ""));
    return `${((pct / 100) * 6.3).toFixed(2)}in`;
  }
  if (/^\d+(\.\d+)?(mm|cm|in|pt)$/.test(value)) return value;
  if (value === "full") return "6.3in";
  if (/^\d+(\.\d+)?$/.test(value)) return `${((Number(value) / 100) * 6.3).toFixed(2)}in`;
  return null;
}

function replaceRefs(text, maps) {
  return text
    .replace(/@fig:([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)/g, (match, id) => {
      const number = maps.figures.get(id);
      return number ? `Figura ${number}` : match;
    })
    .replace(/@tbl:([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)/g, (match, id) => {
      const number = maps.tables.get(id);
      return number ? `Tabla ${number}` : match;
    })
    .replace(/@sec:([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)/g, (match, id) => {
      const section = maps.sections.get(id);
      return section ? `Sección ${section.number}` : match;
    });
}

function transformChapter(lines, maps) {
  const out = [];
  let tableIndex = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    const tableStart = line.match(/^\s*:::table\s*\{([^}]*)\}\s*$/);
    if (tableStart) {
      const attrs = parseAttrs(tableStart[1]);
      let end = i + 1;
      while (end < lines.length && !/^\s*:::\s*$/.test(lines[end])) end += 1;
      const body = lines.slice(i + 1, end);
      tableIndex += 1;
      const number = maps.tables.get(`__caption_${i}`) ?? tableIndex;

      out.push(...body);
      out.push("");
      if (attrs.caption) out.push(`: Tabla ${number}: ${attrs.caption}`);
      out.push("");
      i = end;
      continue;
    }

    const callout = line.match(/^\s*:::callout\s*\{([^}]*)\}\s*$/);
    if (callout) {
      const attrs = parseAttrs(callout[1]);
      let end = i + 1;
      while (end < lines.length && !/^\s*:::\s*$/.test(lines[end])) end += 1;
      const body = lines.slice(i + 1, end);
      if (attrs.title) {
        out.push(`> **${attrs.title}**`);
        out.push(">");
      }
      for (const bodyLine of body) out.push(bodyLine.trim() ? `> ${bodyLine}` : ">");
      out.push("");
      i = end;
      continue;
    }

    if (/^\s*:::keep\s*$/.test(line)) {
      let end = i + 1;
      while (end < lines.length && !/^\s*:::\s*$/.test(lines[end])) end += 1;
      out.push(...lines.slice(i + 1, end));
      out.push("");
      i = end;
      continue;
    }

    if (/^\s*:::pagebreak\s*$/.test(line) || /^\s*\\newpage\s*$/.test(line)) {
      out.push(
        "```{=openxml}",
        '<w:p><w:r><w:br w:type="page"/></w:r></w:p>',
        "```",
        "",
      );
      if (/^\s*:::pagebreak/.test(line) && /^\s*:::\s*$/.test(lines[i + 1] ?? "")) i += 1;
      continue;
    }

    if (/^\s*:::\s*$/.test(line)) continue;

    // figuras: numerar el pie y convertir el ancho a pulgadas
    const withFigures = line.replace(/!\[([^\]]*)\]\(([^)]+)\)\{([^}]*)\}/g, (match, alt, src, raw) => {
      const attrs = parseAttrs(raw);
      if (!attrs.id) return match;
      const number = maps.figures.get(attrs.id.replace(/^fig:/, ""));
      const caption = number ? `Figura ${number}. ${alt}` : alt;
      const width = imageWidth(attrs.width);
      const pieces = [];
      if (attrs.id) pieces.push(`#${attrs.id}`);
      if (width) pieces.push(`width=${width}`);
      return `![${caption}](${src}){${pieces.join(" ")}}`;
    });

    out.push(replaceRefs(withFigures, maps));
  }

  return out.join("\n");
}

// --- API --------------------------------------------------------------------

export async function exportDocx(root, cfg, outPath, options = {}) {
  const pandoc = options.pandocPath || process.env.PANDOC_PATH || "pandoc";
  const chapters = chapterPaths(root, cfg).map((rel) => {
    const raw = fs.readFileSync(path.join(root, rel), "utf8").replace(/^---\n[\s\S]*?\n---\n/, "");
    return { rel, lines: raw.split("\n") };
  });

  const maps = scanDocument(chapters);
  if (process.env.EXPORT_DEBUG) {
    console.log("figures", [...maps.figures.entries()]);
    console.log("tables", [...maps.tables.entries()]);
    console.log("sections", [...maps.sections.entries()].slice(0, 5));
  }
  const parts = chapters.map((chapter, index) => {
    const body = transformChapter(chapter.lines, maps);
    if (index === 0) return body;
    const pageBreak = '```{=openxml}\n<w:p><w:r><w:br w:type="page"/></w:r></w:p>\n```\n';
    return `${pageBreak}\n${body}`;
  });

  const markdown = parts.join("\n\n");
  const buildDir = path.join(root, "build");
  fs.mkdirSync(buildDir, { recursive: true });
  const markdownPath = path.join(buildDir, "export.md");
  fs.writeFileSync(markdownPath, markdown, "utf8");

  const target = path.join(buildDir, "export.docx");
  const args = [
    path.join("build", "export.md"),
    "-f",
    "markdown",
    "-t",
    "docx",
    "--resource-path=.",
    "--metadata",
    `title=${cfg.title}`,
    "--metadata",
    `subtitle=${cfg.subtitle ?? ""}`,
    "--metadata",
    `author=${cfg.authors.join(", ")}`,
    "--metadata",
    `date=${cfg.date ?? ""}`,
    "-o",
    path.join("build", "export.docx"),
  ];

  try {
    await execFileAsync(pandoc, args, { cwd: root });
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("Pandoc no está instalado. Instálalo para exportar a Word (DOCX).");
    }
    throw new Error(String(error.stderr || error.message));
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.copyFileSync(target, outPath);
  return { output: outPath, bytes: fs.statSync(outPath).size };
}
