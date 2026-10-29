// ============================================================================
//  Proyecto: configuración, render y compilación (compartido por CLI y app)
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { execFile, execFileSync } from "node:child_process";
import YAML from "yaml";
import { convert } from "./md2typst.mjs";
import { DEFAULT_DOCUMENT_THEME, ensureThemeLibrary, themePath } from "./document-themes.mjs";
import { svgImageBounds } from "./svg-image-bounds.mjs";

export const DEFAULTS = {
  title: "Documento sin título",
  subtitle: "",
  authors: ["Autor"],
  course: "",
  institution: "",
  date: "",
  lang: "es",
  page: {
    size: "a4",
    top: 26,
    bottom: 24,
    left: 25,
    right: 25,
    fontsize: 10.5,
  },
  chapters: [],
  numbering: "auto",
  output: "documento.pdf",
};

function typstString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function typstKey(key) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : typstString(key);
}

export function typstValue(value) {
  if (value === null || value === undefined) return "none";
  if (value instanceof Date) return typstString(value.toISOString().slice(0, 10));
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return typstString(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "()";
    const items = value.map(typstValue).join(", ");
    return value.length === 1 ? `(${items},)` : `(${items})`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${typstKey(k)}: ${typstValue(v)}`);
    return `(${entries.join(", ")})`;
  }
  return "none";
}

/** Archivos Markdown de la carpeta, en orden natural (01-, 02-, …). */
export function discoverChapters(root) {
  const isMd = (name) => /\.md$/i.test(name) && !/^readme\.md$/i.test(name);
  const sortNatural = (list) =>
    list.sort((a, b) => a.localeCompare(b, "es", { numeric: true, sensitivity: "base" }));

  const manuscript = path.join(root, "manuscript");
  if (fs.existsSync(manuscript)) {
    const inside = sortNatural(
      fs
        .readdirSync(manuscript, { withFileTypes: true })
        .filter((entry) => entry.isFile() && isMd(entry.name))
        .map((entry) => `manuscript/${entry.name}`),
    );
    if (inside.length) return inside;
  }

  const skip = new Set([
    "node_modules",
    ".git",
    "build",
    "dist",
    "release",
    "vendor",
    ".cache",
    "__pycache__",
    "theme",
    "assets",
  ]);
  const found = [];
  const walk = (dir, rel = "", depth = 0) => {
    if (depth > 2) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || skip.has(entry.name)) continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), child, depth + 1);
      else if (isMd(entry.name)) found.push(child);
    }
  };
  walk(root);
  return sortNatural(found);
}

export function loadConfig(root) {
  const file = path.join(root, "book.yaml");
  const raw = fs.existsSync(file) ? (YAML.parse(fs.readFileSync(file, "utf8")) ?? {}) : {};
  const cfg = { ...DEFAULTS, ...raw };
  cfg.page = { ...DEFAULTS.page, ...(raw.page ?? {}) };
  cfg.authors = Array.isArray(cfg.authors) ? cfg.authors : [String(cfg.authors)];
  if (!raw.title) cfg.title = path.basename(root) || DEFAULTS.title;
  cfg.autoChapters = !Array.isArray(raw.chapters) || raw.chapters.length === 0;
  if (cfg.autoChapters) {
    cfg.chapters = discoverChapters(root);
  }
  return cfg;
}

function copyDirSync(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) copyDirSync(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

/**
 * Prepara una carpeta para poder compilar aunque no sea un proyecto Informe:
 * crea book.yaml y copia el tema incluido si faltan. Devuelve lo creado.
 */
export function ensureProjectScaffold(root, themeSource = null) {
  const created = [];

  const bookFile = path.join(root, "book.yaml");
  if (!fs.existsSync(bookFile)) {
    const config = {
      title: path.basename(root) || "Documento",
      subtitle: "",
      authors: ["Autor"],
      course: "",
      institution: "",
      date: "",
      lang: "es",
      chapters: [],
      output: "documento.pdf",
    };
    const header =
      "# Generado por Informe. Añade capítulos en orden o deja [] para usar\n" +
      "# todos los archivos .md de la carpeta en orden alfabético.\n";
    fs.writeFileSync(bookFile, header + YAML.stringify(config), "utf8");
    created.push("book.yaml");
  }

  const themeDir = path.join(root, "theme");
  const source = themeSource ?? path.join(path.dirname(root), "theme");
  if (!fs.existsSync(path.join(themeDir, "theme.typ")) && fs.existsSync(path.join(source, "theme.typ"))) {
    fs.mkdirSync(themeDir, { recursive: true });
    fs.copyFileSync(path.join(source, "theme.typ"), path.join(themeDir, "theme.typ"));
    if (!fs.existsSync(path.join(themeDir, "fonts")) && fs.existsSync(path.join(source, "fonts"))) {
      copyDirSync(path.join(source, "fonts"), path.join(themeDir, "fonts"));
    }
    created.push("theme/");
  }
  ensureThemeLibrary(root, source);

  return created;
}

export function chapterPaths(root, cfg) {
  return cfg.chapters.map((entry) => (typeof entry === "string" ? entry : entry.file));
}

function validImageFile(file) {
  try {
    const buffer = fs.readFileSync(file);
    const ext = path.extname(file).toLowerCase();
    if (ext === ".png") {
      return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
    if (ext === ".jpg" || ext === ".jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8;
    if (ext === ".gif") return buffer.subarray(0, 4).toString() === "GIF8";
    if (ext === ".webp") {
      return buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP";
    }
    if (ext === ".bmp") return buffer.subarray(0, 2).toString() === "BM";
    if (ext === ".svg") return /<svg/i.test(buffer.subarray(0, 4000).toString());
    return false;
  } catch {
    return false;
  }
}

/** Descarga imágenes remotas (Markdown o HTML) para poder incluirlas en el PDF. */
export async function prepareRemoteAssets(root, cfg) {
  const urls = new Set();
  const imageRe = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
  const imgTagRe = /<img\b[^>]*\bsrc\s*=\s*["'](https?:\/\/[^"']+)["']/gi;

  for (const rel of chapterPaths(root, cfg)) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    const source = fs.readFileSync(abs, "utf8");
    for (const match of source.matchAll(imageRe)) urls.add(match[1]);
    for (const match of source.matchAll(imgTagRe)) urls.add(match[1]);
  }

  const map = new Map();
  if (!urls.size) return map;

  const dir = path.join(root, "build", "remote");
  fs.mkdirSync(dir, { recursive: true });

  await Promise.all(
    [...urls].map(async (url) => {
      try {
        const ext = path.extname(new URL(url).pathname).split("?")[0] || ".png";
        const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 16);
        const name = `remote-${hash}${ext}`;
        const file = path.join(dir, name);

        if (!fs.existsSync(file)) {
          const response = await fetch(url, {
            signal: AbortSignal.timeout(9000),
            headers: { "user-agent": "Informe/0.2" },
          });
          if (!response.ok) return;
          const length = Number(response.headers.get("content-length") ?? 0);
          if (length > 20 * 1024 * 1024) return;
          const buffer = Buffer.from(await response.arrayBuffer());
          if (buffer.length > 20 * 1024 * 1024) return;
          fs.writeFileSync(file, buffer);
        }
        if (!validImageFile(file)) {
          fs.rmSync(file, { force: true });
          return;
        }

        map.set(url, `build/remote/${name}`);
      } catch {
        // sin red o URL no accesible: se omite la imagen
      }
    }),
  );

  return map;
}

/** Convierte todos los capítulos y devuelve el cuerpo Typst. */
export function renderBody(root, cfg, imageMap = new Map(), remoteMap = new Map()) {
  const warnings = [];
  const parts = [];
  const sources = chapterPaths(root, cfg).map((rel) => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) throw new Error(`Capítulo no encontrado: ${rel}`);
    return { rel, source: fs.readFileSync(abs, "utf8") };
  });

  // Índice de imágenes por nombre de archivo: algunos .md traen rutas rotas
  // (por ejemplo, chapter-02/assets/foo_v2.png cuando el archivo real está
  // en assets/foo.png). Buscamos por nombre antes de rendirnos.
  const assetIndex = new Map();
  const indexImages = (dir, depth = 0) => {
    if (depth > 3) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || ["build", "dist", "release", "node_modules", "theme"].includes(entry.name)) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        indexImages(full, depth + 1);
      } else if (/\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(entry.name)) {
        const key = entry.name.toLowerCase();
        if (!assetIndex.has(key)) {
          assetIndex.set(key, path.relative(root, full).split(path.sep).join("/"));
        }
      }
    }
  };
  indexImages(root);

  // Si los títulos ya vienen numerados a mano, no añadimos otra numeración.
  let headings = 0;
  let numbered = 0;
  let majorHeadings = 0;
  let majorNumbered = 0;

  for (const { source } of sources) {
    for (const line of source.split(/\r?\n/)) {
      const match = line.match(/^(#{1,6})\s+(.+)/);
      if (!match) continue;
      headings += 1;
      const depth = match[1].length;
      const text = match[2].trim();
      const manual =
        /^(\d+(?:\.\d+)*\.?|[IVXLC]+[.)])\s+/.test(text) ||
        /^(cap[ií]tulo|chapter|anexo|ap[eé]ndice|secci[oó]n)\b/i.test(text);

      if (manual) numbered += 1;
      if (depth <= 2) {
        majorHeadings += 1;
        if (manual) majorNumbered += 1;
      }
    }
  }

  const majorRatio = majorHeadings ? majorNumbered / majorHeadings : 0;
  if ((majorHeadings >= 2 && majorRatio >= 0.5) || (headings >= 4 && numbered / headings >= 0.3)) {
    cfg.numbering = "none";
  } else if (!cfg.numbering) {
    cfg.numbering = "auto";
  }

  for (const { rel, source } of sources) {
    const sourceDir = path.posix.dirname(rel);
    const resolveImage = (src) => {
      const raw = String(src);
      if (/^(https?:)?\/\//i.test(raw)) {
        return remoteMap.get(raw) ? `/${remoteMap.get(raw)}` : raw;
      }
      if (/^data:/i.test(raw)) return raw;
      let clean = raw.replace(/\\/g, "/").split("#")[0].split("?")[0];
      try {
        clean = decodeURIComponent(clean);
      } catch {
        // se queda tal cual
      }
      const normalized = clean.startsWith("/")
        ? clean.replace(/^\/+/, "")
        : path.posix.normalize(path.posix.join(sourceDir, clean));
      const fallback = clean.replace(/^\.?\//, "");
      const base = path.posix.basename(clean);
      const variants = [base, base.replace(/_v\d+(?=\.[a-z0-9]+$)/i, "")];
      const indexed = variants
        .map((variant) => assetIndex.get(variant.toLowerCase()))
        .find(Boolean);
      const key = [normalized, fallback, `assets/${base}`, indexed].find(
        (candidate) =>
          candidate &&
          fs.existsSync(path.join(root, candidate)) &&
          validImageFile(path.join(root, candidate)),
      );
      if (!key) return "";
      const derived = imageMap.get(key);
      if (derived) return derived.startsWith("/") ? derived : `/${derived}`;
      return `/${key.replace(/^\/+/, "")}`;
    };

    const { typst, meta } = convert(source, { source: rel, resolveImage });
    if (meta && Object.keys(meta).length) {
      warnings.push(`${rel}: frontmatter ignorado por ahora (${Object.keys(meta).join(", ")})`);
    }
    parts.push(`// ---- ${rel} ----\n${typst.trim()}`);
  }

  if (!parts.length) {
    warnings.push("No hay archivos Markdown en la carpeta; el PDF saldrá vacío.");
    return { body: "", warnings };
  }
  return { body: parts.join("\n\n"), warnings };
}

/** Genera build/book.typ (y las imágenes derivadas de los recortes). */
export async function writeBook(root, cfg = loadConfig(root)) {
  const selectedTheme = themePath(root, cfg.documentTheme ?? DEFAULT_DOCUMENT_THEME);
  if (!fs.statSync(path.join(root, selectedTheme), { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`No existe el tema ${selectedTheme}; selecciona otro tema en la aplicación`);
  }
  const imageMap = await prepareDerivedAssets(root);
  const remoteMap = await prepareRemoteAssets(root, cfg);
  const { body, warnings } = renderBody(root, cfg, imageMap, remoteMap);
  const typ = `// ARCHIVO GENERADO por la app — no lo edites a mano.
 // Fuente: ${chapterPaths(root, cfg).length} capítulo(s) + ${selectedTheme}
 // Motor: Typst

 #import "../${selectedTheme}": *

 // Esta función debe estar en el libro generado: un proyecto abierto puede
 // conservar su propia copia anterior de theme.typ sin fit-image. No tocarla.
 #let fit-image(src, alt: "", width: auto, height: auto, fit: "contain") = context {
   let content = image(src, alt: alt, width: width, height: height, fit: fit)
   let measured = measure(content)
   if measured.height > 205mm or measured.width > 160mm {
     image(
       src, alt: alt,
       width: if measured.width > 160mm { 100% } else { width },
       height: if measured.height > 205mm { 205mm } else { height },
       fit: "contain",
     )
   } else {
     content
   }
 }

 #let cfg = ${typstValue({
    title: cfg.title,
    subtitle: cfg.subtitle,
    authors: cfg.authors,
    course: cfg.course,
    institution: cfg.institution,
    date: cfg.date,
    lang: cfg.lang,
    numbering: "none",
    page: cfg.page,
  })}

#show: rules.with(cfg)
 #set heading(numbering: none)

// ---------- cuerpo ----------
// Solo se renderiza el contenido escrito en los Markdown. La portada, el
// índice y la lista de figuras no se generan automáticamente.
#set page(header: page-header(cfg), footer: page-footer(cfg), numbering: "1")
#counter(page).update(1)

${body}
`;

  const buildDir = path.join(root, "build");
  fs.mkdirSync(buildDir, { recursive: true });
  const typPath = path.join(buildDir, "book.typ");
  fs.writeFileSync(typPath, typ, "utf8");
  return { typPath, warnings, chapters: chapterPaths(root, cfg) };
}

function sourceDateEpoch(root) {
  if (process.env.SOURCE_DATE_EPOCH) return process.env.SOURCE_DATE_EPOCH;
  try {
    return execFileSync("git", ["log", "-1", "--format=%ct"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "0";
  }
}


function typstBinary() {
  return process.env.TYPST_PATH || "typst";
}

function runTypst(root, args) {
  return new Promise((resolve) => {
    execFile(
      typstBinary(),
      args,
      {
        cwd: root,
        env: { ...process.env, SOURCE_DATE_EPOCH: sourceDateEpoch(root) },
        maxBuffer: 64 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const clean = String(stderr || "")
          .replace(/\x1b\[[0-9;]*m/g, "")
          .trim();
        resolve({ ok: !error, stdout: String(stdout || ""), stderr: clean, code: error?.code ?? 0 });
      },
    );
  });
}


// --- imágenes: recorte y anotaciones ---------------------------------------

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".svg"]);
const ANNOTATION_TYPES = new Set(["rect", "ellipse", "highlight", "arrow", "pen", "text"]);

function walkFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, acc);
    else acc.push(full);
  }
  return acc;
}

export function imageEditPath(root, rel) {
  return path.join(root, `${rel}.edit.json`);
}

export function readImageEdit(root, rel) {
  const file = imageEditPath(root, rel);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function clamp01(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

function safeColor(value) {
  return /^#[0-9a-f]{3,8}$/i.test(String(value ?? "")) ? value : "#e11d48";
}

function normalizeEdit(edit) {
  const rawCrop = edit?.crop ?? {};
  const crop = {
    x: clamp01(rawCrop.x, 0),
    y: clamp01(rawCrop.y, 0),
    w: Math.min(1, Math.max(0.02, Number(rawCrop.w) || 1)),
    h: Math.min(1, Math.max(0.02, Number(rawCrop.h) || 1)),
  };
  crop.w = Math.min(crop.w, 1 - crop.x);
  crop.h = Math.min(crop.h, 1 - crop.y);

  const annotations = (Array.isArray(edit?.annotations) ? edit.annotations : [])
    .filter((a) => a && ANNOTATION_TYPES.has(a.type))
    .map((a) => ({
      type: a.type,
      color: safeColor(a.color),
      size: Math.min(0.08, Math.max(0.0005, Number(a.size) || 0.004)),
      x: clamp01(a.x),
      y: clamp01(a.y),
      w: clamp01(a.w),
      h: clamp01(a.h),
      x2: clamp01(a.x2),
      y2: clamp01(a.y2),
      points: Array.isArray(a.points)
        ? a.points.slice(0, 500).map((p) => [clamp01(p[0]), clamp01(p[1])])
        : undefined,
      text: typeof a.text === "string" ? a.text.slice(0, 200) : undefined,
    }));

  const full =
    crop.x < 0.0001 && crop.y < 0.0001 && crop.w > 0.9999 && crop.h > 0.9999 && !annotations.length;

  if (full) return null;
  return { version: 1, crop, annotations };
}

export function saveImageEdit(root, rel, edit) {
  const normalized = normalizeEdit(edit);
  const file = imageEditPath(root, rel);
  if (!normalized) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return { ok: true, cleared: true };
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return { ok: true, cleared: false, path: path.relative(root, file) };
}

export function listAssets(root) {
  const dir = path.join(root, "assets");
  return walkFiles(dir)
    .filter((file) => IMAGE_EXT.has(path.extname(file).toLowerCase()))
    .map((file) => {
      const rel = path.relative(root, file).split(path.sep).join("/");
      return { path: rel, name: path.basename(rel), edited: Boolean(readImageEdit(root, rel)) };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

export async function thumbnail(root, rel, width = 96, height = 64) {
  const abs = path.resolve(root, rel);
  const buffer = await sharp(abs)
    .resize(width, height, { fit: "cover" })
    .png()
    .toBuffer();
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

export async function loadImage(root, rel) {
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep)) throw new Error("Ruta fuera del proyecto");
  const meta = await sharp(abs).metadata();
  const ext = path.extname(abs).toLowerCase();
  const mime =
    ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : ext === ".svg" ? "image/svg+xml" : "image/jpeg";
  return {
    path: rel,
    width: meta.width ?? 1200,
    height: meta.height ?? 800,
    mime,
    data: `data:${mime};base64,${fs.readFileSync(abs).toString("base64")}`,
    edit: readImageEdit(root, rel),
  };
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function annotationsSvg(annotations, width, height, crop, fullWidth, fullHeight) {
  const parts = [];
  for (const a of annotations) {
    const color = safeColor(a.color);
    const stroke = Math.max(1, (a.size || 0.004) * fullWidth);
    const x = (a.x - crop.x) * fullWidth;
    const y = (a.y - crop.y) * fullHeight;
    const w = a.w * fullWidth;
    const h = a.h * fullHeight;

    if (a.type === "rect") {
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${color}" stroke-width="${stroke}" rx="${stroke}" />`);
    } else if (a.type === "ellipse") {
      parts.push(`<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${Math.abs(w / 2)}" ry="${Math.abs(h / 2)}" fill="none" stroke="${color}" stroke-width="${stroke}" />`);
    } else if (a.type === "highlight") {
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}" fill-opacity="0.3" />`);
    } else if (a.type === "arrow") {
      const x2 = (a.x2 - crop.x) * fullWidth;
      const y2 = (a.y2 - crop.y) * fullHeight;
      const angle = Math.atan2(y2 - y, x2 - x);
      const head = Math.max(7, stroke * 4);
      const p1x = x2 - head * Math.cos(angle - 0.45);
      const p1y = y2 - head * Math.sin(angle - 0.45);
      const p2x = x2 - head * Math.cos(angle + 0.45);
      const p2y = y2 - head * Math.sin(angle + 0.45);
      parts.push(`<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" />`);
      parts.push(`<polygon points="${x2},${y2} ${p1x},${p1y} ${p2x},${p2y}" fill="${color}" />`);
    } else if (a.type === "pen" && a.points?.length) {
      const pts = a.points
        .map((p) => `${(p[0] - crop.x) * fullWidth},${(p[1] - crop.y) * fullHeight}`)
        .join(" ");
      parts.push(`<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" />`);
    } else if (a.type === "text" && a.text) {
      parts.push(`<text x="${x}" y="${y}" fill="${color}" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="${Math.max(8, (a.size || 0.035) * fullWidth)}">${xmlEscape(a.text)}</text>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`;
}

async function applyImageEdit(originalAbs, outAbs, edit) {
  const meta = await sharp(originalAbs).metadata();
  const W = meta.width ?? 1200;
  const H = meta.height ?? 800;
  const crop = edit.crop ?? { x: 0, y: 0, w: 1, h: 1 };

  const left = Math.min(W - 1, Math.max(0, Math.round(crop.x * W)));
  const top = Math.min(H - 1, Math.max(0, Math.round(crop.y * H)));
  const width = Math.max(1, Math.min(W - left, Math.round(crop.w * W)));
  const height = Math.max(1, Math.min(H - top, Math.round(crop.h * H)));

  let pipeline = sharp(originalAbs).extract({ left, top, width, height });
  if (edit.annotations?.length) {
    pipeline = pipeline.composite([
      { input: Buffer.from(annotationsSvg(edit.annotations, width, height, crop, W, H)) },
    ]);
  }
  await pipeline.png().toFile(outAbs);
}

/** Genera build/derived/*.png para cada imagen con sidecar .edit.json. */
export async function prepareDerivedAssets(root) {
  const dir = path.join(root, "assets");
  const map = new Map();
  if (!fs.existsSync(dir)) return map;

  const derivedDir = path.join(root, "build", "derived");
  for (const file of walkFiles(dir)) {
    if (!file.endsWith(".edit.json")) continue;
    const originalAbs = file.slice(0, -".edit.json".length);
    if (!fs.existsSync(originalAbs)) continue;

    const originalRel = path.relative(root, originalAbs).split(path.sep).join("/");
    const edit = readImageEdit(root, originalRel);
    if (!edit) continue;

    const hash = crypto
      .createHash("sha1")
      .update(originalRel)
      .update(JSON.stringify(edit))
      .digest("hex")
      .slice(0, 12);
    const base = path.basename(originalRel).replace(/\.[^.]+$/, "");
    const outRel = `build/derived/${base}-${hash}.png`;
    const outAbs = path.join(root, outRel);

    if (!fs.existsSync(outAbs)) {
      fs.mkdirSync(derivedDir, { recursive: true });
      await applyImageEdit(originalAbs, outAbs, edit);
    }
    map.set(originalRel, outRel);
  }
  return map;
}

export function typstArgs(root, cfg, { format, output }) {
  const args = [
    "compile",
    "--root",
    root,
    "--font-path",
    path.join(root, "theme", "fonts"),
  ];
  if (format === "svg") {
    args.push("--format", "svg");
  } else if (format === "png") {
    args.push("--format", "png", "--ppi", "144");
  }
  args.push(path.join("build", "book.typ"), output);
  return args;
}

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    for (const entry of fs.readdirSync(dir)) {
      if (entry.endsWith(".svg") || entry.endsWith(".png")) {
        fs.unlinkSync(path.join(dir, entry));
      }
    }
  } else {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function svgSize(file, source = null) {
  const head = (source ?? fs.readFileSync(file, "utf8")).slice(0, 600);
  const w = head.match(/width="([\d.]+)pt"/)?.[1];
  const h = head.match(/height="([\d.]+)pt"/)?.[1];
  return { width: w ? Number(w) : 595.28, height: h ? Number(h) : 841.89 };
}

/** Compila las páginas a SVG para el preview en vivo. */
export async function compilePreview(root, cfg = loadConfig(root), { onPrepared = null } = {}) {
  const started = Date.now();
  const { typPath, warnings } = await writeBook(root, cfg);
  // El índice de bloques se calcula en paralelo con el render SVG: la espera
  // total apenas cambia y el clic sobre el PDF ya encuentra las coordenadas.
  onPrepared?.({ root, typPath, cfg });
  const previewDir = path.join(root, "build", "preview");
  const stagingDir = path.join(root, "build", "preview-staging");
  cleanDir(stagingDir);

  const result = await runTypst(
    root,
    typstArgs(root, cfg, { format: "svg", output: path.join("build", "preview-staging", "page-{p}.svg") }),
  );

  if (!result.ok) {
    cleanDir(stagingDir);
    return {
      ok: false,
      error: result.stderr,
      pages: [],
      ms: Date.now() - started,
      warnings,
      typPath,
    };
  }

  const staged = fs
    .readdirSync(stagingDir)
    .filter((f) => /^page-\d+\.svg$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));

  // Renombrar es atómico y evita copiar cientos de SVG en cada compilación.
  // Como las URLs llevan el hash del contenido, las hojas ya visibles no se
  // vuelven a pedir y las cambiadas usan una URL nueva tras el render.
  fs.mkdirSync(previewDir, { recursive: true });
  const keep = new Set(staged);
  for (const file of staged) {
    const from = path.join(stagingDir, file);
    const to = path.join(previewDir, file);
    try {
      fs.renameSync(from, to);
    } catch {
      // Windows puede bloquear el reemplazo si la imagen está en uso.
      fs.copyFileSync(from, to);
    }
  }
  for (const file of fs.readdirSync(previewDir)) {
    if (/^page-\d+\.svg$/.test(file) && !keep.has(file)) {
      fs.rmSync(path.join(previewDir, file), { force: true });
    }
  }
  cleanDir(stagingDir);

  const pages = staged.map((file, index) => {
    const full = path.join(previewDir, file);
    const svg = fs.readFileSync(full, "utf8");
    return {
      index: index + 1,
      file: full,
      // La URL usa el contenido, no el número de compilación: al escribir solo
      // se vuelven a cargar las hojas que realmente cambiaron.
      hash: crypto.createHash("sha1").update(svg).digest("hex").slice(0, 16),
      ...svgSize(full, svg),
      imageBoxes: svgImageBounds(svg),
    };
  });

  return {
    ok: true,
    pages,
    ms: Date.now() - started,
    warnings,
    typPath,
    error: null,
  };
}

/** Compila el PDF final en dist/<output> o en el destino indicado. */
export async function compilePdf(root, cfg = loadConfig(root), destination = null) {
  const started = Date.now();
  const { typPath, warnings } = await writeBook(root, cfg);
  const distDir = path.join(root, "dist");
  fs.mkdirSync(distDir, { recursive: true });
  const target = path.join(distDir, cfg.output);
  const result = await runTypst(root, typstArgs(root, cfg, { format: "pdf", output: target }));

  if (!result.ok) {
    return { ok: false, error: result.stderr, pages: 0, ms: Date.now() - started, warnings };
  }

  let finalPath = target;
  if (destination) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(target, destination);
    finalPath = destination;
  }

  const pages = pdfPageCount(finalPath);
  return { ok: true, output: finalPath, pages, ms: Date.now() - started, warnings, typPath };
}

function pdfPageCount(file) {
  try {
    const info = execFileSync("pdfinfo", [file], { encoding: "utf8" });
    return Number(info.match(/^Pages:\s+(\d+)/m)?.[1] ?? 0);
  } catch {
    return 0;
  }
}

/** Árbol simple del proyecto para la barra lateral de la app. */
export function projectInfo(root) {
  const cfg = loadConfig(root);
  const chapters = chapterPaths(root, cfg);
  const warnings = [];
  for (const rel of chapters) {
    if (!fs.existsSync(path.join(root, rel))) warnings.push(`Falta el capítulo ${rel}`);
  }
  return {
    root,
    title: cfg.title,
    subtitle: cfg.subtitle,
    output: cfg.output,
    chapters,
    autoChapters: Boolean(cfg.autoChapters),
    readme: fs.existsSync(path.join(root, "README.md")) ? "README.md" : null,
    files: ["book.yaml", "theme/theme.typ", ...chapters],
    warnings,
  };
}
