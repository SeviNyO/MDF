import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const SLUG = /^[a-z0-9][a-z0-9-]{0,49}$/;
export const DEFAULT_DOCUMENT_THEME = "beautiful-pdf";
const BUILTINS = {
  "beautiful-pdf": { label: "Beautiful PDF (Proposal)", description: "Perfil observado en Obsidian · adaptación Typst" },
  academico: { label: "Académico estructurado", description: "Celeste y azul institucional" },
  editorial: { label: "Editorial contemporáneo", description: "Tinta cálida y acentos terracota" },
};

export function ensureThemeLibrary(root, source) {
  const book = path.join(root, "book.yaml");
  const deleted = fs.existsSync(book) ? YAML.parse(fs.readFileSync(book, "utf8"))?.deletedDocumentThemes ?? [] : [];
  for (const folder of ["presets", "templates"]) {
    const from = path.join(source, folder);
    if (!fs.existsSync(from)) continue;
    const to = path.join(root, "theme", folder);
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".typ")) continue;
      if (folder === "presets" && Array.isArray(deleted) && deleted.includes(entry.name.slice(0, -4))) continue;
      const target = path.join(to, entry.name);
      // Nunca sobrescribir un tema modificado por el usuario.
      if (!fs.existsSync(target)) fs.copyFileSync(path.join(from, entry.name), target);
    }
  }
}

export function listDocumentThemes(root) {
  const list = [{ id: "actual", label: "Actual", description: "theme/theme.typ · se conserva sin cambios", kind: "current" }];
  for (const [id, meta] of Object.entries(BUILTINS)) {
    if (fs.statSync(path.join(root, "theme", "presets", `${id}.typ`), { throwIfNoEntry: false })?.isFile()) {
      list.push({ id, ...meta, kind: "preset" });
    }
  }
  const dir = path.join(root, "theme", "custom");
  if (fs.existsSync(dir)) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const slug = entry.name.replace(/\.typ$/, "");
      if (entry.isFile() && entry.name.endsWith(".typ") && SLUG.test(slug)) {
        list.push({ id: `custom:${slug}`, label: slug.replace(/-/g, " "), description: `theme/custom/${entry.name}`, kind: "custom" });
      }
    }
  }
  return list;
}

export function themePath(root, id = "actual") {
  if (id === "actual") return "theme/theme.typ";
  if (Object.hasOwn(BUILTINS, id)) return `theme/presets/${id}.typ`;
  const custom = /^custom:([a-z0-9][a-z0-9-]{0,49})$/.exec(id);
  if (custom) return `theme/custom/${custom[1]}.typ`;
  throw new Error(`Tema de documento no válido: ${id}`);
}

/** Colores seguros del tema Typst para las tablas HTML/GFM de lectura. */
export function tableColors(root, id = DEFAULT_DOCUMENT_THEME) {
  const source = fs.readFileSync(path.join(root, themePath(root, id)), "utf8");
  const palette = source.match(/#let palette\s*=\s*\(([\s\S]*?)\n\)/)?.[1] ?? "";
  const color = (key, fallback) => new RegExp(`\\b${key}:\\s*rgb\\("(#[0-9a-fA-F]{6})"\\)`).exec(palette)?.[1] ?? fallback;
  const accent = color("accent", "#1e3a5f");
  const ink = color("ink", "#202c3b");
  const soft = color("accent-soft", "#eaf0f6");
  const rule = color("rule", "#c9deec");
  return {
    text: ink,
    border: rule,
    header: id === "beautiful-pdf" ? "#0369a1" : soft,
    headerText: id === "beautiful-pdf" ? "#ffffff" : accent,
  };
}

export function selectDocumentTheme(root, id) {
  const rel = themePath(root, id);
  if (!fs.statSync(path.join(root, rel), { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`No existe el tema ${rel}`);
  }
  const file = path.join(root, "book.yaml");
  const doc = YAML.parseDocument(fs.readFileSync(file, "utf8"));
  if (doc.errors.length) throw new Error(`book.yaml: ${doc.errors[0].message}`);
  doc.set("documentTheme", id);
  fs.writeFileSync(file, String(doc), "utf8");
  return id;
}

export function createDocumentTheme(root, name) {
  const slug = String(name ?? "").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!SLUG.test(slug)) throw new Error("Escribe un nombre de tema de 1 a 50 caracteres");
  const source = path.join(root, "theme", "templates", "tema-personalizado.typ");
  if (!fs.existsSync(source)) throw new Error("Falta la plantilla theme/templates/tema-personalizado.typ");
  const directory = path.join(root, "theme", "custom");
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, `${slug}.typ`);
  if (fs.existsSync(target)) throw new Error(`Ya existe el tema ${slug}`);
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  return { id: `custom:${slug}`, path: `theme/custom/${slug}.typ` };
}

/** Solo elimina un tema si el usuario escribe su nombre exacto o su código visible. */
export function deleteDocumentTheme(root, id, confirmation) {
  if (id === "actual") throw new Error("El tema actual está protegido y no se puede borrar");
  const theme = listDocumentThemes(root).find((entry) => entry.id === id);
  if (!theme) throw new Error("No existe ese tema");
  if (confirmation?.trim() !== theme.label && confirmation?.trim() !== id) {
    throw new Error(`Escribe exactamente «${theme.label}» o «${id}»`);
  }
  const rel = themePath(root, id);
  const file = path.join(root, "book.yaml");
  const doc = YAML.parseDocument(fs.readFileSync(file, "utf8"));
  if (doc.errors.length) throw new Error(`book.yaml: ${doc.errors[0].message}`);
  if (Object.hasOwn(BUILTINS, id)) {
    const deleted = doc.get("deletedDocumentThemes", true)?.toJSON?.() ?? [];
    doc.set("deletedDocumentThemes", [...new Set([...deleted, id])]);
  }
  if ((doc.get("documentTheme") ?? DEFAULT_DOCUMENT_THEME) === id) doc.set("documentTheme", "actual");
  // Persistir la selección antes de eliminar el archivo para no dejar el
  // proyecto apuntando al tema eliminado si el archivo estaba activo.
  fs.writeFileSync(file, String(doc), "utf8");
  fs.unlinkSync(path.join(root, rel));
  return { selected: doc.get("documentTheme") ?? DEFAULT_DOCUMENT_THEME, themes: listDocumentThemes(root) };
}
