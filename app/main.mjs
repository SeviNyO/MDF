// ============================================================================
//  Proceso principal de Electron
// ============================================================================

import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, protocol, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chokidar from "chokidar";
import { exec, execFile } from "node:child_process";
import pty from "node-pty";
import { promisify } from "node:util";
import { latexToTypstMath } from "../core/md2typst.mjs";
import { exportHtml } from "../core/md2html.mjs";
import { exportDocx } from "../core/export-docx.mjs";
import {
  compilePdf,
  chapterPaths,
  compilePreview,
  ensureProjectScaffold,
  listAssets,
  loadConfig,
  loadImage,
  projectInfo,
  saveImageEdit,
  thumbnail,
} from "../core/project.mjs";
import { renderChapterHtml } from "../core/md2html.mjs";
import { parsePdfWords } from "../core/pdf-words.mjs";
import { copyImageToAssets } from "../core/image-assets.mjs";
import { buildOutline } from "../core/outline.mjs";
import { resolveShell } from "../core/shell.mjs";
import { DEFAULT_DOCUMENT_THEME, listDocumentThemes, selectDocumentTheme, createDocumentTheme, deleteDocumentTheme, tableColors } from "../core/document-themes.mjs";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

protocol.registerSchemesAsPrivileged([
  {
    scheme: "informe-page",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");

// En Linux empaquetado (AppImage/deb) el sandbox de Chromium no siempre está
// disponible; la app es local y ejecuta comandos del proyecto por diseño.
if (process.platform === "linux" && app.isPackaged) {
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-dev-shm-usage");
}

const typstBin = process.platform === "win32" ? "typst.exe" : "typst";
const bundledTypst = path.join(process.resourcesPath ?? "", typstBin);
if (fs.existsSync(bundledTypst)) process.env.TYPST_PATH = bundledTypst;

let blockCache = { version: -1, blocks: [], pending: null, pendingVersion: -1 };

const state = {
  root: null,
  win: null,
  version: 0,
  compiling: null,
  dirty: false,
  watcher: null,
  ptys: new Map(),
  termOpen: false,
};

// --- utilidades -------------------------------------------------------------

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
  } catch {
    return {};
  }
}

function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2));
}

function isProject(dir) {
  return Boolean(dir) && fs.existsSync(path.join(dir, "book.yaml"));
}

function resolveInProject(rel) {
  const abs = path.resolve(state.root, rel);
  if (abs !== state.root && !abs.startsWith(`${state.root}${path.sep}`)) {
    throw new Error("Ruta fuera del proyecto");
  }
  return abs;
}

function send(channel, payload) {
  if (state.win && !state.win.isDestroyed()) state.win.webContents.send(channel, payload);
}

// --- preparación de carpetas ------------------------------------------------

function scaffold(dir) {
  return ensureProjectScaffold(dir, path.join(__dirname, "..", "theme"));
}

// --- observador de archivos -------------------------------------------------

function watchProject() {
  if (state.watcher) {
    state.watcher.close();
    state.watcher = null;
  }
  if (!state.root) return;

  let timer = null;
  state.watcher = chokidar.watch(state.root, {
    ignoreInitial: true,
    depth: 3,
    ignored: (target) => {
      const rel = path.relative(state.root, target);
      if (!rel) return false;
      if (rel.split(path.sep).some((part) => FS_IGNORED.has(part))) return true;
      return /(^|[\\/])(\.#|~\$)|\.(swp|tmp|~)$/.test(target);
    },
  });
  state.watcher.on("all", () => {
    clearTimeout(timer);
    timer = setTimeout(() => send("fs:changed"), 180);
  });
}

// --- compilación ------------------------------------------------------------

async function runCompile(file = null) {
  if (!state.root) return { ok: false, error: "No hay proyecto abierto", pages: [] };
  if (state.compiling) {
    state.dirty = true;
    return state.compiling;
  }

  state.compiling = (async () => {
    const root = state.root;
    state.version += 1;
    const version = state.version;
    blockCache = { version: -1, blocks: [], pending: null, pendingVersion: -1 };
    const cfg = loadConfig(root);
    const chapters = chapterPaths(root, cfg);
    if (file && !chapters.includes(file)) cfg.chapters = [file];
    const result = await compilePreview(root, cfg, {
      onPrepared: () => {
        if (root === state.root && version === state.version) queueBlockIndex(root, version);
      },
    });
    const pages = result.pages.map((page) => ({
      index: page.index,
      width: page.width,
      height: page.height,
      imageBoxes: page.imageBoxes,
      url: `informe-page://page/${page.index}?h=${page.hash ?? version}`,
    }));
    return { ...result, version, pages };
  })();

  try {
    return await state.compiling;
  } finally {
    state.compiling = null;
    if (state.dirty) {
      state.dirty = false;
      runCompile().catch((error) => console.error("Compilación en cola:", error));
    }
  }
}

// --- git --------------------------------------------------------------------

async function git(args, { allowFail = false } = {}) {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: state.root,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { ok: true, output: stdout };
  } catch (error) {
    if (allowFail) return { ok: false, output: String(error.stdout || error.stderr || "") };
    throw new Error(String(error.stderr || error.message).trim());
  }
}

function parseStatus(raw) {
  const lines = raw.split("\n").filter(Boolean);
  const head = lines.shift() ?? "";
  const branch = head.replace(/^##\s*/, "").split("...")[0] || "(sin rama)";
  const files = lines.map((line) => {
    const index = line[0];
    const worktree = line[1];
    let file = line.slice(3);
    if (file.includes(" -> ")) file = file.split(" -> ").pop();
    return {
      path: file,
      index,
      worktree,
      staged: index !== " " && index !== "?",
      untracked: index === "?" || worktree === "?",
    };
  });
  return { branch, files, aheadBehind: head };
}

// --- explorador de archivos -------------------------------------------------

const FS_IGNORED = new Set([
  "node_modules",
  "build",
  "dist",
  "release",
  "vendor",
  ".git",
  ".obsidian",
  ".cache",
  "__pycache__",
  ".DS_Store",
]);

ipcMain.handle("project:outline", (_event, file = null) => {
  if (!state.root) return [];
  return buildOutline(state.root, loadConfig(state.root), file);
});

ipcMain.handle("fs:list", (_event, rel = "") => {
  const abs = resolveInProject(rel || ".");
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((entry) => !FS_IGNORED.has(entry.name))
    .map((entry) => ({
      name: entry.name,
      path: path.relative(state.root, path.join(abs, entry.name)).split(path.sep).join("/"),
      dir: entry.isDirectory(),
    }))
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
});

ipcMain.handle("fs:createFile", (_event, rel) => {
  const abs = resolveInProject(rel);
  if (fs.existsSync(abs)) throw new Error("Ya existe ese archivo o carpeta");
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, "", "utf8");
  return { path: rel };
});

ipcMain.handle("fs:createFolder", (_event, rel) => {
  const abs = resolveInProject(rel);
  if (fs.existsSync(abs)) throw new Error("Ya existe ese archivo o carpeta");
  fs.mkdirSync(abs, { recursive: true });
  return { path: rel };
});

function uniqueTarget(dirAbs, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let candidate = path.join(dirAbs, name);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dirAbs, `${base} (${index})${ext}`);
    index += 1;
  }
  return candidate;
}

function importInto(root, relDir, sources) {
  if (!root) throw new Error("No hay carpeta abierta");
  const dirAbs = path.resolve(root, relDir || ".");
  if (dirAbs !== root && !dirAbs.startsWith(`${root}${path.sep}`)) {
    throw new Error("Ruta fuera del proyecto");
  }
  fs.mkdirSync(dirAbs, { recursive: true });

  const added = [];
  const skipped = [];
  for (const source of sources) {
    try {
      if (path.resolve(source) === dirAbs) {
        skipped.push(source);
        continue;
      }
      const stat = fs.statSync(source);
      const target = uniqueTarget(dirAbs, path.basename(source));
      if (stat.isDirectory()) fs.cpSync(source, target, { recursive: true });
      else fs.copyFileSync(source, target);
      added.push(path.relative(root, target).split(path.sep).join("/"));
    } catch {
      skipped.push(source);
    }
  }
  return { added, skipped };
}

ipcMain.handle("fs:import", async (_event, relDir = "") => {
  const result = await dialog.showOpenDialog(state.win, {
    title: "Agregar archivos a la carpeta",
    buttonLabel: "Agregar",
    properties: ["openFile", "multiSelections"],
  });
  if (result.canceled || !result.filePaths.length) return { added: [], skipped: [] };
  return importInto(state.root, relDir, result.filePaths);
});

ipcMain.handle("fs:importPaths", (_event, sources, relDir = "") => {
  if (!Array.isArray(sources) || !sources.length) return { added: [], skipped: [] };
  return importInto(
    state.root,
    relDir,
    sources.filter((entry) => typeof entry === "string" && entry.trim()),
  );
});

ipcMain.handle("fs:delete", (_event, rel) => {
  const abs = resolveInProject(rel);
  if (abs === state.root) throw new Error("No se puede eliminar la raíz del proyecto");
  if (String(rel).split("/").some((part) => FS_IGNORED.has(part))) {
    throw new Error("Esa carpeta está protegida");
  }
  fs.rmSync(abs, { recursive: true, force: false });
  return true;
});

ipcMain.handle("fs:openFolder", async (_event, rel = "") => {
  const abs = resolveInProject(rel || ".");
  return shell.openPath(abs);
});

// --- terminal ---------------------------------------------------------------

function stopTerminal(id) {
  const terminal = state.ptys.get(id);
  if (!terminal) return false;
  try {
    terminal.kill("SIGHUP");
  } catch {
    // ya terminó
  }
  state.ptys.delete(id);
  return true;
}

function stopAllTerminals() {
  for (const id of [...state.ptys.keys()]) stopTerminal(id);
}

function startTerminal(id, cols = 80, rows = 24) {
  if (!id) return false;
  stopTerminal(id);
  if (!state.root) return false;

  const shellPath = resolveShell();
  let terminal;
  try {
    terminal = pty.spawn(shellPath, [], {
      name: "xterm-256color",
      cols: Math.max(20, Number(cols) || 80),
      rows: Math.max(5, Number(rows) || 24),
      cwd: state.root,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
      },
    });
  } catch (error) {
    throw new Error(`No se pudo iniciar la terminal (${shellPath}): ${error.message}`);
  }

  state.ptys.set(id, terminal);
  terminal.onData((data) => send("term:data", { id, data }));
  terminal.onExit(() => {
    if (state.ptys.get(id) !== terminal) return;
    state.ptys.delete(id);
    send("term:exit", { id });
  });

  return true;
}

// --- búsqueda en el proyecto ------------------------------------------------

function searchProject(query) {
  const needle = String(query ?? "").trim().toLowerCase();
  if (needle.length < 2 || !state.root) return [];

  const cfg = loadConfig(state.root);
  const results = [];

  for (const rel of chapterPaths(state.root, cfg)) {
    const file = path.join(state.root, rel);
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (results.length >= 120) return;
      if (line.toLowerCase().includes(needle)) {
        results.push({ src: rel, line: index + 1, text: line.trim().slice(0, 180) });
      }
    });
  }
  return results;
}

// --- ventana ----------------------------------------------------------------

function createWindow() {
  const win = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: "#eef1f5",
    show: true,
    autoHideMenuBar: true,
    title: "MDF — Markdown a PDF",
    icon: path.join(__dirname, "renderer", "assets", "logo-mark.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  state.win = win;
  win.webContents.on("console-message", (_event, level, message) => {
    if (level >= 2) console.error("[renderer]", message);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    console.error("[renderer gone]", details.reason, details.exitCode);
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));

  // Captura automática para verificación visual en desarrollo.
  if (process.env.SHOT_PATH) {
    win.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        try {
          if (process.env.SHOT_JS) {
            await win.webContents.executeJavaScript(process.env.SHOT_JS).catch(() => {});
            await new Promise((resolve) => setTimeout(resolve, 2200));
          }
          const image = await win.webContents.capturePage();
          fs.writeFileSync(process.env.SHOT_PATH, image.toPNG());
          console.log(`captura: ${process.env.SHOT_PATH}`);
        } catch (error) {
          console.error(error);
        } finally {
          app.quit();
        }
      }, Number(process.env.SHOT_DELAY ?? 3500));
    });
  }

  win.on("closed", () => {
    state.win = null;
  });
}

// --- páginas del preview bajo demanda ----------------------------------------

function registerPageProtocol() {
  protocol.handle("informe-page", async (request) => {
    try {
      if (!state.root) return new Response("Sin proyecto", { status: 404 });
      const url = new URL(request.url);
      const index = Number(url.pathname.replace(/^\/+/, "").replace(/\.svg$/i, ""));
      if (!Number.isFinite(index) || index < 1) {
        return new Response("Página no válida", { status: 400 });
      }
      const file = path.join(state.root, "build", "preview", `page-${index}.svg`);
      const raw = await fs.promises.readFile(file, "utf8");
      // Typst deja los & de las URLs sin escapar en el SVG; eso invalida el XML
      // y Chromium descarta la página completa. Los escapamos al servirla.
      const svg = raw.replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]+|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;");
      // El hash de la URL identifica el contenido exacto de la hoja: podemos
      // reutilizar la imagen ya decodificada al volver a una página.
      const immutable = Boolean(url.searchParams.get("h"));
      return new Response(svg, {
        headers: {
          "content-type": "image/svg+xml; charset=utf-8",
          "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-store",
        },
      });
    } catch {
      return new Response("No encontrada", { status: 404 });
    }
  });
}

// --- índice de bloques -------------------------------------------------------

const BLOCK_INDEX_CODE = `{
  let heads = query(heading).map(h => (
    page: h.location().page(),
    x: h.location().position().x,
    y: h.location().position().y,
    level: h.level,
  ));
  let metas = query(metadata).map(m => (
    v: m.value,
    page: m.location().page(),
    x: m.location().position().x,
    y: m.location().position().y,
  ));
  (heads: heads, metas: metas)
}`;

async function buildBlockIndex(root, version) {
  if (!root || !fs.existsSync(path.join(root, "build", "book.typ"))) return [];
  const { stdout } = await execFileAsync(
    process.env.TYPST_PATH || "typst",
    [
      "eval",
      "--root",
      root,
      "--font-path",
      path.join(root, "theme", "fonts"),
      "--in",
      path.join("build", "book.typ"),
      BLOCK_INDEX_CODE,
    ],
    { cwd: root, maxBuffer: 32 * 1024 * 1024 },
  );

  const data = JSON.parse(stdout);
  const headings = data.heads ?? [];
  const usedHeadings = new Set();
  const bySlot = new Map();
  headings.forEach((candidate, index) => {
    const key = `${Number(candidate.page)}:${Number(candidate.level)}`;
    if (!bySlot.has(key)) bySlot.set(key, []);
    bySlot.get(key).push({ candidate, index });
  });
  for (const list of bySlot.values()) {
    list.sort((a, b) => parseFloat(b.candidate.y) - parseFloat(a.candidate.y));
  }

  const blocks = (data.metas ?? []).map((entry) => {
    const base = {
      src: entry.v?.src ?? "",
      line: Number(entry.v?.line ?? 0),
      kind: entry.v?.kind ?? "",
      level: Number(entry.v?.level ?? 0),
      img: entry.v?.img ?? "",
      page: Number(entry.page ?? 0),
      x: parseFloat(entry.x ?? "0"),
      y: parseFloat(entry.y ?? "0"),
    };
    if (base.kind === "heading" && headings.length) {
      // Un índice global se desfasaba con los títulos de portada/índice
      // generados por el tema. Emparejamos por página, nivel y proximidad al
      // metadato de este título (situado inmediatamente después de él).
      const slot = bySlot.get(`${base.page}:${base.level}`) ?? [];
      let best = null;
      for (const item of slot) {
        if (usedHeadings.has(item.index)) continue;
        if (parseFloat(item.candidate.y) > base.y + 3) continue;
        if (!best || Math.abs(base.y - parseFloat(item.candidate.y)) < Math.abs(base.y - parseFloat(best.candidate.y))) {
          best = item;
        }
      }
      if (best) {
        usedHeadings.add(best.index);
        base.x = parseFloat(best.candidate.x ?? base.x);
        base.y = parseFloat(best.candidate.y ?? base.y);
      }
    }
    return base;
  });

  if (root === state.root && version === state.version) {
    blockCache = { version, blocks, pending: null, pendingVersion: -1 };
  }
  return blocks;
}

/** Lanza el índice a la vez que el render SVG; el clic en el PDF llega antes. */
function queueBlockIndex(root, version) {
  if (blockCache.pending && blockCache.pendingVersion === version) return blockCache.pending;
  const task = buildBlockIndex(root, version).catch((error) => {
    console.error("Índice de bloques:", error.message);
    return [];
  });
  blockCache = { version: -1, blocks: [], pending: task, pendingVersion: version };
  task.then(() => {
    if (blockCache.pending === task) {
      blockCache = { version: -1, blocks: [], pending: null, pendingVersion: -1 };
    }
  });
  return task;
}

// --- IPC --------------------------------------------------------------------

function registerIpc() {
  ipcMain.handle("prefs:get", () => readSettings());

  ipcMain.handle("prefs:set", (_event, patch) => {
    writeSettings(patch ?? {});
    return true;
  });

  ipcMain.handle("app:edit", (_event, action) => {
    const contents = state.win?.webContents;
    const method = {
      undo: "undo",
      redo: "redo",
      cut: "cut",
      copy: "copy",
      paste: "paste",
      "select-all": "selectAll",
    }[action];
    if (!contents || !method) return false;
    contents[method]();
    return true;
  });

  ipcMain.handle("app:quit", () => {
    app.quit();
    return true;
  });

  ipcMain.handle("app:about", async () => {
    await dialog.showMessageBox(state.win, {
      type: "info",
      title: "MDF",
      message: `MDF ${app.getVersion()}`,
      detail: "Editor de Markdown con vista A4 paginada, modo lectura y exportación a PDF, HTML y DOCX.",
    });
    return true;
  });

  ipcMain.handle("app:toggleDevTools", () => {
    state.win?.webContents.toggleDevTools();
    return true;
  });

  ipcMain.handle("project:open", async () => {
    const result = await dialog.showOpenDialog(state.win, {
      title: "Abrir carpeta",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const dir = result.filePaths[0];
    state.root = dir;
    // El índice de coordenadas pertenece al proyecto anterior: invalidarlo
    // evita devolver bloques de otro libro antes de la primera compilación.
    state.version += 1;
    blockCache = { version: -1, blocks: [], pending: null, pendingVersion: -1 };
    const created = scaffold(dir);
    writeSettings({ lastProject: dir });
    watchProject();
    return { ...projectInfo(dir), created };
  });

  ipcMain.handle("project:info", () => {
    if (!state.root) return null;
    return projectInfo(state.root);
  });

  ipcMain.handle("project:themes", () => {
    if (!state.root) return { selected: DEFAULT_DOCUMENT_THEME, themes: [] };
    const selected = loadConfig(state.root).documentTheme ?? DEFAULT_DOCUMENT_THEME;
    return { selected, themes: listDocumentThemes(state.root), tableColors: tableColors(state.root, selected) };
  });

  ipcMain.handle("project:theme-select", (_event, id) => {
    if (!state.root) throw new Error("Abre un proyecto primero");
    selectDocumentTheme(state.root, id);
    return { selected: id, themes: listDocumentThemes(state.root) };
  });

  ipcMain.handle("project:theme-create", (_event, name) => {
    if (!state.root) throw new Error("Abre un proyecto primero");
    const created = createDocumentTheme(state.root, name);
    selectDocumentTheme(state.root, created.id);
    return created;
  });

  ipcMain.handle("project:theme-delete", (_event, id, confirmation) => {
    if (!state.root) throw new Error("Abre un proyecto primero");
    return deleteDocumentTheme(state.root, id, confirmation);
  });

  ipcMain.handle("file:read", (_event, rel) => {
    const abs = resolveInProject(rel);
    return { path: rel, content: fs.readFileSync(abs, "utf8") };
  });

  ipcMain.handle("file:write", (_event, rel, content) => {
    const abs = resolveInProject(rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
    return { ok: true };
  });

  ipcMain.handle("preview:compile", async (_event, file = null) => {
    try {
      return await runCompile(file);
    } catch (error) {
      return { ok: false, error: error.message, pages: [] };
    }
  });

  ipcMain.handle("doc:render", async (_event, rel) => {
    if (!state.root || !rel) return "";
    return renderChapterHtml(state.root, loadConfig(state.root), rel);
  });

  ipcMain.handle("assets:list", () => listAssets(state.root));

  ipcMain.handle("assets:thumb", async (_event, rel) => {
    try {
      return await thumbnail(state.root, rel);
    } catch {
      return null;
    }
  });

  ipcMain.handle("image:pick", async () => {
    const result = await dialog.showOpenDialog(state.win, {
      title: "Insertar imagen",
      properties: ["openFile"],
      filters: [
        { name: "Imágenes", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return copyImageToAssets(state.root, result.filePaths[0]);
  });

  ipcMain.handle("image:load", async (_event, rel) => loadImage(state.root, rel));

  ipcMain.handle("image:save", async (_event, rel, edit) => saveImageEdit(state.root, rel, edit));

  ipcMain.handle("preview:blocks", async () => {
    if (!state.root) return { version: state.version, blocks: [] };
    if (blockCache.version === state.version) return { version: state.version, blocks: blockCache.blocks };
    if (blockCache.pending && blockCache.pendingVersion === state.version) {
      return { version: state.version, blocks: await blockCache.pending };
    }
    const version = state.version;
    return { version, blocks: await buildBlockIndex(state.root, version) };
  });

  let wordCache = { version: -1, words: [], pending: null, pendingVersion: -1 };
  const wordsInRange = (words, range) => {
    if (!range) return words;
    const from = Math.max(1, Number(range.from) || 1);
    const to = Math.max(from, Number(range.to) || from);
    return words.filter((word) => word.page >= from && word.page <= to);
  };
  ipcMain.handle("preview:words", async (_event, range = null) => {
    if (!state.root) return [];
    if (wordCache.version === state.version) return wordsInRange(wordCache.words, range);
    if (wordCache.pending && wordCache.pendingVersion === state.version) {
      return wordsInRange(await wordCache.pending, range);
    }
    const root = state.root;
    const version = state.version;
    const task = (async () => {
      const pdf = path.join(root, "build", `preview-text-${version}.pdf`);
      let words;
      try {
        await execFileAsync(process.env.TYPST_PATH || "typst", [
          "compile", "--root", root, "--font-path", path.join(root, "theme", "fonts"),
          path.join(root, "build", "book.typ"), pdf,
        ], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
        const { stdout } = await execFileAsync("pdftotext", ["-bbox", "-enc", "UTF-8", pdf, "-"],
          { cwd: root, maxBuffer: 64 * 1024 * 1024 });
        words = parsePdfWords(stdout);
      } finally {
        fs.rmSync(pdf, { force: true });
      }
      if (root === state.root && version === state.version) wordCache = { version, words, pending: null, pendingVersion: -1 };
      return root === state.root && version === state.version ? words : [];
    })();
    wordCache.pending = task;
    wordCache.pendingVersion = version;
    try { return wordsInRange(await task, range); } finally {
      if (wordCache.pending === task) wordCache.pending = null;
    }
  });

  ipcMain.handle("term:start", (_event, id, cols, rows) => {
    state.termOpen = true;
    return startTerminal(id, cols, rows);
  });

  ipcMain.handle("term:restart", (_event, id, cols, rows) => startTerminal(id, cols, rows));

  ipcMain.handle("term:close", (_event, id) => stopTerminal(id));

  ipcMain.on("term:input", (_event, id, data) => {
    state.ptys.get(id)?.write(String(data));
  });

  ipcMain.on("term:resize", (_event, id, cols, rows) => {
    try {
      state.ptys.get(id)?.resize(Math.max(20, Number(cols) || 80), Math.max(5, Number(rows) || 24));
    } catch {
      // el proceso pudo terminar
    }
  });

  ipcMain.handle("search:query", (_event, query) => searchProject(query));

  ipcMain.handle("search:replace", (_event, query, replacement) => {
    const needle = String(query ?? "");
    if (needle.length < 2) return { count: 0, files: [] };

    const cfg = loadConfig(state.root);
    let count = 0;
    const files = [];

    for (const rel of chapterPaths(state.root, cfg)) {
      const file = path.join(state.root, rel);
      if (!fs.existsSync(file)) continue;
      const content = fs.readFileSync(file, "utf8");
      const parts = content.split(needle);
      if (parts.length === 1) continue;
      count += parts.length - 1;
      files.push(rel);
      fs.writeFileSync(file, parts.join(String(replacement ?? "")), "utf8");
    }
    return { count, files };
  });

  ipcMain.handle("formula:preview", async (_event, latex, display) => {
    if (!state.root) return { ok: false, error: "Sin proyecto" };
    const math = latexToTypstMath(String(latex ?? ""));
    const body = display ? `$ ${math} $` : `$${math}$`;
    const doc = `#set page(width: auto, height: auto, margin: 10pt)\n#set text(font: "Source Serif 4", size: 12pt)\n${body}\n`;

    const dir = path.join(state.root, "build");
    fs.mkdirSync(dir, { recursive: true });
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const relTyp = `build/formula-${stamp}.typ`;
    const relSvg = `build/formula-${stamp}.svg`;
    const typPath = path.join(state.root, relTyp);
    const svgPath = path.join(state.root, relSvg);
    fs.writeFileSync(typPath, doc, "utf8");

    try {
      await execFileAsync(
        process.env.TYPST_PATH || "typst",
        [
          "compile",
          "--root",
          state.root,
          "--font-path",
          path.join(state.root, "theme", "fonts"),
          "--format",
          "svg",
          relTyp,
          relSvg,
        ],
        { cwd: state.root },
      );
      const svg = fs.readFileSync(svgPath, "utf8");
      return { ok: true, svg };
    } catch (error) {
      return { ok: false, error: String(error.stderr || error.message) };
    } finally {
      fs.rmSync(typPath, { force: true });
      fs.rmSync(svgPath, { force: true });
    }
  });

  ipcMain.handle("export:html", async () => {
    const cfg = loadConfig(state.root);
    const target = await dialog.showSaveDialog(state.win, {
      title: "Exportar HTML",
      defaultPath: path.join(state.root, "dist", cfg.output.replace(/\.pdf$/i, ".html")),
      filters: [{ name: "HTML", extensions: ["html"] }],
    });
    if (target.canceled || !target.filePath) return null;
    try {
      const result = await exportHtml(state.root, cfg, target.filePath);
      return { ok: true, output: result.output };
    } catch (error) {
      return { ok: false, error: String(error.message ?? error) };
    }
  });

  ipcMain.handle("export:docx", async () => {
    const cfg = loadConfig(state.root);
    const target = await dialog.showSaveDialog(state.win, {
      title: "Exportar Word",
      defaultPath: path.join(state.root, "dist", cfg.output.replace(/\.pdf$/i, ".docx")),
      filters: [{ name: "Word", extensions: ["docx"] }],
    });
    if (target.canceled || !target.filePath) return null;
    try {
      const result = await exportDocx(state.root, cfg, target.filePath);
      return { ok: true, output: result.output };
    } catch (error) {
      return { ok: false, error: String(error.message ?? error) };
    }
  });

  ipcMain.handle("pdf:export", async (_event, file = null) => {
    const cfg = loadConfig(state.root);
    const chapters = chapterPaths(state.root, cfg);
    if (file && !chapters.includes(file)) cfg.chapters = [file];
    const result = await dialog.showSaveDialog(state.win, {
      title: "Exportar PDF",
      defaultPath: path.join(state.root, "dist", cfg.output),
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (result.canceled || !result.filePath) return null;
    return compilePdf(state.root, cfg, result.filePath);
  });

  ipcMain.handle("clipboard:write", (_event, text) => {
    clipboard.writeText(String(text ?? ""));
    return true;
  });

  ipcMain.handle("app:openPath", async (_event, target) => {
    return shell.openPath(target);
  });

  ipcMain.handle("app:showItem", (_event, target) => {
    shell.showItemInFolder(target);
    return true;
  });

  ipcMain.handle("git:status", async () => {
    const { ok, output } = await git(["status", "--porcelain=v1", "-b"], { allowFail: true });
    if (!ok) return { repo: false, branch: "", files: [] };
    return { repo: true, ...parseStatus(output) };
  });

  ipcMain.handle("git:diff", async (_event, file, staged) => {
    const args = ["diff"];
    if (staged) args.push("--cached");
    args.push("--", file);
    const { output } = await git(args, { allowFail: true });
    if (output.trim()) return output;
    const head = await git(["diff", "HEAD", "--", file], { allowFail: true });
    return head.output;
  });

  ipcMain.handle("git:add", async (_event, file) => {
    await git(["add", "--", file]);
    return true;
  });

  ipcMain.handle("git:unstage", async (_event, file) => {
    await git(["restore", "--staged", "--", file], { allowFail: true });
    return true;
  });

  ipcMain.handle("git:commit", async (_event, message) => {
    const { output } = await git(["commit", "-m", message], { allowFail: true });
    return { ok: true, output };
  });

  ipcMain.handle("git:log", async () => {
    const { output } = await git(["log", "--pretty=format:%h%x09%an%x09%ar%x09%s", "-n", "25"], {
      allowFail: true,
    });
    return output
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, author, when, ...subject] = line.split("\t");
        return { hash, author, when, subject: subject.join(" ") };
      });
  });

  ipcMain.handle("git:branches", async () => {
    const { output } = await git(["branch", "--format=%(refname:short)"], { allowFail: true });
    const current = await git(["branch", "--show-current"], { allowFail: true });
    return { current: current.output.trim(), branches: output.split("\n").filter(Boolean) };
  });

  ipcMain.handle("git:checkout", async (_event, branch) => {
    const { ok, output } = await git(["checkout", branch], { allowFail: true });
    return { ok, output };
  });

  ipcMain.handle("cmd:run", async (_event, command) => {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: state.root,
        shell: resolveShell(),
        timeout: 120000,
        maxBuffer: 16 * 1024 * 1024,
      });
      return { ok: true, output: `${stdout}${stderr}` };
    } catch (error) {
      return {
        ok: false,
        output: `${error.stdout ?? ""}${error.stderr ?? ""}${error.message}`,
      };
    }
  });
}

// --- arranque ---------------------------------------------------------------

// --- menú -------------------------------------------------------------------

async function boot() {
  registerIpc();
  registerPageProtocol();
  // El menú vive en la barra superior HTML. En Windows/Linux no debe aparecer
  // la barra nativa con Archivo/Editar/Ver/Ayuda.
  Menu.setApplicationMenu(null);

  const settings = readSettings();
  const candidate =
    process.env.INFORME_PROJECT ||
    settings.lastProject ||
    (isProject(process.cwd()) ? process.cwd() : "");
  if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
    state.root = candidate;
    scaffold(candidate);
    watchProject();
  }

  createWindow();
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (state.win && !state.win.isDestroyed()) {
      if (state.win.isMinimized()) state.win.restore();
      state.win.show();
      state.win.focus();
    }
  });
  app.whenReady().then(boot);
}

app.on("window-all-closed", () => {
  stopAllTerminals();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", stopAllTerminals);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
