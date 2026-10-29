// ============================================================================
//  Editor de tablas estilo Word: manejadores + en los bordes, iconos,
//  selección con punteros, edición de celdas y estilos.
// ============================================================================

import { closeModal, openModal } from "./editors.js";
import { getStyle, openContextMenu, setStyle } from "./style-clipboard.js";
import { normalizeTableAlign } from "../../core/table-align.mjs";

const ALIGN_LABEL = { left: "izquierda", center: "centro", right: "derecha" };

const ICONS = {
  merge: '<path d="M4 4h7v7H4z"/><path d="M13 13h7v7h-7z"/><path d="M11 11l2 2"/>',
  split: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M12 4v16"/>',
  equalCols: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M9 5v14M15 5v14"/>',
  equalRows: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 10h18M3 14h18"/>',
  autoHeight: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M12 7v10M9.5 14.5L12 17l2.5-2.5M9.5 9.5L12 7l2.5 2.5"/>',
  autoWidth: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M7 12h10M14.5 9.5L17 12l-2.5 2.5M9.5 9.5L7 12l2.5 2.5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="1"/><path d="M5 15V5h10"/>',
  paste: '<rect x="6" y="4" width="12" height="16" rx="1"/><path d="M9 4h6v3H9z"/>',
  alignLeft: '<path d="M4 6h16M4 12h10M4 18h16"/>',
  alignCenter: '<path d="M4 6h16M7 12h10M4 18h16"/>',
  alignRight: '<path d="M4 6h16M10 12h10M4 18h16"/>',
  modeGeneral: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 12h16"/>',
  modeColumn: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M12 4v16"/>',
  modeCell: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 12h16M12 4v16"/><circle cx="8" cy="8" r="1.7"/>',
  addRow: '<path d="M12 5v14M5 12h14"/>',
  addCol: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M5 7h14M9 7V5h6v2M7 7l1 12h8l1-12"/>',
  edit: '<path d="M4 20h4l10-10-4-4L4 16z"/><path d="M14 6l4 4"/>',
};

function svgIcon(name) {
  const span = document.createElement("span");
  span.className = "t-icon";
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ""}</svg>`;
  return span;
}

function iconButton(name, title, onClick, className = "") {
  const node = document.createElement("button");
  node.className = `icon-btn table-icon ${className}`.trim();
  node.title = title;
  node.setAttribute("aria-label", title);
  node.append(svgIcon(name));
  node.addEventListener("click", onClick);
  return node;
}

function button(label, className = "") {
  const node = document.createElement("button");
  node.textContent = label;
  if (className) node.className = className;
  return node;
}

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

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function parseMergeSpec(raw) {
  const merges = new Map();
  if (!raw) return merges;
  for (const token of String(raw).split(";").map((t) => t.trim()).filter(Boolean)) {
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
  if (!raw) return cells;
  for (const token of String(raw).split(";").map((t) => t.trim()).filter(Boolean)) {
    const [origin, value] = token.split(":");
    const at = origin?.match(/^r(\d+)c(\d+)$/i);
    if (!at || !["left", "center", "right"].includes(value)) continue;
    cells.set(`${at[1]}-${at[2]}`, value);
  }
  return cells;
}

function normalizeWidths(values) {
  const total = values.reduce((sum, value) => sum + value, 0) || 1;
  return values.map((value) => Math.round((value / total) * 1000) / 10);
}

export function findTables(text) {
  const lines = text.split("\n");
  const tables = [];

  for (let i = 0; i < lines.length; i += 1) {
      // Tolera una llave extra de versiones anteriores (y la corrige al guardar).
    const match = lines[i].match(/^\s*:::table\s*\{([^}]*)\}\s*\}?\s*$/);
    if (!match) {
      if (!/^\s*\|/.test(lines[i]) || !/^\s*\|?\s*:?-{2,}:?\s*\|/.test(lines[i + 1] ?? "")) continue;
      const header = splitRow(lines[i]);
      const separator = splitRow(lines[i + 1]);
      if (header.length !== separator.length || !separator.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
      let end = i + 1;
      while (/^\s*\|/.test(lines[end + 1] ?? "")) end += 1;
      const metaLine = /^<!-- mdpdf-table:([^\s<>]+) -->$/.exec(lines[i - 2]?.trim() ?? "") && !lines[i - 1]?.trim() ? i - 2 :
        /^<!-- mdpdf-table:([^\s<>]+) -->$/.exec(lines[i - 1]?.trim() ?? "") ? i - 1 : i;
      let attrs = {};
      if (metaLine !== i) {
        try { attrs = JSON.parse(decodeURIComponent(/mdpdf-table:([^\s<>]+)/.exec(lines[metaLine])[1])); } catch { /* metadata opcional */ }
      }
      tables.push({ start: metaLine, end, attrs, header, body: lines.slice(i + 2, end + 1).map(splitRow),
        aligns: separator.map((cell) => cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : "left") });
      i = end;
      continue;
    }

    let end = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (/^\s*:::\s*$/.test(lines[j])) {
        end = j;
        break;
      }
    }
    if (end === -1) continue;

    const attrs = parseAttrs(match[1]);
    const rows = [];
    let aligns = [];

    for (let j = i + 1; j < end; j += 1) {
      if (!/^\s*\|/.test(lines[j])) continue;
      const cells = splitRow(lines[j]);
      if (!rows.length) rows.push(cells);
      else if (rows.length === 1 && cells.every((c) => /^:?-{2,}:?$/.test(c))) {
        aligns = cells.map((c) =>
          c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left",
        );
      } else rows.push(cells);
    }

    tables.push({ start: i, end, attrs, header: rows[0] ?? [], body: rows.slice(1), aligns });
    i = end;
  }
  for (const match of text.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)) {
    const line = text.slice(0, match.index).split("\n").length - 1;
    const end = line + match[0].split("\n").length - 1;
    const doc = new DOMParser().parseFromString(match[0], "text/html");
    const node = doc.querySelector("table");
    const rows = [];
    const originalCells = [];
    const mergeSpecs = [];
    for (const [r, row] of [...node?.rows ?? []].entries()) {
      rows[r] ??= [];
      let c = 0;
      for (const cell of row.cells) {
        while (rows[r][c] !== undefined) c += 1;
        const height = Math.max(1, cell.rowSpan);
        const width = Math.max(1, cell.colSpan);
        rows[r][c] = cell.textContent.trim();
        originalCells[r] ??= [];
        originalCells[r][c] = cell;
        if (height > 1 || width > 1) mergeSpecs.push(`r${r + 1}c${c + 1}:${height}x${width}`);
        for (let rr = r; rr < r + height; rr += 1) {
          rows[rr] ??= [];
          for (let cc = c; cc < c + width; cc += 1) if (rr !== r || cc !== c) rows[rr][cc] = "";
        }
        c += width;
      }
    }
    if (!rows.length) continue;
    const count = Math.max(...rows.map((row) => row.length));
    rows.forEach((row) => { while (row.length < count) row.push(""); });
    const aligns = Array.from({ length: count }, (_, c) => node.rows[0]?.cells[c]?.getAttribute("align") ?? "left");
    tables.push({ start: line, end, attrs: { caption: node.querySelector("caption")?.textContent.trim() ?? "", id: node.id, merges: mergeSpecs.join(";") },
      header: rows[0], body: rows.slice(1), aligns, html: true,
      from: match.index, to: match.index + match[0].length, originalCells, original: node });
  }
  return tables.sort((a, b) => a.start - b.start);
}

export function tableAtLine(text, line, offset = null) {
  const tables = findTables(text);
  if (!tables.length) return null;
  if (offset != null) return tables.find((t) => t.html && t.from === offset) ?? null;
  return tables.find((t) => line >= t.start + 1 && line <= t.end + 1) ?? null;
}

export function openTableEditor({ editor, setStatus, onSaved, line = null, offset = null }) {
  const text = editor.getValue();
  const tables = findTables(text);
  if (!tables.length) {
    setStatus("No hay tablas editables en este archivo", "bad");
    return;
  }

  const cursor = line ?? editor.getCursorLine();
  const table = offset != null
    ? tables.find((t) => t.html && t.from === offset)
    : tables.find((t) => cursor >= t.start + 1 && cursor <= t.end + 1);
  if (!table) {
    setStatus("No se encontró la tabla seleccionada", "bad");
    return;
  }

  const columns = Math.max(1, table.header.length || table.body[0]?.length || 1);
  const rawWidths = String(table.attrs.widths ?? "")
    .split(/[\s,]+/)
    .filter(Boolean);
  const autoWidths = rawWidths.length > 0 && rawWidths.every((value) => value === "auto");

  const widths = normalizeWidths(
    autoWidths
      ? Array.from({ length: columns }, () => 1)
      : rawWidths.length
        ? rawWidths.map((w) => Number(String(w).replace("%", "")) || 0)
        : Array.from({ length: columns }, () => 100 / columns),
  );
  while (widths.length < columns) widths.push(100 / columns);

  const heights = String(table.attrs.heights ?? "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .slice(0, table.body.length + 1);

  const grid = [table.header, ...table.body].map((row) => {
    const copy = row.slice(0, columns);
    while (copy.length < columns) copy.push("");
    return copy;
  });

  const state = {
    grid,
    widths: widths.slice(0, columns),
    autoWidths,
    heights: Array.from({ length: grid.length }, (_, i) => heights[i] ?? ""),
    colAligns: Array.from({ length: columns }, (_, i) => table.aligns[i] ?? "left"),
    cellAligns: parseCellSpec(table.attrs.cells),
    merges: parseMergeSpec(table.attrs.merges),
    alignMode: "column",
    generalAlign: "left",
    selection: null,
    anchor: null,
    dragging: false,
    editing: null,
    caption: table.attrs.caption ?? "",
    id: table.attrs.id ?? "",
    activeColumn: 0,
    style: table.attrs.style ?? "grid",
    align: normalizeTableAlign(table.attrs.align) ?? "left",
  };
  const initialWidths = [...state.widths];
  const initialAutoWidths = state.autoWidths;

  const rowCount = () => state.grid.length;
  const colCount = () => state.grid[0].length;
  const key = (r, c) => `${r + 1}-${c + 1}`;

  function coveredSet() {
    const covered = new Set();
    for (const [k, merge] of state.merges) {
      const [row, col] = k.split("-").map(Number);
      for (let r = row; r < row + merge.rowspan; r += 1) {
        for (let c = col; c < col + merge.colspan; c += 1) {
          if (r === row && c === col) continue;
          covered.add(`${r}-${c}`);
        }
      }
    }
    return covered;
  }

  function originOf(r, c) {
    for (const [k, merge] of state.merges) {
      const [row, col] = k.split("-").map(Number);
      if (r >= row && r < row + merge.rowspan && c >= col && c < col + merge.colspan) {
        return { r: row - 1, c: col - 1 };
      }
    }
    return { r, c };
  }

  function effectiveAlign(r, c) {
    return state.cellAligns.get(key(r, c)) ?? state.colAligns[c] ?? "left";
  }

  function normalizedSelection() {
    const selection = state.selection;
    if (!selection) return null;
    return {
      r1: Math.min(selection.r1, selection.r2),
      c1: Math.min(selection.c1, selection.c2),
      r2: Math.max(selection.r1, selection.r2),
      c2: Math.max(selection.c1, selection.c2),
    };
  }

  // --- estructura -----------------------------------------------------------

  const body = document.createElement("div");
  body.className = "table-layout";

  const meta = document.createElement("div");
  meta.className = "table-meta";
  const advanced = document.createElement("details");
  advanced.className = "table-advanced";
  const advancedTitle = document.createElement("summary");
  advancedTitle.textContent = "Opciones avanzadas";
  const captionLabel = document.createElement("label");
  captionLabel.textContent = "Pie de tabla";
  const captionInput = document.createElement("input");
  captionInput.value = state.caption;
  captionInput.placeholder = "Descripción de la tabla";
  captionLabel.append(captionInput);

  const idLabel = document.createElement("label");
  idLabel.textContent = "Referencia (para @tbl:comparacion)";
  const idInput = document.createElement("input");
  idInput.value = state.id;
  idInput.placeholder = "tbl:comparacion";
  idLabel.append(idInput);
  meta.append(captionLabel, idLabel);
  advanced.append(advancedTitle, meta);

  const tools = document.createElement("div");
  tools.className = "table-tools";

  const mergeBtn = iconButton("merge", "Combinar celdas", () => mergeSelection());
  const splitBtn = iconButton("split", "Dividir celdas", () => splitSelection());
  const equalColsBtn = iconButton("equalCols", "Igualar columnas", () => equalizeColumns());
  const equalRowsBtn = iconButton("equalRows", "Igualar filas", () => equalizeRows());
  const autoHeightBtn = iconButton("autoHeight", "Alto automático", () => {
    state.heights = state.heights.map(() => "");
    renderHeights();
  });
  const autoWidthBtn = iconButton("autoWidth", "Ancho automático", () => {
    state.autoWidths = true;
    state.widths = normalizeWidths(state.widths.map(() => 1));
    renderWidths();
    renderPreview();
  });
  const copyBtn = iconButton("copy", "Copiar estilo (anchos)", copyTableStyle);
  const pasteBtn = iconButton("paste", "Pegar estilo (anchos)", pasteTableStyle);

  const selectionInfo = document.createElement("span");
  selectionInfo.className = "hint selection-info";

  const sep1 = document.createElement("span");
  sep1.className = "tool-sep";
  const sep2 = document.createElement("span");
  sep2.className = "tool-sep";

  const addRowBtn = button("+ Agregar fila", "mini");
  addRowBtn.addEventListener("click", () => insertRow(rowCount()));
  const addColBtn = button("+ Agregar columna", "mini");
  addColBtn.addEventListener("click", () => insertColumn(colCount()));
  const deleteRowBtn = button("Eliminar fila", "mini");
  deleteRowBtn.addEventListener("click", () => deleteRow(Math.max(1, state.anchor?.r ?? rowCount() - 1)));
  const deleteColBtn = button("Eliminar columna", "mini");
  deleteColBtn.addEventListener("click", () => deleteColumn(state.activeColumn));

  tools.append(
    addRowBtn,
    addColBtn,
    deleteRowBtn,
    deleteColBtn,
    mergeBtn,
    splitBtn,
    sep1,
    equalColsBtn,
    equalRowsBtn,
    autoHeightBtn,
    autoWidthBtn,
    sep2,
    copyBtn,
    pasteBtn,
    selectionInfo,
  );

  const alignTools = document.createElement("div");
  alignTools.className = "table-tools";
  const modeGroup = document.createElement("div");
  modeGroup.className = "seg icon-seg";
  const modeButtons = {};
  for (const [mode, icon, title] of [
    ["general", "modeGeneral", "Alineación general (toda la tabla)"],
    ["column", "modeColumn", "Alineación por columna"],
    ["cell", "modeCell", "Alineación por celda"],
  ]) {
    const node = iconButton(icon, title, () => {
      state.alignMode = mode;
      renderAlignControls();
    });
    modeButtons[mode] = node;
    modeGroup.append(node);
  }

  const valueGroup = document.createElement("div");
  valueGroup.className = "seg icon-seg";
  const valueButtons = {};
  for (const [align, icon] of [
    ["left", "alignLeft"],
    ["center", "alignCenter"],
    ["right", "alignRight"],
  ]) {
    const node = iconButton(icon, `Alinear ${ALIGN_LABEL[align]}`, () => applyAlign(align));
    valueButtons[align] = node;
    valueGroup.append(node);
  }

  const alignHint = document.createElement("span");
  alignHint.className = "hint";
  alignHint.textContent = "Alineación de columna 1";

  alignTools.append(modeGroup, valueGroup, alignHint);

  const columnAlignRow = document.createElement("div");
  columnAlignRow.className = "width-row";

  const widthTitle = document.createElement("div");
  widthTitle.className = "tool-label";
  widthTitle.textContent = "Ancho de columnas";

  const bar = document.createElement("div");
  bar.className = "bar";

  const widthRow = document.createElement("div");
  widthRow.className = "width-row";

  const preview = document.createElement("div");
  preview.className = "table-preview";
  const previewTable = document.createElement("table");
  preview.append(previewTable);

  const heightTitle = document.createElement("div");
  heightTitle.className = "tool-label";
  heightTitle.textContent = "Alto de fila (vacío = automático)";

  const heightRow = document.createElement("div");
  heightRow.className = "row-heights";

  const styleRow = document.createElement("div");
  styleRow.className = "table-style-row";
  const styleLabel = document.createElement("span");
  styleLabel.className = "tool-label";
  styleLabel.textContent = "Estilo de la tabla";
  const styleButtons = {};
  for (const [value, label] of [["grid", "Bordes"], ["horizontal", "Líneas horizontales"], ["none", "Sin bordes"]]) {
    const control = button(label, "mini");
    control.addEventListener("click", () => {
      state.style = value;
      renderPreview();
    });
    styleButtons[value] = control;
    styleRow.append(control);
  }
  styleRow.prepend(styleLabel);

  body.append(
    tools,
    alignTools,
    styleRow,
    widthTitle,
    bar,
    widthRow,
    preview,
    advanced,
  );
  advanced.append(heightTitle, heightRow, columnAlignRow);

  // --- render ---------------------------------------------------------------

  function renderAll() {
    renderWidths();
    renderHeights();
    renderAlignControls();
    renderPreview();
  }

  function renderWidths() {
    previewTable.style.setProperty("--table-content-width", `${Math.max(650, state.widths.length * 135)}px`);
    bar.innerHTML = "";
    const equal = 100 / state.widths.length;

    state.widths.forEach((width, index) => {
      const value = state.autoWidths ? equal : width;
      const seg = document.createElement("div");
      seg.className = `bar-seg${state.autoWidths ? " auto" : ""}`;
      seg.style.flex = `0 0 ${value}%`;
      seg.textContent = state.autoWidths ? "auto" : `${Math.round(value)}%`;
      bar.append(seg);

      if (!state.autoWidths && index < state.widths.length - 1) {
        const acc = state.widths.slice(0, index + 1).reduce((sum, v) => sum + v, 0);
        const handle = document.createElement("div");
        handle.className = "bar-handle";
        handle.style.left = `${acc}%`;
        handle.addEventListener("pointerdown", (event) => startBarDrag(event, index));
        bar.append(handle);
      }
    });

    widthRow.innerHTML = "";
    state.widths.forEach((width, index) => {
      const cell = document.createElement("div");
      cell.className = "width-cell";
      const label = document.createElement("span");
      label.textContent = `Columna ${index + 1}`;
      const input = document.createElement("input");
      input.type = "text";
      input.inputMode = "decimal";
      input.value = `${Math.round(width)}%`;
      input.title = "Introduce el porcentaje; las otras columnas se ajustan automáticamente";
      input.setAttribute("aria-label", `Ancho de columna ${index + 1} en porcentaje`);
      input.addEventListener("change", () => {
        if (!/^\d+(?:[.,]\d+)?%?$/.test(input.value.trim())) {
          setStatus("Escribe un porcentaje válido, por ejemplo 40%", "bad");
          input.value = `${Math.round(state.widths[index])}%`;
          return;
        }
        state.autoWidths = false;
        const requested = Math.min(100 - 5 * (state.widths.length - 1), Math.max(5, Number(input.value.replace("%", "").replace(",", "."))));
        const others = state.widths.reduce((sum, value, i) => sum + (i === index ? 0 : value), 0);
        state.widths = state.widths.map((value, i) => i === index ? requested : (100 - requested) * value / (others || 1));
        if (others === 0) state.widths = normalizeWidths(state.widths);
        renderWidths();
        renderPreview();
      });
      cell.append(label, input);
      widthRow.append(cell);
    });

    autoWidthBtn.classList.toggle("active", state.autoWidths);
  }

  function startBarDrag(event, index) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidths = [...state.widths];
    const total = bar.getBoundingClientRect().width || 1;

    const onMove = (moveEvent) => {
      const delta = Math.max(5 - startWidths[index], Math.min(startWidths[index + 1] - 5, ((moveEvent.clientX - startX) / total) * 100));
      const values = [...startWidths];
      values[index] = startWidths[index] + delta;
      values[index + 1] = startWidths[index + 1] - delta;
      state.widths = normalizeWidths(values);
      renderWidths();
      renderPreview();
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function startPreviewResize(event, index) {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidths = [...state.widths];
    const total = previewTable.getBoundingClientRect().width || 1;

    const onMove = (moveEvent) => {
      const delta = Math.max(5 - startWidths[index], Math.min(startWidths[index + 1] - 5, ((moveEvent.clientX - startX) / total) * 100));
      const values = [...startWidths];
      values[index] = startWidths[index] + delta;
      values[index + 1] = startWidths[index + 1] - delta;
      state.autoWidths = false;
      state.widths = normalizeWidths(values);
      renderWidths();
      renderPreview();
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function renderHeights() {
    heightRow.innerHTML = "";
    state.heights.forEach((value, index) => {
      const cell = document.createElement("div");
      cell.className = "row-height";
      const label = document.createElement("span");
      label.textContent = index === 0 ? "Cab." : `F${index}`;
      const input = document.createElement("input");
      input.value = value;
      input.placeholder = "auto";
      input.addEventListener("input", () => {
        state.heights[index] = input.value.trim();
      });
      cell.append(label, input);
      heightRow.append(cell);
    });
  }

  function renderAlignControls() {
    alignHint.textContent = state.alignMode === "column" ? `Alineación de columna ${state.activeColumn + 1}` : state.alignMode === "cell" ? "Alineación de celdas seleccionadas" : "Alineación de toda la tabla";
    for (const [mode, node] of Object.entries(modeButtons)) {
      node.classList.toggle("active", state.alignMode === mode);
    }

    valueGroup.style.display = "flex";
    for (const [align, node] of Object.entries(valueButtons)) {
      node.classList.toggle("active", (state.alignMode === "general" ? state.generalAlign : state.alignMode === "column" ? state.colAligns[state.activeColumn] : state.cellAligns.get(key(state.anchor?.r ?? 0, state.anchor?.c ?? 0))) === align);
    }

    columnAlignRow.style.display = state.alignMode === "column" ? "grid" : "none";
    columnAlignRow.innerHTML = "";
    if (state.alignMode === "column") {
      state.colAligns.forEach((align, index) => {
        const cell = document.createElement("div");
        cell.className = "width-cell";
        const label = document.createElement("span");
        label.textContent = `C${index + 1}`;
        const select = document.createElement("select");
        select.className = "select";
        select.style.flex = "1";
        for (const value of ["left", "center", "right"]) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = ALIGN_LABEL[value];
          option.selected = value === align;
          select.append(option);
        }
        select.addEventListener("change", () => {
          state.colAligns[index] = select.value;
          state.activeColumn = index;
          renderAlignControls();
          renderPreview();
        });
        cell.append(label, select);
        columnAlignRow.append(cell);
      });
    }
  }

  function applyAlign(align) {
    if (state.alignMode === "general") {
      state.generalAlign = align;
      state.colAligns = state.colAligns.map(() => align);
      state.cellAligns.clear();
    } else if (state.alignMode === "cell") {
      const rect = normalizedSelection();
      if (!rect) {
        setStatus("Selecciona celdas para alinear", "bad");
        return;
      }
      for (let r = rect.r1; r <= rect.r2; r += 1) {
        for (let c = rect.c1; c <= rect.c2; c += 1) {
          const origin = originOf(r, c);
          if (origin.r !== r || origin.c !== c) continue;
          state.cellAligns.set(key(r, c), align);
        }
      }
    } else {
      state.colAligns[state.activeColumn] = align;
      for (const cellKey of state.cellAligns.keys()) {
        if (Number(cellKey.split("-")[1]) === state.activeColumn + 1) state.cellAligns.delete(cellKey);
      }
    }
    renderAlignControls();
    renderPreview();
  }

  function updateSelectionClasses() {
    const rect = normalizedSelection();
    renderAlignControls();
    for (const node of previewTable.querySelectorAll("th, td")) {
      const r = Number(node.dataset.r);
      const c = Number(node.dataset.c);
      const inside = rect && r >= rect.r1 && r <= rect.r2 && c >= rect.c1 && c <= rect.c2;
      node.classList.toggle("selected", Boolean(inside));
    }
    updateSelectionInfo();
  }

  function updateSelectionInfo() {
    const rect = normalizedSelection();
    deleteRowBtn.disabled = rowCount() <= 2;
    deleteColBtn.disabled = colCount() <= 1;
    if (!rect) {
      selectionInfo.textContent = "";
      mergeBtn.disabled = true;
      splitBtn.disabled = true;
      return;
    }
    const rows = rect.r2 - rect.r1 + 1;
    const cols = rect.c2 - rect.c1 + 1;
    selectionInfo.textContent = `${rows} × ${cols}`;
    mergeBtn.disabled = rows * cols < 2;
    splitBtn.disabled = !state.merges.has(key(rect.r1, rect.c1));
  }

  function renderPreview() {
    previewTable.dataset.style = state.style;
    for (const [style, control] of Object.entries(styleButtons)) control.classList.toggle("active", style === state.style);
    const covered = coveredSet();
    const colgroup = document.createElement("colgroup");
    const equal = 100 / state.widths.length;
    state.widths.forEach((width) => {
      const col = document.createElement("col");
      col.style.width = `${state.autoWidths ? equal : width}%`;
      colgroup.append(col);
    });

    const rect = normalizedSelection();
    const inSelection = (r, c) => rect && r >= rect.r1 && r <= rect.r2 && c >= rect.c1 && c <= rect.c2;

    const thead = document.createElement("thead");
    const tbody = document.createElement("tbody");

    state.grid.forEach((row, r) => {
      const tr = document.createElement("tr");
      if (/^\d+(?:\.\d+)?mm$/.test(state.heights[r])) tr.style.height = state.heights[r];
      row.forEach((cellText, c) => {
        const k = key(r, c);
        if (covered.has(k)) return;

        const cellNode = document.createElement(r === 0 ? "th" : "td");
        const merge = state.merges.get(k);
        if (merge) {
          if (merge.colspan > 1) cellNode.colSpan = merge.colspan;
          if (merge.rowspan > 1) cellNode.rowSpan = merge.rowspan;
        }

        const text = document.createElement("div");
        text.className = "cell-text";
        text.textContent = cellText;
        cellNode.append(text);

        cellNode.style.textAlign = effectiveAlign(r, c);
        cellNode.dataset.r = String(r);
        cellNode.dataset.c = String(c);
        if (inSelection(r, c)) cellNode.classList.add("selected");

        cellNode.addEventListener("pointerdown", (event) => {
          if (state.editing) return;
          const box = cellNode.getBoundingClientRect();
          if (c < colCount() - 1 && box.right - event.clientX <= 10) {
            startPreviewResize(event, c);
            return;
          }
          startSelection(event, r, c);
        });

        cellNode.addEventListener("mousemove", (event) => {
          const box = cellNode.getBoundingClientRect();
          cellNode.style.cursor =
            c < colCount() - 1 && box.right - event.clientX <= 10 ? "col-resize" : "cell";
        });

        cellNode.addEventListener("dblclick", () => startEditing(cellNode, r, c));

        if (c === 0) {
          const rowHandle = document.createElement("span");
          rowHandle.className = "table-row-handle";
          rowHandle.title = `Arrastrar para cambiar alto de fila ${r + 1}`;
          rowHandle.addEventListener("pointerdown", (event) => startRowResize(event, r, cellNode));
          cellNode.append(rowHandle);
        }

        cellNode.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          const origin = originOf(r, c);
          openCellMenu(event.clientX, event.clientY, origin.r, origin.c);
        });

        tr.append(cellNode);
      });
      (r === 0 ? thead : tbody).append(tr);
    });

    previewTable.innerHTML = "";
    previewTable.append(colgroup, thead, tbody);
    updateSelectionInfo();
  }

  function startSelection(event, r, c) {
    const origin = originOf(r, c);
    event.preventDefault();
    state.dragging = true;

    if (event.shiftKey && state.anchor) {
      state.selection = { r1: state.anchor.r, c1: state.anchor.c, r2: origin.r, c2: origin.c };
      updateSelectionClasses();
      return;
    }

    state.anchor = { r: origin.r, c: origin.c };
    state.activeColumn = origin.c;
    state.selection = { r1: origin.r, c1: origin.c, r2: origin.r, c2: origin.c };
    updateSelectionClasses();

    const cellUnder = (x, y) => {
      for (const node of document.elementsFromPoint(x, y)) {
        if (node.closest && previewTable.contains(node) && node.matches("th, td")) return node;
      }
      return null;
    };

    const onMove = (moveEvent) => {
      const cellNode = cellUnder(moveEvent.clientX, moveEvent.clientY);
      if (!cellNode) return;
      const rr = Number(cellNode.dataset.r);
      const cc = Number(cellNode.dataset.c);
      const o = originOf(rr, cc);
      state.selection = { r1: state.anchor.r, c1: state.anchor.c, r2: o.r, c2: o.c };
      updateSelectionClasses();
    };
    const onUp = () => {
      state.dragging = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function startRowResize(event, row, cell) {
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const startHeight = cell.closest("tr").getBoundingClientRect().height;
    const onMove = (move) => {
      const px = Math.max(22, startHeight + move.clientY - startY);
      state.heights[row] = `${Math.round(px * 25.4 / 96 * 10) / 10}mm`;
      renderHeights();
      previewTable.rows[row].style.height = `${px}px`;
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      renderPreview();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function startEditing(cellNode, r, c) {
    const text = cellNode.querySelector(".cell-text");
    if (!text) return;

    state.editing = { r, c };
    text.contentEditable = "true";
    text.classList.add("editing");
    text.focus();

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(text);
    selection.removeAllRanges();
    selection.addRange(range);

    const finish = (commit) => {
      if (!state.editing) return;
      if (commit) state.grid[r][c] = text.textContent ?? "";
      else text.textContent = state.grid[r][c];
      text.contentEditable = "false";
      text.classList.remove("editing");
      state.editing = null;
      window.getSelection()?.removeAllRanges();
    };

    text.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
      event.stopPropagation();
    });
    text.addEventListener("blur", () => finish(true), { once: true });
  }

  // --- acciones -------------------------------------------------------------

  function insertRow(index) {
    state.grid.splice(index, 0, Array.from({ length: colCount() }, () => ""));
    state.heights.splice(index, 0, "");
    state.merges.clear();
    state.cellAligns.clear();
    renderAll();
  }

  function insertColumn(index) {
    state.grid.forEach((row) => row.splice(index, 0, ""));
    const values = [...state.widths];
    values.splice(index, 0, 10);
    state.widths = normalizeWidths(values);
    state.colAligns.splice(index, 0, "left");
    state.merges.clear();
    state.cellAligns.clear();
    renderAll();
  }

  function deleteRow(index) {
    if (rowCount() <= 2) {
      setStatus("La tabla necesita al menos una fila de datos", "bad");
      return;
    }
    state.grid.splice(index, 1);
    state.heights.splice(index, 1);
    state.merges.clear();
    state.cellAligns.clear();
    renderAll();
  }

  function deleteColumn(index) {
    if (colCount() <= 1) {
      setStatus("La tabla necesita al menos una columna", "bad");
      return;
    }
    state.grid.forEach((row) => row.splice(index, 1));
    state.widths = normalizeWidths(state.widths.filter((_, i) => i !== index));
    state.colAligns.splice(index, 1);
    state.merges.clear();
    state.cellAligns.clear();
    renderAll();
  }

  function equalizeColumns() {
    state.autoWidths = false;
    state.widths = normalizeWidths(state.widths.map(() => 1));
    renderWidths();
    renderPreview();
  }

  function equalizeRows() {
    state.heights = state.heights.map(() => "10mm");
    renderHeights();
  }

  function mergeSelection() {
    const rect = normalizedSelection();
    if (!rect || (rect.r1 === rect.r2 && rect.c1 === rect.c2)) {
      setStatus("Selecciona al menos dos celdas para combinar", "bad");
      return;
    }

    for (const [k, merge] of [...state.merges]) {
      const [row, col] = k.split("-").map(Number);
      const r = row - 1;
      const c = col - 1;
      const overlaps =
        r <= rect.r2 && r + merge.rowspan - 1 >= rect.r1 && c <= rect.c2 && c + merge.colspan - 1 >= rect.c1;
      if (overlaps) state.merges.delete(k);
    }

    state.merges.set(key(rect.r1, rect.c1), {
      rowspan: rect.r2 - rect.r1 + 1,
      colspan: rect.c2 - rect.c1 + 1,
    });
    renderPreview();
  }

  function splitSelection() {
    const rect = normalizedSelection();
    if (!rect) return;
    const k = key(rect.r1, rect.c1);
    if (!state.merges.has(k)) {
      setStatus("Esa celda no está combinada", "bad");
      return;
    }
    state.merges.delete(k);
    renderPreview();
  }

  function copyTableStyle() {
    setStyle({ kind: "table", widths: [...state.widths], autoWidths: state.autoWidths });
    setStatus("Estilo de tabla copiado", "ok");
  }

  function pasteTableStyle() {
    const style = getStyle();
    if (!style || style.kind !== "table") {
      setStatus("No hay un estilo de tabla copiado", "bad");
      return;
    }
    if (style.autoWidths) {
      state.autoWidths = true;
    } else {
      const target = state.widths.length;
      const values = Array.from({ length: target }, (_, i) => style.widths[i % style.widths.length] ?? 1);
      state.widths = normalizeWidths(values);
      state.autoWidths = false;
    }
    renderWidths();
    renderPreview();
    setStatus("Estilo de tabla pegado", "ok");
  }

  function openCellMenu(x, y, r, c) {
    openContextMenu(x, y, [
      { label: "Agregar fila arriba", action: () => insertRow(r) },
      { label: "Agregar fila abajo", action: () => insertRow(r + 1) },
      { label: "Agregar columna a la izquierda", action: () => insertColumn(c) },
      { label: "Agregar columna a la derecha", action: () => insertColumn(c + 1) },
      { separator: true },
      { label: "Eliminar fila", action: () => deleteRow(r), disabled: rowCount() <= 2 },
      { label: "Eliminar columna", action: () => deleteColumn(c), disabled: colCount() <= 1 },
      { separator: true },
      { label: "Combinar celdas", action: mergeSelection },
      { label: "Dividir celdas", action: splitSelection },
      { separator: true },
      { label: "Copiar estilo (anchos)", action: copyTableStyle },
      { label: "Pegar estilo (anchos)", action: pasteTableStyle },
    ]);
  }

  preview.addEventListener("contextmenu", (event) => {
    if (event.target.closest("th, td")) return;
    event.preventDefault();
    openCellMenu(event.clientX, event.clientY, 0, 0);
  });

  // --- guardar --------------------------------------------------------------

  function buildBlock() {
    const covered = coveredSet();
    const cellText = (value) => String(value ?? "").replace(/\|/g, "\\|");

    const renderRow = (row, r) =>
      `| ${row
        .map((value, c) => (covered.has(key(r, c)) ? "" : cellText(value)))
        .join(" | ")} |`;

    const separator = `|${state.colAligns
      .map((align) => (align === "center" ? ":---:" : align === "right" ? "---:" : ":---"))
      .join("|")}|`;

    const merges = [...state.merges]
      .map(([k, merge]) => {
        const [row, col] = k.split("-");
        return `r${row}c${col}:${merge.rowspan}x${merge.colspan}`;
      })
      .join(";");

    const cells = [...state.cellAligns]
      .map(([k, align]) => {
        const [row, col] = k.split("-");
        return `r${row}c${col}:${align}`;
      })
      .join(";");

    const lines = [];
    // La estructura de la tabla es GFM puro. Sólo las propiedades imposibles
    // de expresar en GFM van en un comentario invisible para GitHub/Obsidian.
    const extra = { caption: captionInput.value.trim(), widths: state.autoWidths ? "" : state.widths.map((value) => Math.round(value)).join(" "),
      heights: state.heights.some(Boolean) ? state.heights.map((value) => value || "auto").join(" ") : "",
      id: idInput.value.trim(), style: state.style === "grid" ? "" : state.style,
      align: state.align === "left" ? "" : state.align,
      merges: merges || "", cells: cells || "" };
    if (Object.values(extra).some(Boolean)) lines.push(`<!-- mdpdf-table:${encodeURIComponent(JSON.stringify(extra))} -->`, "");
    lines.push(renderRow(state.grid[0], 0));
    lines.push(separator);
    state.grid.slice(1).forEach((row, index) => lines.push(renderRow(row, index + 1)));
    return lines.join("\n");
  }

  function buildHtmlTable() {
    // Conservar <thead>, colspan/rowspan, estilos, <b>, <br> e imágenes
    // de las celdas que el usuario no modificó.
    const original = table.original.cloneNode(true);
    if (idInput.value.trim() !== table.attrs.id) original.id = idInput.value.trim();
    let caption = original.querySelector(":scope > caption");
    if (captionInput.value.trim() && captionInput.value.trim() !== table.attrs.caption) {
      if (!caption) {
        caption = document.createElement("caption");
        original.prepend(caption);
      }
      caption.textContent = captionInput.value.trim();
    } else if (!captionInput.value.trim()) caption?.remove();
    let colgroup = original.querySelector(":scope > colgroup");
    const widthsChanged = state.autoWidths !== initialAutoWidths || state.widths.some((width, index) => width !== initialWidths[index]);
    if (widthsChanged && !state.autoWidths) {
      if (!colgroup) {
        colgroup = document.createElement("colgroup");
        original.prepend(colgroup);
      }
      colgroup.replaceChildren(...state.widths.map((width) => {
        const col = document.createElement("col");
        col.style.width = `${width}%`;
        return col;
      }));
    } else if (widthsChanged) colgroup?.remove();
    const oldGrid = [table.header, ...table.body];
    const covered = coveredSet();
    const oldRows = [...original.rows];
    const oldSections = oldRows.map((row) => row.parentElement);
    const oldCells = table.originalCells;
    const rebuilt = state.grid.map((row, r) => {
      const tr = oldRows[r]?.cloneNode(false) ?? document.createElement("tr");
      if (/^\d+(?:\.\d+)?mm$/.test(state.heights[r])) tr.style.height = state.heights[r];
      row.forEach((value, c) => {
        if (covered.has(key(r, c))) return;
        const old = oldCells[r]?.[c];
        const cell = old?.cloneNode(true) ?? document.createElement(r === 0 ? "th" : "td");
        if (!old || value !== oldGrid[r]?.[c]) cell.textContent = value;
        const merge = state.merges.get(key(r, c));
        if (merge?.colspan > 1) cell.colSpan = merge.colspan;
        else cell.removeAttribute("colspan");
        if (merge?.rowspan > 1) cell.rowSpan = merge.rowspan;
        else cell.removeAttribute("rowspan");
        tr.append(cell);
      });
      return tr;
    });
    for (const row of oldRows) row.remove();
    for (const [r, row] of rebuilt.entries()) {
      const section = oldSections[r] ?? (r === 0 ? original.tHead ?? original.createTHead() : original.tBodies[0] ?? original.createTBody());
      section.append(row);
    }
    // Al quitar las filas quedan nodos de texto con saltos entre <tr>. Al
    // serializarlos se crean líneas en blanco dentro del HTML y CommonMark
    // corta la tabla: el resto se convierte en texto. Eliminamos sólo los
    // espacios estructurales; el contenido de las celdas no se toca.
    const structural = new Set(["TABLE", "COLGROUP", "THEAD", "TBODY", "TFOOT", "TR"]);
    const walker = document.createTreeWalker(original, NodeFilter.SHOW_TEXT);
    const blanks = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (structural.has(node.parentElement?.tagName) && !node.nodeValue.trim()) blanks.push(node);
    }
    for (const node of blanks) node.remove();
    return original.outerHTML;
  }

  const foot = document.createElement("div");
  foot.style.display = "flex";
  foot.style.gap = "8px";
  foot.style.width = "100%";
  foot.style.alignItems = "center";

  const footHint = document.createElement("span");
  footHint.className = "hint";
  footHint.textContent = "Tabla GFM · anchos, caption y combinaciones se conservan en un comentario invisible";
  const spacer = document.createElement("span");
  spacer.className = "spacer";

  const cancel = button("Cancelar", "mini");
  cancel.addEventListener("click", closeModal);

  const save = button("Guardar", "primary");
  save.addEventListener("click", () => {
    if (state.editing) {
      const text = previewTable.querySelector(".cell-text.editing");
      text?.blur();
    }
    if (table.html) editor.replaceRange(table.from, table.to, buildHtmlTable());
    else editor.replaceLines(table.start + 1, table.end + 1, buildBlock());
    closeModal();
    onSaved?.();
  });

  foot.append(footHint, spacer, cancel, save);

  openModal({ title: "Tabla", body, footer: foot, size: "table" });
  document.getElementById("modal").style.width = `clamp(60vw, ${colCount() * 155 + 40}px, 70vw)`;
  previewTable.style.setProperty("--table-content-width", `${Math.max(650, colCount() * 135)}px`);
  renderAll();
}

// ============================================================================
//  Insertar una tabla nueva
// ============================================================================

export function openInsertTable({ editor, setStatus, onSaved }) {
  const body = document.createElement("div");
  body.className = "table-layout";

  const row = document.createElement("div");
  row.className = "table-tools";

  const makeField = (label, value) => {
    const wrap = document.createElement("label");
    wrap.className = "insert-field";
    const text = document.createElement("span");
    text.textContent = label;
    const input = document.createElement("input");
    input.type = "number";
    input.min = "1";
    input.max = "12";
    input.value = String(value);
    wrap.append(text, input);
    return { wrap, input };
  };

  const cols = makeField("Columnas", 3);
  const rows = makeField("Filas de datos", 3);
  row.append(cols.wrap, rows.wrap);

  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = "Se inserta en la posición del cursor. Luego puedes combinar celdas, escribir dentro y más.";

  body.append(row, hint);

  const foot = document.createElement("div");
  foot.style.display = "flex";
  foot.style.gap = "8px";
  foot.style.width = "100%";
  foot.style.justifyContent = "flex-end";

  const cancel = button("Cancelar", "mini");
  cancel.addEventListener("click", closeModal);

  const accept = button("Insertar tabla", "primary");
  accept.addEventListener("click", () => {
    const columnCount = Math.max(1, Math.min(12, Number(cols.input.value) || 1));
    const bodyRows = Math.max(1, Math.min(30, Number(rows.input.value) || 1));
    const width = Math.round(100 / columnCount);

    const lines = [`:::table{widths="${Array.from({ length: columnCount }, () => width).join(" ")}"}`];
    lines.push(`| ${Array.from({ length: columnCount }, () => " ").join(" | ")} |`);
    lines.push(`|${Array.from({ length: columnCount }, () => ":---").join("|")}|`);
    for (let i = 0; i < bodyRows; i += 1) {
      lines.push(`| ${Array.from({ length: columnCount }, () => " ").join(" | ")} |`);
    }
    lines.push(":::");

    editor.insertAtCursor(`\n\n${lines.join("\n")}\n\n`);
    closeModal();
    setStatus("Tabla insertada", "ok");
    onSaved?.();
  });

  foot.append(cancel, accept);
  openModal({ title: "Insertar tabla", body, footer: foot, size: "xs" });
  cols.input.focus();
}
