import fs from "node:fs";
import path from "node:path";
import { chapterPaths } from "./project.mjs";

/** Índice lateral: refleja el texto escrito tras #, sin numerarlo. */
export function buildOutline(root, cfg, file = null) {
  const entries = [];
  const chapters = chapterPaths(root, cfg);
  const sources = file && !chapters.includes(file) ? [file] : chapters;

  for (const rel of sources) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    const lines = fs.readFileSync(abs, "utf8").split("\n");
    let fenced = false;
    let frontmatter = false;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (i === 0 && line.trim() === "---") { frontmatter = true; continue; }
      if (frontmatter) { if (line.trim() === "---") frontmatter = false; continue; }
      if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
      if (fenced) continue;

      const match = line.match(/^(#{1,6})\s+(.+?)\s*$/);
      if (!match) continue;
      const text = match[2].trim();
      if (text) entries.push({ file: rel, line: i + 1, depth: match[1].length, text });
    }
  }
  return entries;
}
