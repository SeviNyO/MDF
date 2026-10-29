import { createEditor } from "./vendor/editor.js";
import {
  findImageAttrs,
  openConfirm,
  openModal,
  closeModal,
  openFormulaEditor,
  openImageEditor,
  openHtmlImageEditor,
  openInsertTable,
  openPrompt,
  findTables,
  tableAtLine,
  openTableEditor,
  setImageAttrs,
} from "./editors.js";
import { getStyle, openContextMenu, setStyle } from "./style-clipboard.js";
import { createTerminal } from "./vendor/terminal.js";
import { findPdfPhrase } from "../../core/pdf-words.mjs";
import { centerParagraphAt } from "../../core/paragraph-align.mjs";
import { formatInlineSelection } from "../../core/inline-format.mjs";
import { normalizeTableAlign, setHtmlTableAlign } from "../../core/table-align.mjs";
import { imageMarkupHtml } from "../../core/image-markup.mjs";

const api = window.api;
const el = (id) => document.getElementById(id);
document.body.classList.add(`platform-${api.platform}`);
let lastMouseSelection = null;

const state = {
  info: null,
  file: null,
  loading: false,
  saveTimer: null,
  compileTimer: null,
  pages: 0,
  dirty: false,
  editRevision: 0,
  blocksCache: null,
  blocksTask: null,
  lastPdf: null,
  selectedGitFile: null,
  selectedGitStaged: false,
  history: [],
  historyIndex: -1,
  searchResults: [],
  searchIndex: -1,
  searchQuery: "",
  selectedPath: null,
  selectedDir: "",
  expandedDirs: new Set(),
  sidebarTab: "files",
  sidebarWidth: 224,
  sidebarCollapsed: false,
  outline: [],
  outlineActive: "",
  suppressCursorUntil: 0,
  cursorTimer: null,
  zoom: 1,
  dark: localStorage.getItem("informe.dark") !== "0",
  viewMode: "code",
  documentMode: "delivery",
  readEdit: false,
  saveLabel: "",
  pageLayout: [],
  gitDirty: 0,
  gitAhead: 0,
  gitBehind: 0,
};

const editor = createEditor({
  parent: el("editor"),
  doc: "",
  onChange: () => {
    if (state.loading) return;
    lastMouseSelection = null;
    state.dirty = true;
    state.editRevision += 1;
    setSaveState("sin guardar");
    scheduleSave();
    if (state.documentMode === "focus") scheduleCursorSync(editor.getCursorLine());
    queueSlashUpdate();
  },
  onCursorLine: (line) => {
    scheduleCursorSync(line);
    queueSlashUpdate();
  },
});

// --- menú / (comandos rápidos) ---------------------------------------------

const SLASH_ICONS = {
  table: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 4.5v15M14.5 4.5v15"/>',
  "table-title": '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 4.5v15M14.5 4.5v15"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M4.5 17l4.5-4 3 2.7 3-2.2 4.5 4"/>',
  link: '<path d="M10 13a4 4 0 0 0 5.66 0l2.34-2.34a4 4 0 0 0-5.66-5.66L11 6.34"/><path d="M14 11a4 4 0 0 0-5.66 0L6 13.34a4 4 0 0 0 5.66 5.66L13 17.66"/>',
  formula: '<path d="M18 6H7l5 6-5 6h11"/>',
  callout: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  pagebreak: '<path d="M6 3h8l4 4v6"/><path d="M14 3v5h4"/><path d="M12 12v7M9 16l3 3 3-3"/><path d="M4 21h16"/>',
  heading: '<path d="M6 6v12M18 6v12M6 12h12"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/><circle cx="4.5" cy="18" r="1.2"/>',
};

const SLASH_ITEMS = [
  { id: "text", icon: "list", label: "Texto", hint: "Párrafo Markdown", block: true, build: () => ({ text: "Escribe aquí", selectText: "Escribe aquí" }) },
  ...[1, 2, 3, 4].map((level) => ({ id: `h${level}`, icon: "heading", label: `Encabezado H${level}`, hint: `${"#".repeat(level)} Título`, block: true,
    build: () => ({ text: `${"#".repeat(level)} Título`, selectText: "Título" }) })),
  { id: "pagebreak", icon: "pagebreak", label: "Página", hint: "Salto de página (comentario HTML)", block: true,
    build: () => "<!-- pdf-pagebreak -->" },
  { id: "bullets", icon: "list", label: "Lista con viñetas", hint: "- Elemento", block: true,
    build: () => ({ text: "- Elemento", selectText: "Elemento" }) },
  { id: "numbers", icon: "list", label: "Lista numerada", hint: "1. Elemento", block: true,
    build: () => ({ text: "1. Elemento", selectText: "Elemento" }) },
  { id: "tasks", icon: "list", label: "Lista de tareas", hint: "- [ ] Tarea", block: true,
    build: () => ({ text: "- [ ] Tarea", selectText: "Tarea" }) },
  { id: "codeblock", icon: "formula", label: "Código", hint: "Bloque de código delimitado", block: true,
    build: () => ({ text: "```\nCódigo\n```", selectText: "Código" }) },
  { id: "quote", icon: "callout", label: "Cita", hint: "> Texto", block: true,
    build: () => ({ text: "> Texto", selectText: "Texto" }) },
  { id: "callout", icon: "callout", label: "Destacado", hint: "Cita con título en Markdown", block: true,
    build: () => ({ text: "> **Nota:** Texto destacado", selectText: "Texto destacado" }) },
  { id: "mathblock", icon: "formula", label: "Ecuación en bloque", hint: "$$…$$ (GitHub)", block: true,
    build: () => ({ text: "$$\nEcuación\n$$", selectText: "Ecuación" }) },
  { id: "image", label: "Imagen", hint: "Copiar archivo a assets/", block: false, image: true },
  {
    id: "table",
    label: "Tabla",
    hint: "Tabla Markdown (compatible con GitHub)",
    block: true,
    build: () =>
      '| Columna 1 | Columna 2 | Columna 3 |\n|:---|:---|:---|\n|  |  |  |',
  },
  {
    id: "link",
    label: "Enlace",
    hint: "Texto con enlace",
    block: false,
    build: () => ({ text: "[texto](https://)", select: [1, 6] }),
  },
  {
    id: "formula",
    label: "Ecuación",
    hint: "Fórmula LaTeX",
    block: false,
    build: () => ({ text: "$ $", select: [1, 2] }),
  },
];

const slash = { open: false, items: SLASH_ITEMS, index: 0, from: 0, to: 0, lineBefore: "" };
const tableSnapshots = new WeakMap();
const slashMenu = document.createElement("div");
slashMenu.className = "slash-menu hidden";
document.body.append(slashMenu);

function queueSlashUpdate() {
  requestAnimationFrame(updateSlashMenu);
}

function hideSlash() {
  slash.open = false;
  slashMenu.classList.add("hidden");
}

function normalizeText(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function renderSlashMenu() {
  slashMenu.innerHTML = "";
  slash.items.forEach((item, index) => {
    const button = document.createElement("button");
    button.className = `slash-item${index === slash.index ? " active" : ""}`;
    button.type = "button";
    button.innerHTML = `<span class="slash-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${SLASH_ICONS[item.icon ?? item.id] ?? ""}</svg></span><span class="slash-copy"><span class="slash-label">${item.label}</span><span class="slash-hint">${item.hint}</span></span>`;
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => chooseSlash(item));
    slashMenu.append(button);
  });
  slashMenu.querySelector(".slash-item.active")?.scrollIntoView({ block: "nearest" });
}

function updateSlashMenu() {
  if (state.viewMode !== "code" || !state.file) return hideSlash();
  const selection = editor.getSelectionInfo();
  if (selection.from !== selection.to) return hideSlash();

  const info = editor.getCursorInfo();
  const before = info.text.slice(0, info.ch);
  const match = before.match(/(^|\s)\/([^\s/]*)$/);
  if (!match) return hideSlash();

  const query = normalizeText(match[2]);
  const items = SLASH_ITEMS.filter((item) => {
    const haystack = normalizeText(`${item.label} ${item.hint}`);
    return !query || haystack.includes(query) || (item.id === "mathblock" && query.includes("mat"));
  });
  if (!items.length) return hideSlash();

  const slashIndex = before.lastIndexOf("/");
  slash.items = items;
  slash.index = Math.min(slash.index, items.length - 1);
  slash.from = info.from + slashIndex;
  slash.to = info.pos;
  slash.lineBefore = before.slice(0, slashIndex);
  slash.open = true;

  renderSlashMenu();
  slashMenu.classList.remove("hidden");

  const coords = editor.coordsAt(info.pos);
  if (!coords) return hideSlash();
  const width = 270;
  const left = Math.min(Math.max(8, coords.left), window.innerWidth - width - 8);
  const menuHeight = slashMenu.offsetHeight || 280;
  const top = coords.bottom + menuHeight + 10 > window.innerHeight ? coords.top - menuHeight - 6 : coords.bottom + 6;
  slashMenu.style.width = `${width}px`;
  slashMenu.style.left = `${left}px`;
  slashMenu.style.top = `${Math.max(8, top)}px`;
}

async function chooseSlash(item) {
  const { from, to, lineBefore } = slash;
  const atLineStart = lineBefore.trim() === "";
  hideSlash();
  slash.index = 0;

  if (item.image) {
    try {
      const picked = await api.pickImage();
      if (!picked) return;
      if (!picked.rel.startsWith("assets/")) throw new Error("La imagen no se copió a assets/");
      editor.replaceRange(from, to, imageMarkupHtml(picked.rel, picked.alt));
      await saveNow();
      setStatus(`Imagen copiada a ${picked.rel}`, "ok");
    } catch (error) { setStatus(String(error.message ?? error), "bad"); }
    return;
  }

  const result = item.build();
  const built = typeof result === "string" ? { text: result } : result;
  let text = built.text;
  if (item.block) {
    if (!atLineStart) text = `\n\n${text}`;
    if (!text.endsWith("\n")) text += "\n\n";
  } else if (!atLineStart && /^(#|- )/.test(text)) {
    text = `\n${text}`;
  }

  const start = from;
  editor.replaceRange(from, to, text);

  if (built.selectText) {
    const offset = text.indexOf(built.selectText);
    if (offset >= 0) editor.setSelection(start + offset, start + offset + built.selectText.length);
  } else if (built.select) {
    const offset = Math.max(0, text.indexOf(built.text));
    editor.setSelection(start + offset + built.select[0], start + offset + built.select[1]);
  }

  scheduleCompile(60);
}

document.addEventListener(
  "keydown",
  (event) => {
    if (!slash.open) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      slash.index = (slash.index + delta + slash.items.length) % slash.items.length;
      renderSlashMenu();
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      chooseSlash(slash.items[slash.index]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      hideSlash();
    }
  },
  true,
);

document.addEventListener("click", (event) => {
  if (!event.target.closest(".slash-menu")) hideSlash();
});

// --- UI helpers -------------------------------------------------------------

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function setStatus(text, kind = "") {
  const node = el("status");
  node.textContent = text;
  node.className = kind;
}

function setSaveState(text) {
  state.saveLabel = text;
  renderFileStatus();

  clearTimeout(state.saveLabelTimer);
  if (text === "recargado desde disco") {
    state.saveLabelTimer = setTimeout(() => {
      if (state.saveLabel === "recargado desde disco") {
        state.saveLabel = "guardado";
        renderFileStatus();
      }
    }, 2600);
  }
}

/** Estado compacto junto al nombre del archivo: guardado, sin commitear, sin push… */
function renderFileStatus() {
  const node = el("saveState");
  if (!node) return;

  if (!state.file) {
    node.textContent = "";
    node.className = "file-status hidden";
    return;
  }

  const pending = [];
  if (state.dirty || state.saveLabel === "sin guardar") pending.push("Sin guardar");
  else if (state.saveLabel === "guardando…") pending.push("Guardando…");
  else if (state.saveLabel === "recargado desde disco") pending.push("Recargado");
  else if (state.saveLabel === "error al guardar") pending.push("Error al guardar");

  if (state.gitDirty > 0) pending.push("Sin commitear");
  if (state.gitAhead > 0) pending.push("Sin push");
  if (state.gitBehind > 0) pending.push("Sin pull");

  node.classList.remove("hidden");
  if (pending.length) {
    node.textContent = pending.join(" · ");
    node.className = "file-status warn";
  } else {
    node.textContent = "Guardado";
    node.className = "file-status ok";
  }
}

function applyTheme() {
  document.body.classList.toggle("dark", state.dark);
  editor.setDark(state.dark);
  for (const session of terminalSessions.values()) session.terminal.setDark(state.dark);
  el("btnTheme").title = state.dark ? "Modo claro" : "Modo oscuro";
  el("btnTheme").setAttribute("aria-label", state.dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro");
}

function zoomBase() {
  const preview = el("preview");
  const available = preview.clientWidth - 36;
  return Math.max(240, Math.min(620, available));
}

function applyZoom() {
  const width = Math.round(zoomBase() * state.zoom);
  const cssWidth = `${width}px`;
  for (const page of el("preview").children) {
    if (page.classList.contains("page") && page.style.width !== cssWidth) page.style.width = cssWidth;
  }
  const label = el("zoomReset");
  if (label) label.textContent = `${Math.round(state.zoom * 100)}%`;
  requestAnimationFrame(() => {
    refreshPageLayout();
    scheduleVisiblePages();
  });
}

function setZoom(value, persist = true) {
  state.zoom = Math.min(3, Math.max(0.4, Math.round(value * 100) / 100));
  applyZoom();
  if (persist) api.setPrefs({ zoom: state.zoom }).catch(() => {});
}

function updatePreviewSource() {
  const node = el("previewSource");
  if (!node) return;
  const chapters = state.info?.chapters ?? [];
  const standalone = state.file && !chapters.includes(state.file);
  node.textContent = standalone ? state.file.split("/").pop() : "Libro";
  node.title = standalone ? `Vista del archivo ${state.file}` : "Vista del libro completo";
}

function showError(text) {
  el("errorText").textContent = text;
  el("errorBar").classList.remove("hidden");
}

function hideError() {
  el("errorBar").classList.add("hidden");
}

function placeholderPages(text) {
  el("preview").innerHTML = "";
  for (let i = 0; i < 2; i += 1) {
    const page = document.createElement("div");
    page.className = "page placeholder";
    if (i === 0) {
      const wrap = document.createElement("div");
      wrap.className = "placeholder-inner";
      const label = document.createElement("p");
      label.className = "placeholder-text";
      label.textContent = text;
      const open = document.createElement("button");
      open.className = "primary";
      open.textContent = "Abrir carpeta…";
      open.addEventListener("click", () => openProjectDialog());
      wrap.append(label, open);
      page.append(wrap);
    }
    el("preview").append(page);
  }
}

// --- guardado y compilación -------------------------------------------------

function scheduleSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveNow, 400);
}

async function saveNow({ compile = true } = {}) {
  if (!state.file) return false;
  clearTimeout(state.saveTimer);
  if (!state.dirty) return false;

  const file = state.file;
  const revision = state.editRevision;
  const content = editor.getValue();
  try {
    await api.writeFile(file, content);
    state.lastSaveAt = Date.now();
    // Si se siguió escribiendo mientras se guardaba, no marcamos la versión
    // nueva como guardada ni compilamos contenido ya obsoleto.
    if (file === state.file && revision === state.editRevision) {
      state.dirty = false;
      setSaveState("guardado");
      if (compile) {
        if (state.documentMode === "focus") await refreshReading();
        else scheduleCompile();
      }
    } else if (file === state.file) {
      state.dirty = true;
      scheduleSave();
    }
    return true;
  } catch (error) {
    state.dirty = true;
    setSaveState("error al guardar");
    setStatus(error.message, "bad");
    return false;
  }
}

function autoCompileDelay() {
  const length = editor.getLength();
  // Guardar ya espera 400 ms desde la última tecla. Añadir un segundo extra
  // hacía que un informe largo tardase casi 2,5 s en refrescar tras una pausa.
  if (length > 600000) return 700;
  if (length > 250000) return 450;
  if (length > 60000) return 250;
  return 120;
}

function scheduleCompile(delay = autoCompileDelay()) {
  clearTimeout(state.compileTimer);
  if (state.documentMode === "focus") return;
  state.compileTimer = setTimeout(compileNow, delay);
}

let compiling = false;
let compileQueued = false;

async function compileNow() {
  if (!state.info) return;
  if (state.documentMode === "focus") return;
  if (compiling) { compileQueued = true; return; }
  compiling = true;
  clearTimeout(state.compileTimer);

  try {
    const result = await api.compile(state.file);
    if (state.documentMode === "focus") return;
    if (result.ok) {
      hideError();
      state.blocksCache = null;
      state.blocksTask = null;
      renderPages(result.pages);
      el("pageCount").textContent = `${result.pages.length} páginas`;
      updatePreviewSource();
      if (state.sidebarTab === "outline") refreshOutline();
      // Copiamos el índice una vez por compilación, no en cada clic o cursor.
      setTimeout(() => getBlocks().catch(() => {}), 0);
      setStatus("Compilado", "ok");
    } else {
      showError(result.error || "Error desconocido");
      if (!el("preview").children.length) {
        placeholderPages("Corrige el error para ver la vista paginada");
      }
      setStatus("Error de compilación", "bad");
    }
  } catch (error) {
    showError(String(error.message ?? error));
    setStatus("Error", "bad");
  } finally {
    compiling = false;
    if (compileQueued) {
      compileQueued = false;
      scheduleCompile(0);
    }
  }
}

function pageTop(preview, pageEl) {
  return pageEl.getBoundingClientRect().top - preview.getBoundingClientRect().top + preview.scrollTop;
}

function pageOffsetInfo(preview) {
  const children = [...preview.children];
  const top = preview.scrollTop;
  let index = 0;
  let offset = 0;

  children.forEach((child, i) => {
    // offsetTop ya está en coordenadas del área con scroll y evita 600
    // getBoundingClientRect() por compilación en documentos largos.
    const childTop = child.offsetTop;
    if (childTop <= top + 2) {
      index = i;
      offset = top - childTop;
    }
  });

  return { index, offset, atTop: top < 8, count: children.length };
}

function createPageElement(page) {
  const box = document.createElement("div");
  box.className = "page";
  box.dataset.page = String(page.index);
  box.dataset.height = String(page.height);
  box.dataset.width = String(page.width);
  box.imageBoxes = page.imageBoxes ?? [];
  box.dataset.url = page.url;
  box.dataset.loaded = "0";
  box.style.aspectRatio = `${page.width} / ${page.height}`;
  box.title = "Clic: ir al código · figuras y tablas: editar";

  const content = document.createElement("div");
  content.className = "page-content";

  const marker = document.createElement("div");
  marker.className = "block-marker";

  const label = document.createElement("div");
  label.className = "page-label";
  label.textContent = `Página ${page.index}`;

  box.append(marker, content, label);
  return box;
}

// --- páginas bajo demanda (documentos largos sin llenar la RAM) -------------

let previewScrollRaf = 0;

function refreshPageLayout() {
  const preview = el("preview");
  state.pageLayout = [...preview.children]
    .filter((node) => node.classList && node.classList.contains("page") && !node.classList.contains("placeholder"))
    .map((box) => ({ box, top: box.offsetTop, height: box.offsetHeight || 1 }));
}

function loadPageContent(box) {
  if (!box || box.dataset.loaded === "1" || !box.dataset.url) return;
  const content = box.querySelector(".page-content");
  if (!content) return;

  const image = document.createElement("img");
  image.className = "page-svg";
  image.alt = `Página ${box.dataset.page}`;
  image.draggable = false;
  image.decoding = "async";
  image.src = box.dataset.url;
  image.addEventListener("error", () => {
    const retries = Number(box.dataset.retries ?? "0");
    if (retries >= 3) return;
    box.dataset.retries = String(retries + 1);
    box.dataset.loaded = "0";
    content.innerHTML = "";
    setTimeout(() => loadPageContent(box), 700);
  });

  content.append(image);
  box.dataset.loaded = "1";
  box.dataset.retries = "0";
}

function unloadPageContent(box) {
  if (!box || box.dataset.loaded !== "1") return;
  const content = box.querySelector(".page-content");
  if (content) content.innerHTML = "";
  box.dataset.loaded = "0";
}

/** Carga solo las páginas cercanas al scroll y libera las lejanas. */
function refreshVisiblePages() {
  if (!state.pageLayout?.length) refreshPageLayout();
  if (!state.pageLayout.length) return;

  const preview = el("preview");
  const near = 2000;
  const far = 4200;
  const viewTop = preview.scrollTop;
  const viewBottom = viewTop + preview.clientHeight;

  for (const entry of state.pageLayout) {
    const { box, top, height } = entry;
    if (top < viewBottom + near && top + height > viewTop - near) loadPageContent(box);
    else if (top + height < viewTop - far || top > viewBottom + far) unloadPageContent(box);
  }
}

function scheduleVisiblePages() {
  if (previewScrollRaf) return;
  previewScrollRaf = requestAnimationFrame(() => {
    previewScrollRaf = 0;
    refreshVisiblePages();
  });
}

el("preview").addEventListener("scroll", scheduleVisiblePages, { passive: true });

function updatePageElement(box, page) {
  if (box.dataset.url !== page.url) {
    unloadPageContent(box);
    box.dataset.url = page.url;
    box.dataset.loaded = "0";
  }
  const index = String(page.index);
  const width = String(page.width);
  const height = String(page.height);
  if (box.dataset.page !== index) box.dataset.page = index;
  if (box.dataset.height !== height) box.dataset.height = height;
  if (box.dataset.width !== width) box.dataset.width = width;
  if (box.imageBoxes !== page.imageBoxes) box.imageBoxes = page.imageBoxes ?? [];
  const ratio = `${page.width} / ${page.height}`;
  if (box.style.aspectRatio !== ratio) box.style.aspectRatio = ratio;
}

function renderPages(pages) {
  const preview = el("preview");
  const children = [...preview.children];
  const realPages = children.every(
    (node) => node.classList.contains("page") && !node.classList.contains("placeholder"),
  );
  // En la parte superior no hace falta medir las 600 hojas para conservar el
  // scroll: ya estamos arriba y seguir arriba es lo correcto.
  const keep = realPages && children.length && preview.scrollTop >= 8
    ? pageOffsetInfo(preview)
    : { index: 0, offset: 0, atTop: true, count: 0 };

  if (!realPages) {
    preview.innerHTML = "";
    const fragment = document.createDocumentFragment();
    for (const page of pages) fragment.append(createPageElement(page));
    preview.append(fragment);
  } else {
    // Reutilizamos las hojas existentes y solo aplicamos el delta. Antes, un
    // cambio de una página reconstruía las 600 y perdía las imágenes cargadas.
    while (preview.children.length > pages.length) preview.lastElementChild.remove();
    pages.forEach((page, i) => {
      const box = preview.children[i];
      if (!box) preview.append(createPageElement(page));
      else updatePageElement(box, page);
    });
    if (!keep.atTop) {
      const target = preview.children[keep.index] ?? preview.lastElementChild;
      if (target) preview.scrollTop = pageTop(preview, target) + keep.offset;
    }
  }

  state.pages = pages.length;
  state.pageLayout = [];
  // applyZoom ya programa un único refresco de layout y de páginas visibles.
  applyZoom();
}

// --- archivos ---------------------------------------------------------------

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|svg)$/i;
const TEXT_EXT = /\.(md|markdown|ya?ml|typ|txt|json|css|html?|js|mjs|cjs|toml|ini)$/i;

const TREE_ICONS = {
  folder: {
    cls: "folder",
    svg: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  },
  folderOpen: {
    cls: "folder",
    svg: '<path d="M3 8V6a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1"/><path d="M4.5 10h16L18 19H2z"/>',
  },
  md: {
    cls: "md",
    svg: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4"/><path d="M8.5 17v-5l1.8 2 1.7-2v5"/>',
  },
  image: {
    cls: "img",
    svg: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M4.5 17l4.5-4 3 2.7 3-2.2 4.5 4"/>',
  },
  config: {
    cls: "cfg",
    svg: '<path d="M8 4c-2 0-2 1.8-2 4s-.8 3-2 3c1.2 0 2 1 2 3s0 4 2 4"/><path d="M16 4c2 0 2 1.8 2 4s.8 3 2 3c-1.2 0-2 1-2 3s0 4-2 4"/>',
  },
  typ: {
    cls: "typ",
    svg: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4"/><path d="M8.5 11h7M12 11v7"/>',
  },
  code: {
    cls: "code",
    svg: '<path d="M9 7l-5 5 5 5"/><path d="M15 7l5 5-5 5"/>',
  },
  pdf: {
    cls: "pdf",
    svg: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4"/><path d="M9 17v-6h2a1.6 1.6 0 0 1 0 3.2H9"/>',
  },
  file: {
    cls: "file",
    svg: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4"/>',
  },
};

function treeIconKind(entry) {
  if (entry.dir) return "folder";
  const suffix = entry.name.includes(".") ? entry.name.split(".").pop().toLowerCase() : "";
  if (IMAGE_EXT.test(entry.name)) return "image";
  if (/^(md|markdown)$/.test(suffix)) return "md";
  if (/^(ya?ml|toml|ini|json)$/.test(suffix)) return "config";
  if (suffix === "typ") return "typ";
  if (/^(js|mjs|cjs|ts|tsx|jsx|css|html?|py|sh|rs|go|c|cc|cpp|h)$/.test(suffix)) return "code";
  if (suffix === "pdf") return "pdf";
  return "file";
}

function applyTreeIcon(node, entry, expanded) {
  const kind = entry.dir ? (expanded ? "folderOpen" : "folder") : treeIconKind(entry);
  const { cls, svg } = TREE_ICONS[kind];
  node.className = `tree-icon ${cls}`;
  node.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${svg}</svg>`;
}

function treeTargetDir() {
  if (state.selectedDir) return state.selectedDir;
  if (state.selectedPath) {
    const parts = state.selectedPath.split("/");
    if (parts.length > 1) return parts.slice(0, -1).join("/");
  }
  return "";
}

function markActiveTree() {
  for (const node of document.querySelectorAll(".tree-row")) {
    node.classList.toggle("active", node.dataset.path === state.file);
  }
}

function markSelectedTree(row) {
  for (const node of document.querySelectorAll(".tree-row.selected")) node.classList.remove("selected");
  if (row) row.classList.add("selected");
}

async function refreshTree() {
  if (!state.info) return;
  const tree = el("fileTree");
  tree.innerHTML = "";
  await appendTree(tree, "", 0);
  markActiveTree();
}

async function appendTree(parent, rel, depth) {
  let entries = [];
  try {
    entries = await api.listDir(rel);
  } catch {
    return;
  }

  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "tree-row";
    row.dataset.path = entry.path;
    row.dataset.dir = entry.dir ? "1" : "0";
    row.style.paddingLeft = `${6 + depth * 12}px`;
    row.title = entry.path;

    const caret = document.createElement("span");
    caret.className = "tree-caret";
    caret.textContent = entry.dir ? (state.expandedDirs.has(entry.path) ? "▾" : "▸") : "";

    const icon = document.createElement("span");
    applyTreeIcon(icon, entry, state.expandedDirs.has(entry.path));

    const name = document.createElement("span");
    name.className = "tree-name";
    name.textContent = entry.name;

    row.append(caret, icon, name);
    parent.append(row);

    if (entry.dir) {
      const children = document.createElement("div");
      children.className = "tree-children";
      parent.append(children);

      if (state.expandedDirs.has(entry.path)) {
        await appendTree(children, entry.path, depth + 1);
        children.dataset.loaded = "1";
      } else {
        children.style.display = "none";
      }

      row.addEventListener("click", async (event) => {
        event.stopPropagation();
        state.selectedPath = entry.path;
        state.selectedDir = entry.path;
        markSelectedTree(row);

        if (state.expandedDirs.has(entry.path)) {
          state.expandedDirs.delete(entry.path);
          children.style.display = "none";
          caret.textContent = "▸";
          applyTreeIcon(icon, entry, false);
          return;
        }

        state.expandedDirs.add(entry.path);
        if (!children.dataset.loaded) {
          await appendTree(children, entry.path, depth + 1);
          children.dataset.loaded = "1";
        }
        children.style.display = "block";
        caret.textContent = "▾";
        applyTreeIcon(icon, entry, true);
      });
    } else {
      row.addEventListener("click", () => {
        state.selectedPath = entry.path;
        state.selectedDir = entry.path.split("/").slice(0, -1).join("/");
        markSelectedTree(row);
        openTreeFile(entry);
      });
    }
  }
}

function openTreeFile(entry) {
  if (IMAGE_EXT.test(entry.name)) {
    editImage(entry.path);
    return;
  }
  if (!TEXT_EXT.test(entry.name)) {
    setStatus("Ese tipo de archivo no se edita en la app", "bad");
    return;
  }
  openFile(entry.path);
}

el("btnNewFile").addEventListener("click", () => {
  const dir = treeTargetDir();
  openPrompt({
    title: "Nuevo archivo",
    label: `Nombre${dir ? ` en ${dir}` : ""}`,
    placeholder: "notas.md",
    onOk: async (name) => {
      const rel = [dir, name].filter(Boolean).join("/");
      await api.createFile(rel);
      if (dir) state.expandedDirs.add(dir);
      await refreshTree();
      setStatus(`Creado ${rel}`, "ok");
    },
  });
});

el("btnNewFolder").addEventListener("click", () => {
  const dir = treeTargetDir();
  openPrompt({
    title: "Nueva carpeta",
    label: `Nombre${dir ? ` en ${dir}` : ""}`,
    placeholder: "recursos",
    onOk: async (name) => {
      const rel = [dir, name].filter(Boolean).join("/");
      await api.createFolder(rel);
      if (dir) state.expandedDirs.add(dir);
      state.expandedDirs.add(rel);
      await refreshTree();
      setStatus(`Creada ${rel}`, "ok");
    },
  });
});

el("btnDeletePath").addEventListener("click", () => {
  const rel = state.selectedPath;
  if (!rel) {
    setStatus("Selecciona un archivo o carpeta", "bad");
    return;
  }

  openConfirm({
    title: "Eliminar",
    message: `¿Eliminar "${rel}"? Esta acción no se puede deshacer.`,
    onOk: async () => {
      await api.deletePath(rel);
      if (state.file === rel || (state.file && state.file.startsWith(`${rel}/`))) {
        state.file = null;
        state.loading = true;
        editor.setValue("");
        state.loading = false;
        el("activeFile").textContent = "—";
      }
      state.selectedPath = null;
      state.selectedDir = "";
      state.expandedDirs.delete(rel);
      await refreshTree();
      await refreshGit();
      setStatus(`Eliminado ${rel}`, "ok");
    },
  });
});

el("btnOpenFolder").addEventListener("click", () => {
  api.openFolder(state.selectedDir || "").catch(() => {});
});

async function afterImport(result, dir) {
  const added = result?.added ?? [];
  if (dir) state.expandedDirs.add(dir);
  await refreshTree();
  await refreshGit();
  if (added.length) {
    setStatus(
      `Agregado${added.length > 1 ? "s" : ""}: ${added.slice(0, 3).join(", ")}${added.length > 3 ? "…" : ""}`,
      "ok",
    );
  } else {
    setStatus("No se agregó ningún archivo", "bad");
  }
}

el("btnImportFiles").addEventListener("click", async () => {
  try {
    const dir = treeTargetDir();
    const result = await api.importFiles(dir);
    await afterImport(result, dir);
  } catch (error) {
    setStatus(error.message, "bad");
  }
});

const treeEl = el("fileTree");

treeEl.addEventListener("dragover", (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  treeEl.classList.add("drop-target");
});

treeEl.addEventListener("dragleave", (event) => {
  if (!treeEl.contains(event.relatedTarget)) treeEl.classList.remove("drop-target");
});

treeEl.addEventListener("drop", async (event) => {
  event.preventDefault();
  treeEl.classList.remove("drop-target");

  const files = [...(event.dataTransfer?.files ?? [])];
  if (!files.length) return;

  const paths = files
    .map((file) => {
      try {
        return api.pathForFile(file);
      } catch {
        return "";
      }
    })
    .filter(Boolean);
  if (!paths.length) return;

  const row = event.target.closest?.(".tree-row");
  const dir = row?.dataset.dir === "1" ? row.dataset.path : treeTargetDir();
  try {
    const result = await api.importPaths(paths, dir);
    await afterImport(result, dir);
  } catch (error) {
    setStatus(error.message, "bad");
  }
});

async function openFile(rel, { compile = true } = {}) {
  if (state.file === rel) return false;
  if (state.readEdit) await setReadEditing(false);
  const previous = state.file;
  const saved = await saveNow({ compile: false });
  const chapters = state.info?.chapters ?? [];
  const scopeChanged = !previous || !chapters.includes(previous) || !chapters.includes(rel);

  try {
    const { content } = await api.readFile(rel);
    editor.setLargeDoc(content.length > 250000);
    state.loading = true;
    editor.setValue(content);
    state.loading = false;
    state.file = rel;
    el("activeFile").textContent = rel;
    el("activeFile").title = rel;
    setSaveState("");
    markActiveTree();
    editor.focus();
    updatePreviewSource();
    if (state.sidebarTab === "outline") refreshOutline();
    if (state.viewMode === "reading" || state.documentMode === "focus") await refreshReading();
    // Cambiar de capítulo no altera el libro compilado: no recompilamos solo
    // por navegar. Sí lo hacemos si se guardó texto o cambió el ámbito.
    if (saved || (compile && scopeChanged)) scheduleCompile(180);
    return true;
  } catch (error) {
    setStatus(error.message, "bad");
    return false;
  }
}

// --- modo lectura -----------------------------------------------------------

const PENCIL_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l10-10-4-4L4 16z"/><path d="M14 6l4 4"/></svg>';
const CHECK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';

let readingSeq = 0;

async function refreshReading() {
  const content = el("readingContent");
  if (!state.file) {
    content.innerHTML = '<p class="reading-empty">Abre un archivo Markdown para verlo aquí.</p>';
    return;
  }

  const seq = ++readingSeq;
  const previousScroll = content.scrollHeight ? content.scrollTop / content.scrollHeight : 0;
  if (state.documentMode !== "focus") content.classList.add("loading");
  try {
    const html = await api.renderDoc(state.file);
    if (seq !== readingSeq) return;
    if (state.documentMode === "focus") focusAutoScrollUntil = Date.now() + 450;
    content.innerHTML = html || '<p class="reading-empty">Este archivo no tiene contenido.</p>';
    decorateReading();
    applyReadingEditability();
    requestAnimationFrame(() => {
      if (state.documentMode === "focus") syncFocusToCursor(editor.getCursorLine());
      else content.scrollTop = previousScroll * content.scrollHeight;
    });
  } catch (error) {
    if (seq !== readingSeq) return;
    content.innerHTML = `<p class="reading-empty bad">No se pudo renderizar: ${escapeHtml(error.message ?? error)}</p>`;
  } finally {
    if (seq === readingSeq) content.classList.remove("loading");
  }
}

function decorateReading() {
  const content = el("readingContent");
  const text = editor.getValue();
  const lines = text.split("\n");
  const lineStarts = [0];
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);
  const lineStart = (line) => lineStarts[Math.max(0, Math.min(lineStarts.length - 1, line - 1))];

  for (const table of content.querySelectorAll("table")) {
    const block = table.closest(".md-block");
    if (!block) continue;

    const kind = block.dataset.kind;
    const start = Number(block.dataset.start);
    const source = lines.slice(start - 1, Number(block.dataset.end)).join("\n");
    const htmlIndex = [...block.querySelectorAll("table")].indexOf(table);
    const htmlMatch = [...source.matchAll(/<table\b/gi)][htmlIndex];
    const tableLine = kind === "html" && htmlMatch ? start + source.slice(0, htmlMatch.index).split("\n").length - 1 : start;
    const tableOffset = kind === "html" && htmlMatch ? lineStart(start) + htmlMatch.index : null;
    table.classList.add("clickable-table");
    table.title = "Doble clic para editar la tabla";

    table.addEventListener("dblclick", (event) => {
      if (event.target.closest("a, img, .reading-edit")) return;
      if (!start) return;
      if (kind === "table" || kind === "html") {
        if (tableAtLine(text, tableLine, tableOffset)) {
          openTableEditor({
            editor,
            setStatus,
            line: tableLine,
            offset: tableOffset,
            onSaved: () => persistTableChange("Tabla actualizada"),
          });
          return;
        }
      }

      setViewMode("code");
      editor.revealLine(start);
    });

    if (kind !== "table") continue;
    const line = start;
    if (!tableAtLine(text, line)) continue;

    const wrap = table.closest("figure") ?? table.parentElement;
    if (!wrap || wrap.querySelector(":scope > .reading-edit")) continue;

    const btn = document.createElement("button");
    btn.className = "reading-edit";
    btn.title = "Editar esta tabla";
    btn.innerHTML = `${PENCIL_SVG} Editar tabla`;
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      openTableEditor({
        editor,
        setStatus,
        line,
        onSaved: () => persistTableChange("Tabla actualizada"),
      });
    });
    wrap.append(btn);
  }
}

el("readingContent").addEventListener("dblclick", (event) => {
  const image = event.target.closest?.("img");
  if (!image || !el("readingContent").contains(image)) return;
  const block = image.closest(".md-block");
  if (!block) return;
  event.preventDefault();
  event.stopPropagation();
  openHtmlImageEditor({ editor, image, block, setStatus, onSaved: async () => {
    await saveNow();
    scheduleCompile(60);
    await refreshReading();
  } });
});

el("editor").addEventListener("dblclick", (event) => {
  if (!event.target.closest?.(".cm-content")) return;
  const line = editor.getLineAtCoords(event.clientX, event.clientY);
  if (line == null) return;
  if (!tableAtLine(editor.getValue(), line)) return;
  openTableEditor({ editor, line, setStatus, onSaved: () => persistTableChange("Tabla actualizada") });
});

el("editor").addEventListener("pointerup", (event) => {
  if (event.button !== 0 || !event.target.closest?.(".cm-content")) return;
  setTimeout(() => {
    const selected = editor.getSelectionInfo();
    lastMouseSelection = selected.from < selected.to ? selected : null;
  }, 0);
});

el("editor").addEventListener("contextmenu", (event) => {
  if (!event.target.closest?.(".cm-editor")) return;
  const selection = lastMouseSelection;
  const current = editor.getSelectionInfo();
  const pos = editor.getPosAtCoords(event.clientX, event.clientY);
  if (!selection || (current.from < current.to && (current.from !== selection.from || current.to !== selection.to)) ||
      editor.getRange(selection.from, selection.to) !== selection.text ||
      pos == null || pos < selection.from || pos > selection.to) return;
  const line = editor.getLineAtCoords(event.clientX, event.clientY);
  if (line == null) return;
  event.preventDefault();
  hideSlash();
  const change = centerParagraphAt(editor.getValue(), line);
  const apply = async (kind, url = "") => {
    const edit = formatInlineSelection(editor.getValue(), selection.from, selection.to, kind, url);
    if (!edit) { setStatus("Enlace o selección no válidos", "bad"); return; }
    editor.replaceRange(edit.from, edit.to, edit.insert);
    await saveNow();
    if (state.viewMode === "reading" || state.documentMode === "focus") await refreshReading();
  };
  const items = [
    { label: "B  Negrita", action: () => apply("bold") },
    { label: "I  Cursiva", action: () => apply("italic") },
    { label: "U  Subrayado", action: () => apply("underline") },
    { label: "Tx  Limpiar formato", action: () => apply("clear") },
    { label: "Enlace (cadena)", action: () => openPrompt({ title: "Enlace", label: "Dirección URL", placeholder: "https://", confirmLabel: "Insertar enlace", onOk: (url) => {
      if (!formatInlineSelection(editor.getValue(), selection.from, selection.to, "link", url)) throw new Error("Indica una URL o ruta válida");
      return apply("link", url);
    } }) },
    { label: "S  Tachado", action: () => apply("strike") },
    { label: "</>  Código en línea", action: () => apply("code") },
    { label: "√x  Ecuación en línea", action: () => apply("math") },
    { separator: true },
    { label: "…  Más opciones", action: () => openContextMenu(event.clientX, event.clientY, [{
      label: "Centrar párrafo", disabled: !change,
      action: async () => {
        editor.replaceRange(change.from, change.to, change.insert);
        await saveNow();
        if (state.viewMode === "reading" || state.documentMode === "focus") await refreshReading();
        setStatus("Párrafo centrado", "ok");
      },
    }]) },
  ];
  openContextMenu(event.clientX, event.clientY, items);
});

const READING_EDITABLE = new Set(["paragraph", "heading", "list", "blockquote", "code", "callout"]);

function applyReadingEditability() {
  const content = el("readingContent");
  content.classList.toggle("editing", state.readEdit);

  for (const block of content.querySelectorAll(".md-block")) {
    const editable = state.readEdit && READING_EDITABLE.has(block.dataset.kind);
    if (editable) {
      block.setAttribute("contenteditable", "true");
      block.setAttribute("spellcheck", "false");
      block.dataset.committed = block.innerHTML;
      block.addEventListener("focusout", onReadingBlockBlur);
      block.addEventListener("keydown", onReadingBlockKey);
      for (const fixed of block.querySelectorAll(".num, .callout-title, .reading-edit")) {
        fixed.setAttribute("contenteditable", "false");
      }
    } else {
      block.removeAttribute("contenteditable");
      block.removeEventListener("focusout", onReadingBlockBlur);
      block.removeEventListener("keydown", onReadingBlockKey);
    }

    for (const table of block.querySelectorAll("table")) {
      if (state.readEdit && block.dataset.kind === "html") {
        table.setAttribute("contenteditable", "true");
        table.setAttribute("spellcheck", "false");
        tableSnapshots.set(table, table.outerHTML);
        table.addEventListener("focusout", onReadingTableBlur);
      } else {
        table.removeAttribute("contenteditable");
        table.removeEventListener("focusout", onReadingTableBlur);
      }
    }
  }
}

async function setReadEditing(enabled) {
  if (enabled && !state.readEdit) {
    await saveNow();
    state.readEdit = true;
    applyReadingEditability();
    el("btnEditReading").innerHTML = `${CHECK_SVG} Listo`;
    el("btnEditReading").title = "Terminar la edición de la vista";
    el("btnEditReading").classList.add("active");
    el("readingHint").textContent = "Edición en la vista · se guarda en Markdown al salir del bloque";
  } else if (!enabled && state.readEdit) {
    const active = document.activeElement?.closest?.(".md-block");
    if (active && el("readingContent").contains(active)) commitReadingBlock(active);

    state.readEdit = false;
    applyReadingEditability();
    el("btnEditReading").innerHTML = `${PENCIL_SVG} Editar`;
    el("btnEditReading").title = "Editar manteniendo el formato de lectura";
    el("btnEditReading").classList.remove("active");
    el("readingHint").textContent = "Vista de lectura · solo lectura";
    if (await saveNow()) scheduleCompile(400);
  }
}

function onReadingBlockBlur(event) {
  if (!state.readEdit) return;
  commitReadingBlock(event.currentTarget);
}

function splitParagraphAtCaret(block) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return false;

  const range = selection.getRangeAt(0);
  let paragraph = range.startContainer;
  if (paragraph.nodeType === Node.TEXT_NODE) paragraph = paragraph.parentElement;
  paragraph = paragraph?.closest?.("p") ?? null;
  if (!paragraph || !block.contains(paragraph)) return false;

  const tail = document.createRange();
  tail.setStart(range.startContainer, range.startOffset);
  tail.setEnd(paragraph, paragraph.childNodes.length);
  const fragment = tail.extractContents();

  const next = document.createElement("p");
  next.append(fragment);
  if (!next.textContent && !next.querySelector("img")) next.append(document.createElement("br"));
  paragraph.after(next);

  const caret = document.createRange();
  caret.setStart(next, 0);
  caret.collapse(true);
  selection.removeAllRanges();
  selection.addRange(caret);
  return true;
}

function onReadingBlockKey(event) {
  if (!state.readEdit) return;
  const kind = event.currentTarget.dataset.kind;

  if (event.key === "Escape") {
    event.preventDefault();
    setReadEditing(false);
    return;
  }

  if (event.key === "Enter" && kind === "paragraph" && splitParagraphAtCaret(event.currentTarget)) {
    event.preventDefault();
    return;
  }

  if (event.key === "Enter" && kind === "heading") {
    event.preventDefault();
    event.currentTarget.blur();
  }

  if (event.key === "Enter" && kind === "code") {
    event.preventDefault();
    document.execCommand("insertText", false, "\n");
  }
}

function escapeMdText(text) {
  return String(text).replace(/([\\`*_[\]~])/g, "\\$1");
}

function inlineToMd(node) {
  let out = "";
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      out += escapeMdText(child.nodeValue ?? "");
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    if (child.classList.contains("num") || child.classList.contains("reading-edit")) continue;
    if (child.classList.contains("callout-title")) continue;
    if (child.classList.contains("fn-ref")) {
      out += `[^${child.textContent.trim()}]`;
      continue;
    }
    if (child.classList.contains("math-inline")) {
      out += `$${child.dataset.tex ?? ""}$`;
      continue;
    }
    if (child.classList.contains("math-display")) {
      out += `\n$$\n${child.dataset.tex ?? ""}\n$$\n`;
      continue;
    }
    if (child.classList.contains("xref")) {
      out += `@${(child.getAttribute("href") ?? "").replace(/^#/, "")}`;
      continue;
    }

    const tag = child.tagName.toLowerCase();
    if (tag === "strong" || tag === "b") out += `**${inlineToMd(child)}**`;
    else if (tag === "em" || tag === "i") out += `*${inlineToMd(child)}*`;
    else if (tag === "del" || tag === "s") out += `~~${inlineToMd(child)}~~`;
    else if (tag === "code") out += "`" + child.textContent + "`";
    else if (tag === "a") out += `[${inlineToMd(child)}](${child.getAttribute("href") ?? ""})`;
    else if (tag === "img") {
      out += `![${child.getAttribute("alt") ?? ""}](${child.dataset.src ?? child.getAttribute("src") ?? ""})`;
    } else if (tag === "br") {
      out += "  \n";
    } else {
      out += inlineToMd(child);
    }
  }
  return out;
}

function listToMd(list, indent = "") {
  const ordered = list.tagName.toLowerCase() === "ol";
  const items = [...list.children].filter((child) => child.tagName.toLowerCase() === "li");
  return items
    .map((item, index) => {
      const nested = [...item.children].filter((child) => /^(UL|OL)$/.test(child.tagName));
      const clone = item.cloneNode(true);
      for (const sub of clone.querySelectorAll(":scope > ul, :scope > ol")) sub.remove();
      const text = inlineToMd(clone).trim().replace(/\n+/g, " ");
      const prefix = ordered ? `${index + 1}. ` : "- ";
      let line = `${indent}${prefix}${text}`;
      for (const sub of nested) {
        const inner = listToMd(sub, `${indent}  `);
        if (inner) line += `\n${inner}`;
      }
      return line;
    })
    .join("\n");
}

function elementToMd(element) {
  const tag = element.tagName;
  if (tag === "P" || tag === "DIV") {
    if (element.classList.contains("callout-title")) return "";
    return inlineToMd(element).trim();
  }
  if (tag === "UL" || tag === "OL") return listToMd(element);
  if (tag === "PRE") {
    const code = element.querySelector("code") ?? element;
    const lang = [...code.classList].find((name) => name.startsWith("language-"))?.slice(9) ?? "";
    return "```" + lang + "\n" + code.textContent.replace(/\n$/, "") + "\n```";
  }
  if (tag === "BLOCKQUOTE") {
    const inner = [...element.children].map(elementToMd).filter(Boolean).join("\n\n");
    return inner
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n");
  }
  if (/^H[1-6]$/.test(tag)) {
    return `${"#".repeat(Number(tag[1]))} ${inlineToMd(element).trim()}`;
  }
  if (element.classList.contains("math-display")) {
    return `$$\n${element.dataset.tex ?? ""}\n$$`;
  }
  return inlineToMd(element).trim();
}

function blockToMarkdown(block) {
  const kind = block.dataset.kind;
  const lines = editor.getValue().split("\n");

  if (kind === "heading") {
    const heading = block.querySelector("h1, h2, h3, h4, h5, h6");
    if (!heading) return null;
    return `${"#".repeat(Number(heading.tagName[1]))} ${inlineToMd(heading).trim()}`;
  }

  if (kind === "paragraph") {
    const parts = [...block.children].filter((child) => /^(P|DIV)$/.test(child.tagName));
    if (!parts.length) {
      const text = inlineToMd(block).trim();
      return text || null;
    }
    return parts.map((part) => inlineToMd(part).trim()).filter(Boolean).join("\n\n");
  }

  if (kind === "list") {
    const list = block.querySelector("ul, ol");
    return list ? listToMd(list) : null;
  }

  if (kind === "blockquote") {
    const quote = block.querySelector("blockquote");
    return quote ? elementToMd(quote) : null;
  }

  if (kind === "code") {
    const pre = block.querySelector("pre");
    if (!pre) return null;
    const code = pre.querySelector("code") ?? pre;
    const lang = [...code.classList].find((name) => name.startsWith("language-"))?.slice(9) ?? "";
    return "```" + lang + "\n" + code.textContent.replace(/\n$/, "") + "\n```";
  }

  if (kind === "math") {
    const tex = block.querySelector("[data-tex]")?.dataset.tex;
    return tex ? `$$\n${tex}\n$$` : null;
  }

  if (kind === "callout") {
    const callout = block.querySelector(".callout");
    if (!callout) return null;
    const start = Number(block.dataset.start);
    const opening = lines[start - 1] ?? "";
    if (!/^\s*:::callout\b/.test(opening)) return null;
    const body = [...callout.children]
      .filter((child) => !child.classList.contains("callout-title"))
      .map(elementToMd)
      .filter(Boolean)
      .join("\n\n");
    return `${opening}\n${body}\n:::`;
  }

  return null;
}

function onReadingTableBlur(event) {
  if (!state.readEdit) return;
  commitHtmlTable(event.currentTarget);
}

function commitHtmlTable(table) {
  const block = table.closest(".md-block");
  if (!block || block.dataset.kind !== "html") return;
  if (tableSnapshots.get(table) === table.outerHTML) return;

  const start = Number(block.dataset.start);
  const end = Number(block.dataset.end);
  if (!start || !end) return;

  const clone = table.cloneNode(true);
  clone.removeAttribute("contenteditable");
  clone.removeAttribute("spellcheck");
  clone.removeAttribute("title");
  clone.classList.remove("clickable-table");
  for (const node of clone.querySelectorAll("[contenteditable]")) node.removeAttribute("contenteditable");
  for (const image of clone.querySelectorAll("img[data-src]")) {
    image.setAttribute("src", image.getAttribute("data-src"));
    image.removeAttribute("data-src");
  }
  const tableHtml = clone.outerHTML;

  const lines = editor.getValue().split("\n");
  const source = lines.slice(start - 1, end).join("\n");
  const tables = [...block.querySelectorAll("table")];
  const index = Math.max(0, tables.indexOf(table));
  let seen = -1;

  const next = source.replace(/<table\b[\s\S]*?<\/table>/gi, (match) => {
    seen += 1;
    return seen === index ? tableHtml : match;
  });
  if (next === source) return;

  const count = next.split("\n").length;
  editor.replaceLines(start, end, next);
  block.dataset.end = String(start + count - 1);
  tableSnapshots.set(table, table.outerHTML);

  const delta = count - (end - start + 1);
  if (delta !== 0) {
    for (const other of el("readingContent").querySelectorAll(".md-block")) {
      if (other === block) continue;
      const otherStart = Number(other.dataset.start);
      if (otherStart > end) {
        other.dataset.start = String(otherStart + delta);
        other.dataset.end = String(Number(other.dataset.end) + delta);
      }
    }
  }

  state.dirty = true;
  setSaveState("sin guardar");
  scheduleSave();
  scheduleCompile(1200);
}

function commitReadingBlock(block) {
  if (!block || !state.readEdit) return;
  if (!READING_EDITABLE.has(block.dataset.kind)) return;
  if (block.dataset.committed === block.innerHTML) return;

  const start = Number(block.dataset.start);
  const end = Number(block.dataset.end);
  if (!start || !end) return;

  const markdown = blockToMarkdown(block);
  if (markdown == null) return;

  const lineCount = markdown.split("\n").length;
  const oldCount = end - start + 1;

  editor.replaceLines(start, end, markdown);
  block.dataset.end = String(start + lineCount - 1);
  block.dataset.committed = block.innerHTML;

  const delta = lineCount - oldCount;
  if (delta !== 0) {
    for (const other of el("readingContent").querySelectorAll(".md-block")) {
      if (other === block) continue;
      const otherStart = Number(other.dataset.start);
      if (otherStart > end) {
        other.dataset.start = String(otherStart + delta);
        other.dataset.end = String(Number(other.dataset.end) + delta);
      }
    }
  }

  state.dirty = true;
  setSaveState("sin guardar");
  scheduleSave();
  scheduleCompile(1200);
}

async function setViewMode(mode, persist = true) {
  if (state.documentMode === "focus" && mode === "reading") return;
  const next = state.documentMode === "focus" ? "code" : mode === "reading" ? "reading" : "code";
  if (next === "code" && state.readEdit) await setReadEditing(false);
  state.viewMode = next;

  el("btnViewCode").classList.toggle("active", next === "code");
  el("btnViewReading").classList.toggle("active", next === "reading");
  el("editor").classList.toggle("hidden", next === "reading");
  el("readingView").classList.toggle("hidden", next !== "reading");

  if (next === "reading") {
    await saveNow();
    await refreshReading();
  } else {
    editor.focus();
  }

  requestAnimationFrame(() => {
    refreshPageLayout();
    refreshVisiblePages();
  });
  if (persist) api.setPrefs({ viewMode: next }).catch(() => {});
}

let focusAutoScrollUntil = 0;
function syncFocusToCursor(line) {
  if (state.documentMode !== "focus") return;
  setActiveFromLine(line);
  const content = el("readingContent");
  const blocks = content.querySelectorAll(".md-block");
  const target = [...blocks].find((block) => Number(block.dataset.start) <= line && Number(block.dataset.end) >= line)
    ?? [...blocks].reverse().find((block) => Number(block.dataset.start) <= line);
  if (!target) return;
  const top = target.getBoundingClientRect().top - content.getBoundingClientRect().top + content.scrollTop;
  const bottom = top + target.offsetHeight;
  if (top < content.scrollTop + 24 || bottom > content.scrollTop + content.clientHeight - 24) {
    focusAutoScrollUntil = Date.now() + 600;
    content.scrollTo({ top: Math.max(0, top - content.clientHeight * 0.3), behavior: "smooth" });
  }
}

el("readingContent").addEventListener("scroll", () => {
  if (state.documentMode !== "focus" || Date.now() < focusAutoScrollUntil) return;
  clearTimeout(state.focusScrollTimer);
  state.focusScrollTimer = setTimeout(() => {
    if (state.documentMode !== "focus") return;
    const content = el("readingContent");
    const threshold = content.getBoundingClientRect().top + 40;
    const block = [...content.querySelectorAll(".md-block")].find((node) => node.getBoundingClientRect().bottom >= threshold);
    if (block) editor.scrollToLine(Number(block.dataset.start));
  }, 110);
});

async function setDocumentMode(mode) {
  if (mode === state.documentMode) return;
  if (mode === "focus") {
    state.focusPreviousView = state.viewMode;
    await setViewMode("code", false);
    state.documentMode = "focus";
    document.body.classList.add("focus-mode");
    document.body.classList.remove("preview-only");
    el("btnPreviewOnly").textContent = "⛶";
    el("previewTitle").textContent = "Lectura continua";
    el("pageCount").textContent = "";
    el("btnViewReading").disabled = true;
    el("btnViewReading").title = "La lectura continua se muestra a la derecha";
    clearTimeout(state.compileTimer);
    el("focusFlow").append(el("readingContent"));
    el("focusFlow").classList.remove("hidden");
    el("preview").classList.add("hidden");
    el("errorBar").classList.add("hidden");
    el("searchResults").classList.add("hidden");
    // saveNow() ya refresca la lectura cuando hay cambios; si no había nada
    // pendiente, entramos igualmente con el contenido completo del capítulo.
    const saved = state.file ? await saveNow() : false;
    if (!saved) await refreshReading();
  } else {
    state.documentMode = "delivery";
    document.body.classList.remove("focus-mode");
    el("previewTitle").textContent = "Vista paginada";
    el("btnViewReading").disabled = false;
    el("btnViewReading").title = "Lectura (Ctrl+2)";
    el("readingView").append(el("readingContent"));
    el("focusFlow").classList.add("hidden");
    el("preview").classList.remove("hidden");
    if (state.focusPreviousView === "reading") await setViewMode("reading", false);
    await saveNow();
    await compileNow();
  }
  if (state.sidebarTab === "outline") await renderOutline();
  for (const [id, active] of [["btnFocusMode", mode === "focus"], ["btnDeliveryMode", mode !== "focus"]]) {
    const button = el(id);
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

el("btnFocusMode").addEventListener("click", () => setDocumentMode("focus"));
el("btnDeliveryMode").addEventListener("click", () => setDocumentMode("delivery"));

el("btnViewCode").addEventListener("click", () => setViewMode("code"));
el("btnViewReading").addEventListener("click", () => setViewMode("reading"));
el("btnEditReading").addEventListener("click", () => setReadEditing(!state.readEdit));

async function openProjectDialog() {
  try {
    const info = await api.openProject();
    if (info) await openProject(info);
  } catch (error) {
    setStatus(error.message, "bad");
  }
}

async function openProject(info) {
  state.info = info;
  el("btnDocumentTheme").disabled = false;
  await updateDocumentThemeLabel();
  el("projectPath").textContent = info.root;
  el("projectPath").title = info.root;
  state.expandedDirs = new Set();
  state.selectedPath = null;
  state.selectedDir = "";
  await refreshTree();
  if (state.sidebarTab === "outline") await refreshOutline();

  if (!terminalSessions.size) {
    createTerminalSession().catch((error) => setStatus(String(error.message ?? error), "bad"));
  } else {
    for (const session of terminalSessions.values()) {
      await api.termRestart(session.id, session.terminal.term.cols, session.terminal.term.rows, session.shellId);
      session.terminal.clear();
    }
  }

  const first = info.autoChapters && info.readme ? info.readme : info.chapters[0] ?? "";
  state.file = null;
  if (first) {
    await openFile(first, { compile: false });
  } else {
    state.loading = true;
    editor.setValue("");
    state.loading = false;
    el("activeFile").textContent = "—";
    el("activeFile").title = "";
  }
  await compileNow();
  await refreshGit();

  if (info.created?.length) {
    setStatus(`Carpeta preparada: ${info.created.join(", ")}`, "ok");
  }

  await setViewMode(state.viewMode, false);
}

async function updateDocumentThemeLabel() {
  const { selected, themes, tableColors } = await api.documentThemes();
  const active = themes.find((theme) => theme.id === selected);
  el("btnDocumentTheme").textContent = `Tema PDF: ${active?.label ?? selected}`;
  const reading = el("readingContent");
  for (const [key, value] of Object.entries(tableColors ?? {})) reading.style.setProperty(`--document-table-${key}`, value);
}

async function showDocumentThemes() {
  if (!state.info) return;
  try {
    const { selected, themes } = await api.documentThemes();
    const body = document.createElement("div");
    body.className = "document-themes";
    const intro = document.createElement("p");
    intro.textContent = "El tema solo cambia el diseño del PDF. El Markdown y el tema actual no se modifican.";
    body.append(intro);
    const options = document.createElement("div");
    options.className = "document-theme-list";
    for (const theme of themes) {
      const card = document.createElement("label");
      card.className = "document-theme-option";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "document-theme";
      radio.value = theme.id;
      radio.checked = theme.id === selected;
      const swatch = document.createElement("span");
      swatch.className = `document-theme-swatch ${theme.kind === "custom" ? "custom" : theme.id}`;
      swatch.setAttribute("aria-hidden", "true");
      const labels = document.createElement("span");
      labels.className = "document-theme-labels";
      const title = document.createElement("strong");
      title.textContent = theme.label;
      const description = document.createElement("small");
      description.textContent = theme.description;
      labels.append(title, description);
      card.append(radio, swatch, labels);
      options.append(card);
    }
    body.append(options);

    const add = document.createElement("div");
    add.className = "document-theme-add";
    const nameLabel = document.createElement("label");
    nameLabel.textContent = "Crear desde la plantilla";
    const name = document.createElement("input");
    name.placeholder = "Nombre del nuevo tema";
    nameLabel.append(name);
    const create = document.createElement("button");
    create.className = "mini";
    create.textContent = "Crear tema";
    const error = document.createElement("p");
    error.className = "document-theme-error";
    error.setAttribute("role", "alert");
    create.addEventListener("click", async () => {
      if (!name.value.trim()) { error.textContent = "Escribe un nombre para el tema"; name.focus(); return; }
      create.disabled = true;
      try {
        if (state.dirty) await saveNow();
        const created = await api.createDocumentTheme(name.value);
        await updateDocumentThemeLabel();
        closeModal();
        setStatus(`Tema creado en ${created.path}. Edítalo con tu editor de Typst.`, "ok");
        await compileNow();
        await api.openFolder("theme/custom");
      } catch (exception) {
        error.textContent = String(exception.message ?? exception);
      } finally { create.disabled = false; }
    });
    add.append(nameLabel, create, error);
    body.append(add);

    const foot = document.createElement("div");
    foot.className = "document-theme-actions";
    const folder = document.createElement("button");
    folder.className = "mini";
    folder.textContent = "Abrir carpeta de temas";
    folder.addEventListener("click", () => api.openFolder("theme"));
    const remove = document.createElement("button");
    remove.className = "mini document-theme-remove";
    remove.textContent = "Borrar tema…";
    const updateDeleteState = () => {
      remove.disabled = !options.querySelector('input:checked')?.value || options.querySelector('input:checked')?.value === "actual";
    };
    options.addEventListener("change", updateDeleteState);
    updateDeleteState();
    remove.addEventListener("click", () => {
      const id = options.querySelector('input:checked')?.value;
      const theme = themes.find((entry) => entry.id === id);
      if (!theme || id === "actual") return;
      const confirmBody = document.createElement("div");
      confirmBody.className = "document-theme-confirm";
      const message = document.createElement("p");
      message.textContent = `Se borrará ${theme.description} del proyecto. Para confirmar, escribe «${theme.label}» o el código «${id}».`;
      const input = document.createElement("input");
      input.setAttribute("aria-label", "Nombre o código del tema a borrar");
      input.autocomplete = "off";
      const issue = document.createElement("p");
      issue.className = "document-theme-error";
      issue.setAttribute("role", "alert");
      confirmBody.append(message, input, issue);
      const confirmFoot = document.createElement("div");
      confirmFoot.className = "document-theme-actions";
      const back = document.createElement("button");
      back.className = "mini";
      back.textContent = "Volver";
      back.addEventListener("click", showDocumentThemes);
      const confirm = document.createElement("button");
      confirm.className = "mini document-theme-remove";
      confirm.textContent = "Borrar definitivamente";
      confirm.addEventListener("click", async () => {
        confirm.disabled = true;
        try {
          if (state.dirty) await saveNow();
          await api.deleteDocumentTheme(id, input.value);
          await updateDocumentThemeLabel();
          await compileNow();
          await showDocumentThemes();
          setStatus(`Tema ${theme.label} borrado del proyecto`, "ok");
        } catch (exception) {
          issue.textContent = String(exception.message ?? exception);
          input.focus();
        } finally { confirm.disabled = false; }
      });
      confirmFoot.append(back, confirm);
      openModal({ title: "Confirmar eliminación de tema", body: confirmBody, footer: confirmFoot, size: "sm" });
      input.focus();
    });
    const cancel = document.createElement("button");
    cancel.className = "mini";
    cancel.textContent = "Cancelar";
    cancel.addEventListener("click", closeModal);
    const apply = document.createElement("button");
    apply.className = "primary";
    apply.textContent = "Aplicar tema";
    apply.addEventListener("click", async () => {
      const id = options.querySelector("input:checked")?.value;
      if (!id) return;
      apply.disabled = true;
      try {
        if (state.dirty) await saveNow();
        await api.selectDocumentTheme(id);
        await updateDocumentThemeLabel();
        closeModal();
        await compileNow();
      } catch (exception) {
        error.textContent = String(exception.message ?? exception);
      } finally { apply.disabled = false; }
    });
    foot.append(folder, remove, cancel, apply);
    openModal({ title: "Tema del documento", body, footer: foot, size: "md" });
  } catch (error) {
    setStatus(String(error.message ?? error), "bad");
  }
}

el("btnDocumentTheme").addEventListener("click", showDocumentThemes);

// --- git --------------------------------------------------------------------

async function refreshGit() {
  if (!state.info) return;
  const status = await api.gitStatus();

  if (!status.repo) {
    state.gitDirty = 0;
    state.gitAhead = 0;
    state.gitBehind = 0;
    renderFileStatus();
    el("statusBranch").textContent = "";
    return;
  }

  state.gitDirty = status.files.length;
  const aheadBehind = status.aheadBehind ?? "";
  state.gitAhead = Number(/ahead (\d+)/.exec(aheadBehind)?.[1] ?? 0);
  state.gitBehind = Number(/behind (\d+)/.exec(aheadBehind)?.[1] ?? 0);
  renderFileStatus();

  el("statusBranch").textContent = `branch: ${status.branch}`;
}

// --- terminal ---------------------------------------------------------------

const terminalSessions = new Map();
let terminalSeq = 0;
let activeTerminalId = null;
let terminalShells = [];
let selectedTerminalShell = null;

async function loadTerminalShells(prefs) {
  if (api.platform !== "win32") return;
  const result = await api.termShells();
  terminalShells = result.shells;
  const selector = el("terminalShellChoice");
  selector.replaceChildren();
  if (!terminalShells.some(({ id }) => id === "git-bash")) {
    const missing = new Option("Git Bash (no instalado)", "git-bash");
    missing.disabled = true;
    selector.add(missing);
  }
  for (const entry of terminalShells) selector.add(new Option(entry.label, entry.id));
  selectedTerminalShell = terminalShells.find(({ id }) => id === prefs.terminalShell)?.id ?? terminalShells[0].id;
  selector.value = selectedTerminalShell;
  el("terminalShellLabel").classList.remove("hidden");
  selector.classList.remove("hidden");
}

function activeTerminal() {
  return activeTerminalId ? terminalSessions.get(activeTerminalId) ?? null : null;
}

function fitTerminals() {
  activeTerminal()?.terminal.fit();
}

function focusTerminal() {
  const session = activeTerminal();
  if (!session) return;
  requestAnimationFrame(() => {
    session.terminal.fit();
    session.terminal.focus();
  });
}

function setActiveTerminal(id) {
  if (!terminalSessions.has(id)) return;
  activeTerminalId = id;
  document.body.classList.remove("bottom-collapsed");
  el("bottomToggle").textContent = "▾";
  for (const [sessionId, session] of terminalSessions) {
    const active = sessionId === id;
    session.pane.classList.toggle("active", active);
    session.tab.classList.toggle("active", active);
    session.tab.setAttribute("aria-selected", String(active));
  }
  focusTerminal();
}

function createTerminalTab(session) {
  const tab = document.createElement("button");
  tab.type = "button";
  tab.className = "terminal-tab";
  tab.dataset.terminalId = session.id;
  tab.setAttribute("role", "tab");
  tab.setAttribute("aria-selected", "false");
  tab.setAttribute("aria-controls", `terminal-pane-${session.id}`);
  const title = session.shellLabel ? `${session.shellLabel} ${session.index}` : `Terminal ${session.index}`;
  tab.title = title;

  const label = document.createElement("span");
  label.textContent = title;
  const close = document.createElement("span");
  close.className = "terminal-tab-close";
  close.textContent = "×";
  close.title = "Cerrar terminal";
  close.setAttribute("role", "button");
  tab.append(label, close);

  tab.addEventListener("click", (event) => {
    if (event.target.closest(".terminal-tab-close")) {
      event.stopPropagation();
      closeTerminalSession(session.id);
      return;
    }
    setActiveTerminal(session.id);
  });
  return tab;
}

async function createTerminalSession(shellId = selectedTerminalShell) {
  const id = `term-${++terminalSeq}`;
  const pane = document.createElement("div");
  pane.className = "terminal-pane";
  pane.id = `terminal-pane-${id}`;
  pane.dataset.terminalId = id;
  el("terminalHost").append(pane);

  const terminal = createTerminal({
    parent: pane,
    onData: (data) => api.termInput(id, data),
    onResize: (cols, rows) => api.termResize(id, cols, rows),
    onSelection: (text) => { api.copyText(text).catch(() => {}); },
  });
  terminal.setDark(state.dark);

  const session = {
    id, index: terminalSeq, terminal, pane, tab: null,
    shellId,
    shellLabel: terminalShells.find(({ id: candidate }) => candidate === shellId)?.label,
  };
  session.tab = createTerminalTab(session);
  el("terminalTabs").append(session.tab);
  terminalSessions.set(id, session);
  setActiveTerminal(id);

  try {
    const started = await api.termStart(id, terminal.term.cols, terminal.term.rows, shellId);
    if (!started) throw new Error("Abre un proyecto para usar la terminal");
  } catch (error) {
    await closeTerminalSession(id);
    throw error;
  }
  focusTerminal();
  return terminal;
}

async function closeTerminalSession(id) {
  const session = terminalSessions.get(id);
  if (!session) return;
  await api.termClose(id).catch(() => {});
  session.terminal.dispose();
  session.pane.remove();
  session.tab.remove();
  terminalSessions.delete(id);

  if (activeTerminalId === id) {
    activeTerminalId = null;
    const next = [...terminalSessions.keys()].at(-1);
    if (next) setActiveTerminal(next);
  }
}

async function ensureTerminal() {
  const session = activeTerminal();
  if (session) {
    setActiveTerminal(session.id);
    return session.terminal;
  }
  const first = terminalSessions.values().next().value;
  if (first) {
    setActiveTerminal(first.id);
    return first.terminal;
  }
  return createTerminalSession();
}

api.onTermData(({ id, data }) => {
  terminalSessions.get(id)?.terminal.write(data);
});

api.onTermExit(({ id }) => {
  terminalSessions.get(id)?.terminal.write("\r\n[sesión terminada]\r\n");
});

el("terminalHost").addEventListener("mousedown", (event) => {
  if (event.button !== 0) return;
  const pane = event.target.closest?.(".terminal-pane");
  if (!pane) return;
  setActiveTerminal(pane.dataset.terminalId);
});

const QUICK_KEY = "informe.quickCommands";
const DEFAULT_QUICK = [
  { label: "git status", command: "git status --short" },
  { label: "git log", command: "git log --oneline -12" },
  { label: "ramas", command: "git branch" },
  { label: "remotos", command: "git remote -v" },
];

function loadQuickCommands() {
  try {
    const stored = JSON.parse(localStorage.getItem(QUICK_KEY));
    if (Array.isArray(stored) && stored.length) return stored;
  } catch {
    // usar valores por defecto
  }
  return DEFAULT_QUICK.map((item) => ({ ...item }));
}

let quickCommands = loadQuickCommands();

function renderQuickCommands() {
  const box = el("quickCommands");
  box.innerHTML = "";
  for (const item of quickCommands) {
    const node = document.createElement("button");
    node.className = "mini";
    node.textContent = item.label;
    node.title = item.command;
    node.addEventListener("click", async () => {
      try {
        const term = await ensureTerminal();
        api.termInput(activeTerminalId, `${item.command}\r`);
        term.focus();
      } catch (error) {
        setStatus(String(error.message ?? error), "bad");
      }
    });
    box.append(node);
  }
}

el("btnEditCommands").addEventListener("click", () => {
  const panel = el("quickEditor");
  if (panel.classList.contains("hidden")) {
    el("quickEditorText").value = quickCommands.map((item) => `${item.label} | ${item.command}`).join("\n");
    panel.classList.remove("hidden");
    el("quickEditorText").focus();
  } else {
    panel.classList.add("hidden");
  }
});

el("btnSaveCommands").addEventListener("click", () => {
  const lines = el("quickEditorText").value.split("\n").map((line) => line.trim()).filter(Boolean);
  const parsed = lines
    .map((line) => {
      const [label, ...rest] = line.split("|");
      return { label: label.trim(), command: rest.join("|").trim() };
    })
    .filter((item) => item.label && item.command);

  if (parsed.length) {
    quickCommands = parsed;
    localStorage.setItem(QUICK_KEY, JSON.stringify(parsed));
    api.setPrefs({ quickCommands: parsed }).catch(() => {});
  }
  renderQuickCommands();
  el("quickEditor").classList.add("hidden");
});

el("btnCancelCommands").addEventListener("click", () => el("quickEditor").classList.add("hidden"));

renderQuickCommands();

// --- búsqueda en el proyecto ------------------------------------------------

let searchTimer = null;
let searchHistoryCache = null;
const SEARCH_HISTORY_KEY = "informe.searchHistory";
let searchHistoryIndex = -1;

function getHistory() {
  if (Array.isArray(searchHistoryCache)) return searchHistoryCache;
  try {
    return JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY)) ?? [];
  } catch {
    return [];
  }
}

function pushHistory(query) {
  const history = getHistory().filter((entry) => entry !== query);
  history.unshift(query);
  searchHistoryCache = history.slice(0, 10);
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(searchHistoryCache));
  api.setPrefs({ searchHistory: searchHistoryCache }).catch(() => {});
}

function hideSearch() {
  el("searchResults").classList.add("hidden");
  el("searchResults").innerHTML = "";
  el("searchCount").textContent = "";
}

function highlightSnippet(text, query) {
  const escaped = escapeHtml(text);
  const index = escaped.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return escaped;
  return `${escaped.slice(0, index)}<mark>${escaped.slice(index, index + query.length)}</mark>${escaped.slice(index + query.length)}`;
}

async function runSearch(query) {
  state.searchQuery = query;
  const results = await api.search(query);
  state.searchResults = results;
  state.searchIndex = -1;
  renderSearchResults();
}

function renderSearchResults() {
  const box = el("searchResults");
  const results = state.searchResults;
  box.innerHTML = "";
  el("searchCount").textContent = results.length ? `${results.length}` : "0";

  if (!results.length) {
    box.classList.remove("hidden");
    box.innerHTML = '<div class="search-item"><span class="snippet">Sin resultados</span></div>';
    return;
  }

  results.forEach((result, index) => {
    const item = document.createElement("div");
    item.className = "search-item";
    if (index === state.searchIndex) item.classList.add("current");
    item.innerHTML = `<span class="where">${escapeHtml(result.src.split("/").pop())}:${result.line}</span><span class="snippet">${highlightSnippet(result.text, state.searchQuery)}</span>`;
    item.addEventListener("click", () => focusSearchResult(index));
    box.append(item);
  });

  box.classList.remove("hidden");
}

async function focusSearchResult(index) {
  const results = state.searchResults;
  if (!results.length) return;

  state.searchIndex = (index + results.length) % results.length;
  const result = results[state.searchIndex];
  el("searchCount").textContent = `${state.searchIndex + 1}/${results.length}`;

  [...el("searchResults").children].forEach((node, i) => {
    node.classList.toggle("current", i === state.searchIndex);
  });

  pushHistory(state.searchQuery);
  await openFile(result.src, { compile: false });
  state.suppressCursorUntil = Date.now() + 700;
  editor.selectMatch(result.line, state.searchQuery);

  try {
    const blocks = await getBlocks();
    const block = pageBlockFor(blocks, result.src, result.line);
    if (block) revealBlockInPreview(block, blocks);
  } catch {
    // sin compilación
  }

  setStatus(`Coincidencia ${state.searchIndex + 1}/${results.length}: ${result.src}:${result.line}`, "ok");
}

function navigateSearch(delta) {
  if (!state.searchResults.length) return;
  focusSearchResult(state.searchIndex + delta);
}

el("searchInput").addEventListener("input", () => {
  searchHistoryIndex = -1;
  clearTimeout(searchTimer);
  const query = el("searchInput").value.trim();
  if (query.length < 2) {
    hideSearch();
    return;
  }
  searchTimer = setTimeout(() => runSearch(query), 250);
});

el("searchInput").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideSearch();
    el("searchInput").blur();
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    const query = el("searchInput").value.trim();
    if (query.length < 2) return;

    if (!state.searchResults.length || query !== state.searchQuery) {
      clearTimeout(searchTimer);
      runSearch(query).then(() => focusSearchResult(event.shiftKey ? -1 : 0));
      return;
    }
    navigateSearch(event.shiftKey ? -1 : 1);
    return;
  }

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;

    if (event.altKey) {
      const history = getHistory();
      if (!history.length) return;
      if (event.key === "ArrowUp") searchHistoryIndex = Math.min(searchHistoryIndex + 1, history.length - 1);
      else searchHistoryIndex = Math.max(searchHistoryIndex - 1, -1);
      el("searchInput").value = searchHistoryIndex >= 0 ? history[searchHistoryIndex] : "";
      el("searchInput").dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }

    navigateSearch(delta);
  }
});

el("searchPrev").addEventListener("click", () => navigateSearch(-1));
el("searchNext").addEventListener("click", () => navigateSearch(1));

el("searchReplaceToggle").addEventListener("click", () => {
  const hidden = el("replaceRow").classList.toggle("hidden");
  document.querySelector(".preview-pane").classList.toggle("replace-open", !hidden);
  if (!hidden) el("replaceInput").focus();
  else hideSearch();
});

el("btnReplaceAll").addEventListener("click", async () => {
  const query = el("searchInput").value.trim();
  const replacement = el("replaceInput").value;
  if (query.length < 2) {
    setStatus("Escribe al menos dos caracteres para buscar", "bad");
    return;
  }

  const ok = window.confirm(`¿Reemplazar "${query}" por "${replacement}" en todos los capítulos?`);
  if (!ok) return;

  const result = await api.replaceAll(query, replacement);
  setStatus(`${result.count} reemplazo(s) en ${result.files.length} archivo(s)`, result.count ? "ok" : "");

  if (result.count) {
    const current = state.file;
    state.file = null;
    if (current) await openFile(current);
    await compileNow();
    await refreshGit();
    hideSearch();
  }
});

// --- índice del documento ---------------------------------------------------

function switchSidebar(tab) {
  state.sidebarTab = tab;
  el("tabFiles").classList.toggle("active", tab === "files");
  el("tabOutline").classList.toggle("active", tab === "outline");
  el("fileTree").classList.toggle("hidden", tab !== "files");
  el("outlinePane").classList.toggle("hidden", tab !== "outline");
  el("sideActions").classList.toggle("hidden", tab !== "files");
  api.setPrefs({ sidebarTab: tab }).catch(() => {});
  if (tab === "outline") refreshOutline();
}

async function refreshOutline() {
  if (!state.info) return;
  state.outline = await withTimeout(api.outline(state.file).catch(() => []), 2000, []);
  await renderOutline();
}

async function renderOutline() {
  const list = el("outlineList");
  if (!list) return;

  const filter = el("outlineFilter").value.trim().toLowerCase();
  const blocks = state.documentMode === "focus" ? [] : await getBlocks();

  // Índice por archivo y línea: antes cada título recorría y ordenaba todos
  // los bloques del libro (costoso con cientos de títulos).
  const byFile = new Map();
  for (const block of blocks) {
    if (!byFile.has(block.src)) byFile.set(block.src, []);
    byFile.get(block.src).push(block);
  }
  for (const list of byFile.values()) list.sort((a, b) => a.line - b.line);
  const firstAtOrAfter = (file, line) => {
    const list = byFile.get(file) ?? [];
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].line < line) lo = mid + 1;
      else hi = mid;
    }
    return list[lo] ?? null;
  };

  const pageFor = (entry) => firstAtOrAfter(entry.file, entry.line)?.page ?? null;

  list.innerHTML = "";
  let lastFile = null;

  for (const entry of state.outline) {
    const haystack = entry.text.toLowerCase();
    if (filter && !haystack.includes(filter)) continue;

    if (entry.file !== lastFile) {
      lastFile = entry.file;
      const label = document.createElement("div");
      label.className = "outline-file";
      label.textContent = entry.file.split("/").pop();
      list.append(label);
    }

    const row = document.createElement("div");
    row.className = `outline-item lvl${entry.depth}`;
    row.dataset.key = `${entry.file}:${entry.line}`;
    if (state.outlineActive === row.dataset.key) row.classList.add("active");

    const text = document.createElement("span");
    text.className = "outline-text";
    text.textContent = entry.text;

    row.append(text);

    if (entry.generated) {
      const badge = document.createElement("span");
      badge.className = "outline-auto";
      badge.textContent = "auto";
      row.append(badge);
    }

    const page = pageFor(entry);
    const pageNode = document.createElement("span");
    pageNode.className = "outline-page";
    pageNode.textContent = page ? `p. ${page}` : "";
    row.append(pageNode);

    row.addEventListener("click", () => gotoOutline(entry));
    list.append(row);
  }

  if (!list.children.length) {
    list.innerHTML = '<div class="outline-item">Sin títulos</div>';
  }
}

function scrollPreviewToPage(page) {
  const pageEl = document.querySelector(`.page[data-page="${page}"]`);
  if (!pageEl) return;
  const preview = el("preview");
  preview.scrollTop = Math.max(0, pageTop(preview, pageEl) - 12);
}

async function gotoOutline(entry) {
  if (entry.generated) {
    scrollPreviewToPage(entry.page);
    return;
  }

  state.suppressCursorUntil = Date.now() + 900;
  if (entry.file !== state.file) await openFile(entry.file, { compile: false });
  editor.revealLine(entry.line);
  editor.flashLine(entry.line);
  state.outlineActive = `${entry.file}:${entry.line}`;
  updateOutlineClasses();

  if (state.documentMode === "focus") { syncFocusToCursor(entry.line); return; }

  try {
    const blocks = await getBlocks();
    const block = pageBlockFor(blocks, entry.file, entry.line);
    if (block) revealBlockInPreview(block, blocks);
  } catch {
    // sin compilación
  }
}

function updateOutlineClasses() {
  for (const node of document.querySelectorAll(".outline-item")) {
    node.classList.toggle("active", node.dataset.key === state.outlineActive);
  }
}

function setActiveFromBlock(block) {
  if (!block) return;
  const headings = state.outline.filter(
    (entry) => entry.file === block.src && entry.line <= block.line,
  );
  if (!headings.length) return;
  const heading = headings.reduce((best, current) => (current.line > best.line ? current : best), headings[0]);
  state.outlineActive = `${heading.file}:${heading.line}`;
  updateOutlineClasses();
}

function setActiveFromLine(line) {
  if (!state.file) return;
  const headings = state.outline.filter((entry) => entry.file === state.file && entry.line <= line);
  if (!headings.length) return;
  const heading = headings.reduce((best, current) => (current.line > best.line ? current : best), headings[0]);
  state.outlineActive = `${heading.file}:${heading.line}`;
  updateOutlineClasses();
}

// --- preview <-> editor -----------------------------------------------------

async function editImage(rel) {
  await openImageEditor({
    api,
    rel,
    editor,
    setStatus,
    onSaved: async () => {
      await refreshTree();
      await compileNow();
      setStatus("Imagen actualizada", "ok");
    },
  });
}

function editPreviewImage(block) {
  if (block.src && block.src !== state.file) return openFile(block.src).then(() => editPreviewImage(block));
  const lines = editor.getValue().split("\n");
  const first = Math.max(0, block.line - 1);
  let last = first;
  if (/<(?:div|p)\b/i.test(lines[first] ?? "")) {
    while (last < Math.min(lines.length - 1, first + 30) && !/<\/(?:div|p)>/i.test(lines[last])) last += 1;
  } else {
    // El metadato apunta al inicio del párrafo. La imagen puede estar en una
    // línea posterior del mismo párrafo (por ejemplo, texto seguido de <img>
    // sin línea en blanco). Incluir todo el párrafo permite localizar la tag.
    while (last < Math.min(lines.length - 1, first + 80) && (lines[last + 1] ?? "").trim() !== "") last += 1;
  }
  const virtualBlock = document.createElement("div");
  virtualBlock.dataset.start = String(first + 1);
  virtualBlock.dataset.end = String(last + 1);
  const image = document.createElement("img");
  virtualBlock.append(image);
  openHtmlImageEditor({ editor, image, block: virtualBlock, setStatus, onSaved: async () => {
    await saveNow();
    await compileNow();
    setStatus("Imagen actualizada", "ok");
  } });
}

function showBlockMarker(pageEl, block, pageBlocks, pageHeight, ratio = null) {
  if (!pageEl || !pageHeight) return;
  const marker = pageEl.querySelector(".block-marker");
  if (!marker) return;

  const sorted = [...pageBlocks].sort((a, b) => a.y - b.y);
  const isBox = block.kind === "figure" || block.kind === "table";

  marker.className = "block-marker";
  marker.style.left = "";
  marker.style.right = "";
  marker.style.width = "";

  if (block.kind === "figure" && block.img) {
    const images = pageEl.imageBoxes ?? [];
    const closest = [...images].sort((a, b) => Math.abs(a.y - block.y) - Math.abs(b.y - block.y))[0];
    if (!closest || Math.abs(closest.y - block.y) > 120) {
      marker.classList.remove("visible");
      return;
    }
    marker.classList.add("box", "image-box");
    marker.style.left = `${closest.x / Number(pageEl.dataset.width) * 100}%`;
    marker.style.right = "auto";
    marker.style.width = `${closest.width / Number(pageEl.dataset.width) * 100}%`;
    marker.style.top = `${closest.y / pageHeight * 100}%`;
    marker.style.height = `${closest.height / pageHeight * 100}%`;
  } else if (isBox) {
    const next = sorted.find((entry) => entry.y > block.y + 2);
    const heightPt = Math.max(14, next ? next.y - block.y : 30);
    marker.classList.add("box");
    marker.style.top = `${Math.max(0, (block.y / pageHeight) * 100)}%`;
    marker.style.height = `${Math.min(100, (heightPt / pageHeight) * 100)}%`;
  } else {
    // Resaltado tenue de una línea, como en el editor de Markdown.
    let heightPt = 15;
    let topPt = block.y;
    if (block.kind === "heading") {
      const next = sorted.find((entry) => entry.y > block.y + 2);
      const delta = next ? next.y - block.y : 24;
      topPt = block.y + (block.level === 1 ? 2 : 6);
      heightPt = Math.max(14, Math.min(36, delta + 4));
    }
    marker.classList.add("text");
    marker.style.top = `${Math.max(0, (topPt / pageHeight) * 100)}%`;
    marker.style.height = `${Math.min(100, (heightPt / pageHeight) * 100)}%`;

    if (ratio != null) {
      const width = 13;
      const left = Math.min(100 - width, Math.max(0, ratio * 100 - width / 2));
      marker.style.left = `${left}%`;
      marker.style.right = "auto";
      marker.style.width = `${width}%`;
    } else {
      marker.style.left = "6%";
      marker.style.right = "6%";
    }
  }

  marker.classList.add("visible");

  clearTimeout(marker._timer);
  marker._timer = setTimeout(() => marker.classList.remove("visible"), 3000);
}

/** Bloque bajo el puntero; si título y párrafo comparten altura, gana el título. */
function blockAtPoint(pageBlocks, y) {
  if (!pageBlocks.length) return null;
  const sorted = [...pageBlocks].sort((a, b) => a.y - b.y);
  const above = sorted.filter((block) => block.y <= y + 6);
  if (!above.length) return sorted[0];

  const maxY = above[above.length - 1].y;
  const tied = above.filter((block) => Math.abs(block.y - maxY) < 1.5);
  if (tied.length > 1 && y <= maxY + 20) {
    const heading = tied.find((block) => block.kind === "heading");
    if (heading) return heading;
  }
  return tied[tied.length - 1] ?? above[above.length - 1];
}

/** El índice se descarga una vez por compilación, no en cada cursor/clic. */
async function getBlocks() {
  if (state.blocksCache) return state.blocksCache;
  if (state.blocksTask) return state.blocksTask;
  const task = (async () => {
    const response = await withTimeout(api.blocks().catch(() => null), 8000, null);
    const blocks = Array.isArray(response) ? response : response?.blocks ?? [];
    if (state.blocksTask === task) {
      if (response) state.blocksCache = blocks;
      state.blocksTask = null;
    }
    return blocks;
  })();
  state.blocksTask = task;
  return task;
}

function pageBlockFor(blocks, src, line) {
  const candidates = blocks.filter((block) => block.src === src && block.line <= line);
  if (!candidates.length) return null;
  return candidates.reduce((best, current) => (current.line > best.line ? current : best), candidates[0]);
}

function pagesOf(blocks, page) {
  return blocks.filter((block) => block.page === page);
}

function revealBlockInPreview(block, blocks) {
  if (!block) return;
  const pageEl = document.querySelector(`.page[data-page="${block.page}"]`);
  if (!pageEl) return;

  const pageHeight = Number(pageEl.dataset.height) || 841.89;
  showBlockMarker(pageEl, block, pagesOf(blocks, block.page), pageHeight);

  const preview = el("preview");
  const top = pageTop(preview, pageEl);
  if (top < preview.scrollTop || top > preview.scrollTop + preview.clientHeight - 40) {
    preview.scrollTop = Math.max(0, top - 12);
  }
}

let selectionSyncId = 0;
function clearWordMarkers() {
  for (const node of el("preview").querySelectorAll(".pdf-word-marker")) node.remove();
}

function paintPdfWords(match) {
  clearWordMarkers();
  for (const word of match) {
    const page = el("preview").querySelector(`.page[data-page="${word.page}"]`);
    if (!page) continue;
    const marker = document.createElement("span");
    marker.className = "pdf-word-marker";
    const width = Number(page.dataset.width) || 595.28;
    const height = Number(page.dataset.height) || 841.89;
    marker.style.left = `${word.x1 / width * 100}%`;
    marker.style.top = `${word.y1 / height * 100}%`;
    marker.style.width = `${(word.x2 - word.x1) / width * 100}%`;
    marker.style.height = `${(word.y2 - word.y1) / height * 100}%`;
    page.append(marker);
  }
}

async function highlightClickedHeading(block) {
  const request = ++selectionSyncId;
  try {
    const words = await api.words({ from: block.page, to: block.page });
    if (request !== selectionSyncId) return;
    const nearby = words.filter((word) => word.page === block.page && word.y1 >= block.y - 10 && word.y1 <= block.y + 15 && word.x1 >= block.x - 5);
    const first = nearby[0];
    if (!first) return;
    paintPdfWords(nearby.filter((word) => Math.abs(word.y1 - first.y1) < 3));
    el("preview").querySelector(`.page[data-page="${block.page}"] .block-marker`)?.classList.remove("visible");
  } catch { /* sin coordenadas de texto: conservar el marcador de bloque */ }
}

async function showSelectedWords(selection, block, blocks) {
  const request = ++selectionSyncId;
  clearWordMarkers();
  if (!block || !selection.text.trim() || state.dirty) return;
  const ordered = [...blocks].sort((a, b) => a.page - b.page || a.y - b.y);
  const next = ordered.find((item) => item.page > block.page || (item.page === block.page && item.y > block.y + 2));
  const lastPage = Number(el("preview").lastElementChild?.dataset.page) || block.page;
  try {
    const endPage = next?.page ?? lastPage;
    const words = await api.words({ from: block.page, to: endPage });
    if (request !== selectionSyncId || state.dirty) return;
    const bounds = { startPage: block.page, startY: block.y, endPage,
      endY: next?.y ?? Infinity };
    // La selección puede repetirse en un párrafo: elegir su aparición en el
    // Markdown desde la primera línea del bloque, no la primera en el PDF.
    const blockStart = editor.getLineStart(block.line);
    const sourcePrefix = editor.getRange(blockStart, selection.from);
    const needle = selection.text.trim();
    const count = sourcePrefix.split(needle).length - 1;
    const match = findPdfPhrase(words, needle, bounds, count);
    // Nunca pintamos un bloque aproximado si no encontramos las palabras.
    paintPdfWords(match);
    if (match.length) el("preview").querySelector(`.page[data-page="${block.page}"] .block-marker`)?.classList.remove("visible");
  } catch {
    // Poppler no está disponible en todas las instalaciones; no fabricar
    // posiciones aproximadas cuando la extracción precisa falla.
  }
}

function scheduleCursorSync(line) {
  if (Date.now() < state.suppressCursorUntil) return;
  clearTimeout(state.cursorTimer);
  state.cursorTimer = setTimeout(() => state.documentMode === "focus" ? syncFocusToCursor(line) : syncPreviewToCursor(line), state.documentMode === "focus" ? 70 : 220);
}

async function syncPreviewToCursor(line) {
  if (!state.file || Date.now() < state.suppressCursorUntil) return;
  try {
    const blocks = await getBlocks();
    const selection = editor.getSelectionInfo();
    const block = pageBlockFor(blocks, state.file, selection.from !== selection.to ? selection.line : line);
    if (block) {
      revealBlockInPreview(block, blocks);
      if (selection.from !== selection.to) {
        el("preview").querySelector(`.page[data-page="${block.page}"] .block-marker`)?.classList.remove("visible");
        showSelectedWords(selection, block, blocks);
      }
      else { ++selectionSyncId; clearWordMarkers(); }
    }
    setActiveFromLine(line);
  } catch {
    // todavía no hay compilación
  }
}

function tableDirectiveLine(line) {
  const lines = editor.getValue().split("\n");
  const index = Math.max(0, Math.min(lines.length - 1, line - 1));
  if (/^\s*:::table\{/.test(lines[index])) return index;
  for (let i = index; i >= Math.max(0, index - 40); i -= 1) {
    if (/^\s*:::table\{/.test(lines[i])) return i;
  }
  return null;
}

function copyTableStyle(line) {
  const index = tableDirectiveLine(line);
  if (index == null) {
    setStatus("No encontré la tabla", "bad");
    return;
  }
  const match = editor.getValue().split("\n")[index].match(/widths="([^"]*)"/);
  const widths = match ? match[1].split(/[\s,]+/).filter(Boolean).map(Number) : [];
  if (!widths.length) {
    setStatus("La tabla no tiene anchos definidos", "bad");
    return;
  }
  setStyle({ kind: "table", widths });
  setStatus("Estilo de tabla copiado", "ok");
}

function pasteTableStyle(line) {
  const style = getStyle();
  if (!style || style.kind !== "table") {
    setStatus("No hay un estilo de tabla copiado", "bad");
    return;
  }
  const index = tableDirectiveLine(line);
  if (index == null) {
    setStatus("No encontré la tabla", "bad");
    return;
  }

  const text = editor.getValue();
  const lines = text.split("\n");
  const columns = (lines[index].match(/widths="([^"]*)"/)?.[1] ?? "").split(/[\s,]+/).filter(Boolean).length || style.widths.length;
  const values = Array.from({ length: columns }, (_, i) => style.widths[i % style.widths.length] ?? 1);
  const total = values.reduce((sum, value) => sum + value, 0) || 1;
  const widths = values.map((value) => Math.round((value / total) * 100)).join(" ");

  lines[index] = lines[index].includes("widths=")
    ? lines[index].replace(/widths="[^"]*"/, `widths="${widths}"`)
    : lines[index].replace(/\}$/, ` widths="${widths}"}`);

  editor.replaceLines(index + 1, index + 1, lines[index]);
  setStatus("Estilo de tabla pegado", "ok");
}

function tableForTarget(target) {
  const text = editor.getValue();
  const direct = tableAtLine(text, target.line);
  if (direct) return direct;
  const tables = findTables(text);
  const start = Math.max(0, target.line - 1);
  return tables.find((table) => start >= table.start && start <= table.end)
    ?? tables.find((table) => table.start >= start)
    ?? null;
}

function withDirectiveAlign(line, align) {
  const attr = /\s+align\s*=\s*(?:"[^"]*"|'[^']*'|[^\s}]+)/;
  if (align === "left") return line.replace(attr, "");
  if (attr.test(line)) return line.replace(attr, ` align="${align}"`);
  return line.replace(/\}\s*$/, ` align="${align}"}`);
}

async function applyTableAlign(target, align) {
  const value = normalizeTableAlign(align);
  if (target.src && target.src !== state.file) {
    await openBlockSource(target);
    editor.revealLine(target.line);
  }
  const table = tableForTarget(target);
  if (!table || !value) {
    setStatus("No encontré la tabla", "bad");
    return;
  }

  const text = editor.getValue();
  if (table.html) {
    const html = text.slice(table.from, table.to);
    editor.replaceRange(table.from, table.to, setHtmlTableAlign(html, value));
  } else {
    const lines = text.split("\n");
    if (/^\s*:::table\s*\{/.test(lines[table.start] ?? "")) {
      editor.replaceLines(table.start + 1, table.start + 1, withDirectiveAlign(lines[table.start], value));
    } else {
      const meta = table.start < lines.length && /^<!-- mdpdf-table:([^\s<>]+) -->$/.test(lines[table.start].trim())
        ? table.start
        : null;
      const attrs = { ...table.attrs, align: value };
      const comment = `<!-- mdpdf-table:${encodeURIComponent(JSON.stringify(attrs))} -->`;
      if (meta != null) editor.replaceLines(meta + 1, meta + 1, comment);
      else {
        const at = editor.getLineStart(table.start + 1);
        editor.replaceRange(at, at, `${comment}\n\n`);
      }
    }
  }

  await persistTableChange(value === "center" ? "Tabla centrada" : `Tabla alineada a la ${value === "left" ? "izquierda" : "derecha"}`);
}

async function persistTableChange(message) {
  setStatus(message, "ok");
  const saved = await saveNow({ compile: false });
  if (state.documentMode === "focus" || state.viewMode === "reading") await refreshReading();
  if (saved) scheduleCompile(60);
}

function copyImageStyle(rel) {
  const attrs = findImageAttrs(editor.getValue(), rel);
  setStyle({
    kind: "image",
    width: attrs.width ?? 70,
    height: attrs.height ?? "",
    fit: attrs.fit ?? "contain",
  });
  setStatus("Estilo de imagen copiado", "ok");
}

function pasteImageStyle(rel) {
  const style = getStyle();
  if (!style || style.kind !== "image") {
    setStatus("No hay un estilo de imagen copiado", "bad");
    return;
  }
  setImageAttrs(editor, rel, { width: style.width, height: style.height, fit: style.fit });
  setStatus("Estilo de imagen pegado", "ok");
}

async function openBlockSource(target) {
  if (!target.src || target.src === state.file) return;
  // Si el bloque pertenece al libro ya compilado, saltar al Markdown no
  // necesita otro render: el PDF de la derecha sigue siendo el mismo.
  const inBook = (state.info?.chapters ?? []).includes(target.src);
  await openFile(target.src, { compile: !inBook });
}

el("preview").addEventListener("contextmenu", async (event) => {
  const pageEl = event.target.closest(".page");
  if (!pageEl || !pageEl.dataset.page) return;
  event.preventDefault();

  const index = Number(pageEl.dataset.page);
  const pageHeight = Number(pageEl.dataset.height) || 841.89;
  const rect = pageEl.getBoundingClientRect();
  const y = ((event.clientY - rect.top) / rect.height) * pageHeight;

  let target = null;
  try {
    const blocks = await getBlocks();
    const pageBlocks = pagesOf(blocks, index).sort((a, b) => a.y - b.y);
    target = blockAtPoint(pageBlocks, y);
  } catch {
    target = null;
  }
  if (!target) return;

  const items = [];

  if (target.kind === "figure" && target.img) {
    const rel = target.img.replace(/^\//, "");
    items.push({ label: "Editar imagen…", action: () => editPreviewImage(target) });
    items.push({ label: "Copiar estilo (ancho/alto/ajuste)", action: () => copyImageStyle(rel) });
    items.push({ label: "Pegar estilo", action: () => pasteImageStyle(rel) });
  } else if (target.kind === "table") {
    items.push({
      label: "Editar tabla…",
      action: async () => {
        await openBlockSource(target);
        editor.revealLine(target.line);
        openTableEditor({
          editor,
          setStatus,
          line: target.line,
          onSaved: () => persistTableChange("Tabla actualizada"),
        });
      },
    });
    items.push({ label: "Copiar estilo (anchos)", action: () => copyTableStyle(target.line) });
    items.push({ label: "Pegar estilo (anchos)", action: () => pasteTableStyle(target.line) });
    items.push({ separator: true });
    items.push({ label: "Centrar tabla", action: () => applyTableAlign(target, "center") });
    items.push({ label: "Alinear tabla a la izquierda", action: () => applyTableAlign(target, "left") });
    items.push({ label: "Alinear tabla a la derecha", action: () => applyTableAlign(target, "right") });
  } else {
    items.push({
      label: "Ir al código",
      action: () => {
        editor.revealLine(target.line);
        editor.flashLine(target.line);
      },
    });
  }

  openContextMenu(event.clientX, event.clientY, items);
});

el("preview").addEventListener("click", async (event) => {
  const pageEl = event.target.closest(".page");
  if (!pageEl || !pageEl.dataset.page) return;

  const index = Number(pageEl.dataset.page);
  const pageHeight = Number(pageEl.dataset.height) || 841.89;
  const rect = pageEl.getBoundingClientRect();
  const y = ((event.clientY - rect.top) / rect.height) * pageHeight;
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));

  try {
    const blocks = await getBlocks();
    const pageBlocks = pagesOf(blocks, index).sort((a, b) => a.y - b.y);
    if (!pageBlocks.length) {
      setStatus("Esta página no tiene bloques de texto", "bad");
      return;
    }

    const target = blockAtPoint(pageBlocks, y);

    showBlockMarker(pageEl, target, pageBlocks, pageHeight, ratio);
    if (target?.kind === "heading") highlightClickedHeading(target);
    state.suppressCursorUntil = Date.now() + 800;

    if (target.kind === "figure" && target.img) {
      if (event.detail < 2) {
        await openBlockSource(target);
        editor.revealLine(target.line);
        return;
      }
      editPreviewImage(target);
      return;
    }

    if (target.kind === "table") {
      if (event.detail < 2) {
        await openBlockSource(target);
        editor.revealLine(target.line);
        return;
      }
      await openBlockSource(target);
      editor.revealLine(target.line);
      openTableEditor({
        editor,
        setStatus,
        line: target.line,
        onSaved: () => persistTableChange("Tabla actualizada"),
      });
      return;
    }

    await openBlockSource(target);
    editor.revealLine(target.line);
    editor.flashLine(target.line);
    setActiveFromBlock(target);
    setStatus(`Origen: ${target.src}:${target.line}`, "ok");
  } catch (error) {
    setStatus(String(error.message ?? error), "bad");
  }
});

// --- cambios externos (git checkout, otro editor) ---------------------------

api.onFsChanged(async () => {
  if (!state.info) return;
  if (Date.now() - (state.lastSaveAt ?? 0) < 1000) return;

  if (state.file && !state.dirty) {
    try {
      const { content } = await api.readFile(state.file);
      if (content !== editor.getValue()) {
        state.loading = true;
        editor.setValue(content);
        state.loading = false;
        setSaveState("recargado desde disco");
      }
    } catch {
      // el archivo pudo desaparecer
    }
  }

  if (state.info) {
    const info = await api.info().catch(() => null);
    if (info) state.info = info;
    await updateDocumentThemeLabel().catch(() => {});
  }

  await refreshTree();
  if ((state.viewMode === "reading" || state.documentMode === "focus") && !state.readEdit) await refreshReading();
  scheduleCompile(80);
  refreshGit();
});

// --- utilidades -------------------------------------------------------------

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// --- eventos ----------------------------------------------------------------

el("zoomIn").addEventListener("click", () => setZoom(state.zoom + 0.1));
el("zoomOut").addEventListener("click", () => setZoom(state.zoom - 0.1));
el("zoomReset").addEventListener("click", () => setZoom(1));
el("zoomFit").addEventListener("click", () => {
  const preview = el("preview");
  const available = Math.max(240, preview.clientWidth - 36);
  setZoom(available / zoomBase());
});

el("btnToggleSearch").addEventListener("click", () => {
  const collapsed = document.body.classList.toggle("search-collapsed");
  el("btnToggleSearch").textContent = collapsed ? "⌄" : "⌃";
  el("btnToggleSearch").title = collapsed ? "Mostrar buscador" : "Ocultar buscador";
  if (collapsed) hideSearch();
});

el("btnPreviewOnly").addEventListener("click", () => {
  const only = document.body.classList.toggle("preview-only");
  el("btnPreviewOnly").textContent = only ? "◧" : "⛶";
  el("btnPreviewOnly").title = only ? "Mostrar editor" : "Solo vista previa";
  requestAnimationFrame(() => {
    applyZoom();
    fitTerminals();
  });
});

el("preview").addEventListener(
  "wheel",
  (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    setZoom(state.zoom + (event.deltaY < 0 ? 0.1 : -0.1));
  },
  { passive: false },
);

document.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    setZoom(state.zoom + 0.1);
  } else if (event.key === "-") {
    event.preventDefault();
    setZoom(state.zoom - 0.1);
  } else if (event.key === "0") {
    event.preventDefault();
    setZoom(1);
  }
});

el("tabFiles").addEventListener("click", () => switchSidebar("files"));
el("tabOutline").addEventListener("click", () => switchSidebar("outline"));
el("outlineFilter").addEventListener("input", () => renderOutline());

el("btnTheme").addEventListener("click", () => {
  state.dark = !state.dark;
  localStorage.setItem("informe.dark", state.dark ? "1" : "0");
  api.setPrefs({ dark: state.dark }).catch(() => {});
  applyTheme();
});

async function exportPdf() {
  await saveNow();
  setStatus("Exportando PDF…");
  try {
    const result = await api.exportPdf(state.file);
    if (!result) {
      setStatus("Exportación cancelada");
      return;
    }
    if (!result.ok) {
      showError(result.error || "No se pudo exportar");
      setStatus("Error al exportar", "bad");
      return;
    }
    state.lastPdf = result.output;
    setStatus(`PDF exportado: ${result.output} (${result.pages} páginas)`, "ok");
  } catch (error) {
    setStatus(error.message, "bad");
  }
}

async function exportAs(kind) {
  el("exportMenu").classList.add("hidden");
  if (kind === "pdf") {
    await exportPdf();
    return;
  }

  await saveNow();
  setStatus(`Exportando ${kind === "html" ? "HTML" : "Word"}…`);

  try {
    const result = kind === "html" ? await api.exportHtml() : await api.exportDocx();
    if (!result) {
      setStatus("Exportación cancelada");
      return;
    }
    if (!result.ok) {
      setStatus(result.error || "No se pudo exportar", "bad");
      return;
    }
    setStatus(`Exportado: ${result.output}`, "ok");
    await api.openPath(result.output);
  } catch (error) {
    setStatus(String(error.message ?? error), "bad");
  }
}

el("btnExport").addEventListener("click", exportPdf);

el("btnExportMenu").addEventListener("click", (event) => {
  event.stopPropagation();
  el("exportMenu").classList.toggle("hidden");
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".export-group")) el("exportMenu").classList.add("hidden");
});

document.querySelectorAll("[data-export]").forEach((node) => {
  node.addEventListener("click", () => exportAs(node.dataset.export));
});

async function handleMenuAction(action) {
  try {
    if (action === "open-project") await openProjectDialog();
    else if (action === "save") {
      await saveNow();
      setStatus("Guardado", "ok");
    } else if (action === "compile") {
      await saveNow();
      await compileNow();
    } else if (action === "export-pdf") await exportPdf();
    else if (action === "export-html") await exportAs("html");
    else if (action === "export-docx") await exportAs("docx");
    else if (action === "view-code") await setViewMode("code");
    else if (action === "view-reading") await setViewMode("reading");
    else if (action === "toggle-theme") el("btnTheme").click();
    else if (["undo", "redo", "cut", "copy", "paste", "select-all"].includes(action)) await api.edit(action);
    else if (action === "zoom-in") setZoom(state.zoom + 0.1);
    else if (action === "zoom-out") setZoom(state.zoom - 0.1);
    else if (action === "zoom-reset") setZoom(1);
    else if (action === "devtools") await api.toggleDevTools();
    else if (action === "about") await api.about();
    else if (action === "quit") await api.quit();
  } catch (error) {
    setStatus(String(error.message ?? error), "bad");
  }
}

api.onMenuAction(handleMenuAction);

function closeAppMenu() {
  el("appMenuList").classList.add("hidden");
  el("btnAppMenu").setAttribute("aria-expanded", "false");
}

document.querySelectorAll("#appMenuList .menu-section").forEach((section) => {
  section.addEventListener("toggle", () => {
    if (!section.open) return;
    document.querySelectorAll("#appMenuList .menu-section").forEach((other) => {
      if (other !== section) other.open = false;
    });
  });
});

el("btnAppMenu").addEventListener("click", (event) => {
  event.stopPropagation();
  const hidden = el("appMenuList").classList.toggle("hidden");
  el("btnAppMenu").setAttribute("aria-expanded", String(!hidden));
});

document.querySelectorAll("[data-menu]").forEach((node) => {
  node.addEventListener("click", () => {
    closeAppMenu();
    handleMenuAction(node.dataset.menu);
  });
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".app-menu")) closeAppMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !el("appMenuList").classList.contains("hidden")) {
    closeAppMenu();
    el("btnAppMenu").focus();
  }
});

el("btnOpenPdf").addEventListener("click", async () => {
  const target = state.lastPdf;
  if (!target) {
    setStatus("Exporta el PDF primero", "bad");
    return;
  }
  await api.openPath(target);
});

el("btnNewTerminal").addEventListener("click", () => {
  createTerminalSession().catch((error) => setStatus(String(error.message ?? error), "bad"));
});

el("terminalShellChoice").addEventListener("change", async (event) => {
  selectedTerminalShell = event.target.value;
  try {
    await api.setPrefs({ terminalShell: selectedTerminalShell });
    setStatus(`Nuevas terminales: ${terminalShells.find(({ id }) => id === selectedTerminalShell)?.label}`, "ok");
  } catch (error) {
    setStatus(String(error.message ?? error), "bad");
  }
});

el("bottomToggle").addEventListener("click", async () => {
  const collapsed = document.body.classList.toggle("bottom-collapsed");
  el("bottomToggle").textContent = collapsed ? "▴" : "▾";
  if (!collapsed) {
    try {
      await ensureTerminal();
      focusTerminal();
    } catch (error) {
      setStatus(String(error.message ?? error), "bad");
    }
  }
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveNow();
  }
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    saveNow().then(compileNow);
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
    event.preventDefault();
    el("searchInput").focus();
    el("searchInput").select();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") {
    event.preventDefault();
    openProjectDialog();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "e") {
    event.preventDefault();
    exportPdf();
  }
  if ((event.ctrlKey || event.metaKey) && event.key === "1") {
    event.preventDefault();
    setViewMode("code");
  }
  if ((event.ctrlKey || event.metaKey) && event.key === "2") {
    event.preventDefault();
    setViewMode("reading");
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "l") {
    event.preventDefault();
    el("btnTheme").click();
  }
  if (event.key === "F5") {
    event.preventDefault();
    saveNow().then(compileNow);
  }
  if (event.key === "F12") {
    event.preventDefault();
    api.toggleDevTools();
  }
});

// barra lateral: ancho y visibilidad
const SIDEBAR_MIN = 160;
const SIDEBAR_MAX = 420;

function sidebarMaxWidth() {
  return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, window.innerWidth - 420));
}

function setSidebarWidth(width, persist = true) {
  const value = Math.max(SIDEBAR_MIN, Math.min(sidebarMaxWidth(), Math.round(width)));
  state.sidebarWidth = value;
  document.documentElement.style.setProperty("--sidebar", `${value}px`);
  if (persist) api.setPrefs({ sidebarWidth: value }).catch(() => {});
}

function setSidebarCollapsed(collapsed, persist = true) {
  state.sidebarCollapsed = Boolean(collapsed);
  document.body.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
  if (!state.sidebarCollapsed) setSidebarWidth(state.sidebarWidth, false);
  const button = el("btnSidebarToggle");
  if (button) {
    const label = state.sidebarCollapsed ? "Mostrar panel de archivos" : "Ocultar panel de archivos";
    button.textContent = state.sidebarCollapsed ? "›" : "‹";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-expanded", String(!state.sidebarCollapsed));
  }
  if (persist) api.setPrefs({ sidebarCollapsed: state.sidebarCollapsed }).catch(() => {});
  requestAnimationFrame(() => applyZoom());
}

el("btnSidebarToggle").addEventListener("click", () => {
  setSidebarCollapsed(!state.sidebarCollapsed);
});

const sidebarResizer = el("sidebarResizer");
sidebarResizer.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || event.target.closest("#btnSidebarToggle") || state.sidebarCollapsed) return;
  event.preventDefault();
  sidebarResizer.setPointerCapture(event.pointerId);
  document.body.classList.add("sidebar-resizing");
  const startX = event.clientX;
  const startWidth = el("sidebar").getBoundingClientRect().width;

  const onMove = (moveEvent) => {
    setSidebarWidth(startWidth + moveEvent.clientX - startX, false);
  };

  const finish = () => {
    sidebarResizer.removeEventListener("pointermove", onMove);
    sidebarResizer.removeEventListener("pointerup", finish);
    sidebarResizer.removeEventListener("pointercancel", finish);
    document.body.classList.remove("sidebar-resizing");
    api.setPrefs({ sidebarWidth: state.sidebarWidth }).catch(() => {});
    applyZoom();
  };

  sidebarResizer.addEventListener("pointermove", onMove);
  sidebarResizer.addEventListener("pointerup", finish);
  sidebarResizer.addEventListener("pointercancel", finish);
});

// divisor editor / preview
const divider = el("divider");
const editorPane = el("editorPane");

divider.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  divider.setPointerCapture(event.pointerId);
  document.body.classList.add("divider-resizing");
  const startX = event.clientX;
  const startWidth = editorPane.getBoundingClientRect().width;

  const onMove = (moveEvent) => {
    const sidebarWidth = state.sidebarCollapsed ? 0 : state.sidebarWidth;
    const maxWidth = Math.max(340, window.innerWidth - sidebarWidth - 225);
    const width = Math.max(340, Math.min(maxWidth, startWidth + moveEvent.clientX - startX));
    // Solo cambia el ancho del editor; el workspace conserva su altura.
    editorPane.style.flex = `0 0 ${width}px`;
  };

  const finish = () => {
    divider.removeEventListener("pointermove", onMove);
    divider.removeEventListener("pointerup", finish);
    divider.removeEventListener("pointercancel", finish);
    divider.removeEventListener("lostpointercapture", finish);
    document.body.classList.remove("divider-resizing");
    fitTerminals();
    applyZoom();
  };

  divider.addEventListener("pointermove", onMove);
  divider.addEventListener("pointerup", finish);
  divider.addEventListener("pointercancel", finish);
  divider.addEventListener("lostpointercapture", finish);
});

window.addEventListener("resize", () => {
  if (!state.sidebarCollapsed) setSidebarWidth(state.sidebarWidth, false);
  fitTerminals();
  applyZoom();
});

// --- arranque ---------------------------------------------------------------

window.__editor = editor;

(async () => {
  const prefs = await api.getPrefs().catch(() => ({}));
  await loadTerminalShells(prefs).catch((error) => setStatus(String(error.message ?? error), "bad"));
  // El tema oscuro es el predeterminado; una elección explícita local prevalece.
  if (Array.isArray(prefs.quickCommands) && prefs.quickCommands.length) {
    quickCommands = prefs.quickCommands;
    renderQuickCommands();
  }
  if (Array.isArray(prefs.searchHistory)) searchHistoryCache = prefs.searchHistory;
  if (typeof prefs.zoom === "number") state.zoom = Math.min(3, Math.max(0.4, prefs.zoom));
  if (prefs.sidebarTab === "outline" || prefs.sidebarTab === "files") state.sidebarTab = prefs.sidebarTab;
  if (prefs.viewMode === "reading" || prefs.viewMode === "code") state.viewMode = prefs.viewMode;
  if (typeof prefs.sidebarWidth === "number") setSidebarWidth(prefs.sidebarWidth, false);
  if (typeof prefs.sidebarCollapsed === "boolean") setSidebarCollapsed(prefs.sidebarCollapsed, false);
  applyTheme();
  applyZoom();
  switchSidebar(state.sidebarTab);
  renderFileStatus();

  setStatus("Cargando…");
  try {
    const info = await api.info();
    if (info) {
      await openProject(info);
      setStatus("Listo");
    } else {
      placeholderPages("Abre una carpeta o crea un archivo Markdown");
      setStatus("Sin proyecto abierto");
    }
  } catch (error) {
    setStatus(error.message, "bad");
    placeholderPages("No se pudo cargar el proyecto");
  }
})();
