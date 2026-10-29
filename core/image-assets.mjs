import fs from "node:fs";
import path from "node:path";

/** Copia siempre la imagen seleccionada, incluso si está fuera del proyecto. */
export function copyImageToAssets(root, source) {
  if (!root || !source) throw new Error("Selecciona un proyecto y una imagen");
  const ext = path.extname(source).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"].includes(ext) || !fs.statSync(source).isFile()) {
    throw new Error("Selecciona un archivo de imagen válido");
  }
  const dir = path.join(root, "assets");
  fs.mkdirSync(dir, { recursive: true });
  const base = path.basename(source, path.extname(source));
  const stem = base.normalize("NFC").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^[-.]+|[-.]+$/g, "") || "imagen";
  let filename = `${stem}${ext}`;
  for (let i = 2; fs.existsSync(path.join(dir, filename)); i += 1) filename = `${stem}-${i}${ext}`;
  fs.copyFileSync(source, path.join(dir, filename), fs.constants.COPYFILE_EXCL);
  return { rel: `assets/${filename}`, alt: base.replace(/[-_]+/g, " ").trim() || "imagen" };
}
