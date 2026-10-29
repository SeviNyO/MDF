#!/usr/bin/env node
// ============================================================================
//  CLI: book.yaml + manuscript/*.md -> build/book.typ -> dist/<output>.pdf
// ============================================================================

import path from "node:path";
import { fileURLToPath } from "node:url";
import { compilePdf, ensureProjectScaffold, loadConfig } from "./core/project.mjs";
import { exportHtml } from "./core/md2html.mjs";
import { exportDocx } from "./core/export-docx.mjs";

const ROOT = process.cwd();
const THEME_SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), "theme");

ensureProjectScaffold(ROOT, THEME_SOURCE);

async function buildOnce({ quiet = false } = {}) {
  const cfg = loadConfig(ROOT);
  const result = await compilePdf(ROOT, cfg);

  if (!result.ok) {
    console.error(result.error || "La compilación falló.");
    process.exitCode = 1;
    return result;
  }

  if (!quiet) {
    for (const warning of result.warnings ?? []) console.warn(`  aviso: ${warning}`);
    console.log(
      `\n  PDF: ${path.relative(ROOT, result.output)}${result.pages ? ` (${result.pages} páginas)` : ""} · ${result.ms} ms`,
    );
    console.log(`  Typst intermedio: build/book.typ\n`);
  }

  const base = result.output.replace(/\.pdf$/i, "");
  if (wantHtml) {
    const html = await exportHtml(ROOT, cfg, `${base}.html`);
    console.log(`  HTML: ${path.relative(ROOT, html.output)} (${(html.bytes / 1e6).toFixed(1)} MB)\n`);
  }
  if (wantDocx) {
    try {
      const docx = await exportDocx(ROOT, cfg, `${base}.docx`);
      console.log(`  Word: ${path.relative(ROOT, docx.output)} (${(docx.bytes / 1e6).toFixed(1)} MB)\n`);
    } catch (error) {
      console.error(`  aviso: ${error.message}\n`);
    }
  }

  return result;
}

const wantHtml = process.argv.includes("--html");
const wantDocx = process.argv.includes("--docx");
const watch = process.argv.includes("--watch");

if (watch) {
  const { watch: chokidarWatch } = await import("chokidar");
  let running = false;
  let pending = false;

  const rebuild = () => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    buildOnce()
      .catch((error) => console.error(`\n  error: ${error.message}\n`))
      .finally(() => {
        running = false;
        if (pending) {
          pending = false;
          rebuild();
        }
      });
  };

  await buildOnce();
  console.log("  observando manuscript/, theme/ y book.yaml (Ctrl+C para salir)\n");
  chokidarWatch(
    ["manuscript", "theme", "book.yaml", "core"].map((p) => path.join(ROOT, p)),
    { ignoreInitial: true },
  ).on("all", rebuild);
} else {
  await buildOnce();
}
