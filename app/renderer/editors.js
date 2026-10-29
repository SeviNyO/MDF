// ============================================================================
//  Editores visuales: imágenes (recorte + anotaciones) y tablas
// ============================================================================

import { getStyle, openContextMenu, setStyle } from "./style-clipboard.js";

const el = (id) => document.getElementById(id);

const overlay = () => el("overlay");
const modalBody = () => el("modalBody");
const modalFoot = () => el("modalFoot");

export function closeModal() {
  overlay().classList.add("hidden");
  modalBody().innerHTML = "";
  modalFoot().innerHTML = "";
}

export function openModal({ title, body, footer, size = "lg" }) {
  el("modal").dataset.size = size;
  el("modal").style.width = "";
  el("modalTitle").textContent = title;
  modalBody().innerHTML = "";
  modalBody().append(body);
  modalFoot().innerHTML = "";
  if (footer) modalFoot().append(footer);
  overlay().classList.remove("hidden");
}

el("modalClose").addEventListener("click", closeModal);
overlay().addEventListener("click", (event) => {
  if (event.target === overlay()) closeModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !overlay().classList.contains("hidden")) closeModal();
});

function button(label, className = "") {
  const node = document.createElement("button");
  node.textContent = label;
  if (className) node.className = className;
  return node;
}

function escapeAttr(value) {
  return String(value).replace(/"/g, "&quot;");
}

// ============================================================================
//  Imagen: recorte + anotaciones
// ============================================================================

const COLORS = ["#e11d48", "#1e5f9e", "#15803d", "#f59e0b"];
const TOOLS = [
  ["arrow", "Flecha"],
  ["rect", "Caja"],
  ["ellipse", "Elipse"],
  ["highlight", "Resaltar"],
  ["pen", "Lápiz"],
  ["text", "Texto"],
];

export async function openImageEditor({ api, rel, editor, onSaved, setStatus }) {
  let data;
  try {
    data = await api.loadImage(rel);
  } catch (error) {
    setStatus(String(error.message ?? error), "bad");
    return;
  }

  const img = new Image();
  img.src = data.data;
  await img.decode();

  const crop0 = data.edit?.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const state = {
    crop: { ...crop0 },
    annotations: (data.edit?.annotations ?? []).map((a) => ({ ...a })),
    mode: "crop",
    tool: "arrow",
    color: COLORS[0],
    size: 0.004,
    draft: null,
    drag: null,
  };

  // --- estructura -----------------------------------------------------------

  const body = document.createElement("div");
  body.className = "image-layout";

  const canvasWrap = document.createElement("div");
  canvasWrap.className = "canvas-wrap";
  const canvas = document.createElement("canvas");
  canvas.id = "imageCanvas";
  canvasWrap.append(canvas);

  const tools = document.createElement("div");
  tools.className = "tools";

  const modeGroup = document.createElement("div");
  modeGroup.className = "tool-group";
  modeGroup.innerHTML = '<div class="tool-label">Modo</div>';
  const modeSeg = document.createElement("div");
  modeSeg.className = "seg";
  const btnCrop = button("Recortar");
  const btnAnnotate = button("Anotar");
  modeSeg.append(btnCrop, btnAnnotate);
  modeGroup.append(modeSeg);

  const toolGroup = document.createElement("div");
  toolGroup.className = "tool-group";
  toolGroup.innerHTML = '<div class="tool-label">Herramienta</div>';
  const toolSeg = document.createElement("div");
  toolSeg.className = "seg";
  TOOLS.forEach(([id, label]) => {
    const node = button(label);
    node.dataset.tool = id;
    node.addEventListener("click", () => {
      state.tool = id;
      state.mode = "annotate";
      syncTools();
      draw();
    });
    toolSeg.append(node);
  });
  toolGroup.append(toolSeg);

  const colorGroup = document.createElement("div");
  colorGroup.className = "tool-group";
  colorGroup.innerHTML = '<div class="tool-label">Color</div>';
  const swatches = document.createElement("div");
  swatches.className = "swatches";
  COLORS.forEach((color) => {
    const node = document.createElement("button");
    node.className = "swatch";
    node.style.background = color;
    node.dataset.color = color;
    node.addEventListener("click", () => {
      state.color = color;
      syncTools();
    });
    swatches.append(node);
  });
  colorGroup.append(swatches);

  const sizeGroup = document.createElement("div");
  sizeGroup.className = "tool-group";
  sizeGroup.innerHTML = '<div class="tool-label">Grosor</div>';
  const sizeSeg = document.createElement("div");
  sizeSeg.className = "seg";
  [
    ["Fino", 0.0025],
    ["Medio", 0.004],
    ["Grueso", 0.007],
  ].forEach(([label, value]) => {
    const node = button(label);
    node.dataset.size = String(value);
    node.addEventListener("click", () => {
      state.size = value;
      syncTools();
    });
    sizeSeg.append(node);
  });
  sizeGroup.append(sizeSeg);

  const actions = document.createElement("div");
  actions.className = "tool-group";
  actions.innerHTML = '<div class="tool-label">Acciones</div>';
  const undo = button("Deshacer", "mini");
  undo.addEventListener("click", () => {
    if (state.mode === "crop") state.crop = { x: 0, y: 0, w: 1, h: 1 };
    else state.annotations.pop();
    draw();
  });
  const clear = button("Borrar anotaciones", "mini");
  clear.addEventListener("click", () => {
    state.annotations = [];
    draw();
  });
  actions.append(undo, clear);

  const widthGroup = document.createElement("div");
  widthGroup.className = "tool-group";
  widthGroup.innerHTML = '<div class="tool-label">Tamaño en el documento</div>';
  const widthSeg = document.createElement("div");
  widthSeg.className = "seg";
  const widthInput = document.createElement("input");
  widthInput.type = "number";
  widthInput.min = "10";
  widthInput.max = "100";
  widthInput.step = "1";
  widthInput.style.width = "64px";
  widthInput.style.padding = "5px 6px";
  widthInput.style.border = "1px solid var(--line)";
  widthInput.style.borderRadius = "5px";

  const currentAttrs = findImageAttrs(editor.getValue(), rel);
  widthInput.value = String(currentAttrs.width ?? 70);
  widthInput.title = "Ancho en % del texto";

  const heightInput = document.createElement("input");
  heightInput.type = "text";
  heightInput.placeholder = "auto";
  heightInput.value = currentAttrs.height ?? "";
  heightInput.style.width = "70px";
  heightInput.style.padding = "5px 6px";
  heightInput.style.border = "1px solid var(--line)";
  heightInput.style.borderRadius = "5px";
  heightInput.title = "Alto: por ejemplo 40mm (vacío = automático)";

  const fitSelect = document.createElement("select");
  fitSelect.className = "select";
  fitSelect.style.flex = "1";
  for (const [value, label] of [
    ["contain", "Ajustar (contain)"],
    ["cover", "Rellenar (cover)"],
    ["stretch", "Estirar"],
  ]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = (currentAttrs.fit ?? "contain") === value;
    fitSelect.append(option);
  }

  [
    ["S", 45],
    ["M", 70],
    ["L", 92],
  ].forEach(([label, value]) => {
    const node = button(label);
    node.addEventListener("click", () => {
      widthInput.value = String(value);
    });
    widthSeg.append(node);
  });
  widthGroup.append(widthSeg);

  const widthRow = document.createElement("div");
  widthRow.className = "tool-row";
  widthRow.append(widthInput, document.createTextNode("% de ancho"));
  widthGroup.append(widthRow);

  const heightRow = document.createElement("div");
  heightRow.className = "tool-row";
  heightRow.append(document.createTextNode("Alto:"), heightInput);
  widthGroup.append(heightRow);

  const fitRow = document.createElement("div");
  fitRow.className = "tool-row";
  fitRow.append(document.createTextNode("Ajuste:"), fitSelect);
  widthGroup.append(fitRow);

  const inDocument = editor.getValue().includes(rel);
  if (!inDocument) {
    widthGroup.style.opacity = "0.5";
    widthInput.disabled = true;
    for (const node of widthSeg.children) node.disabled = true;
    const note = document.createElement("div");
    note.className = "hint";
    note.textContent = "Esta imagen no está en el archivo abierto; el ancho no se aplicará.";
    widthGroup.append(note);
  }

  tools.append(modeGroup, toolGroup, colorGroup, sizeGroup, actions, widthGroup);

  body.append(canvasWrap, tools);

  // --- canvas ---------------------------------------------------------------

  const maxW = 700;
  const maxH = 520;
  const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
  const cssW = Math.max(120, Math.round(img.naturalWidth * scale));
  const cssH = Math.max(80, Math.round(img.naturalHeight * scale));
  const dpr = window.devicePixelRatio || 1;

  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);

  const ctx = canvas.getContext("2d");

  function syncTools() {
    btnCrop.classList.toggle("active", state.mode === "crop");
    btnAnnotate.classList.toggle("active", state.mode === "annotate");
    for (const node of toolSeg.children) {
      node.classList.toggle("active", state.mode === "annotate" && node.dataset.tool === state.tool);
    }
    for (const node of swatches.children) {
      node.classList.toggle("active", node.dataset.color === state.color);
    }
    for (const node of sizeSeg.children) {
      node.classList.toggle("active", Number(node.dataset.size) === state.size);
    }
    toolGroup.style.opacity = state.mode === "annotate" ? "1" : "0.55";
    colorGroup.style.opacity = state.mode === "annotate" ? "1" : "0.55";
    sizeGroup.style.opacity = state.mode === "annotate" ? "1" : "0.55";
  }

  btnCrop.addEventListener("click", () => {
    state.mode = "crop";
    syncTools();
    draw();
  });
  btnAnnotate.addEventListener("click", () => {
    state.mode = "annotate";
    syncTools();
    draw();
  });

  function toOriginal(p) {
    const c = state.crop;
    return { x: c.x + p.x * c.w, y: c.y + p.y * c.h };
  }

  function toView(a) {
    const c = state.crop;
    const view = { ...a };
    const mapX = (value) => (value - c.x) / c.w;
    const mapY = (value) => (value - c.y) / c.h;
    view.x = mapX(a.x);
    view.y = mapY(a.y);
    view.w = a.w / c.w;
    view.h = a.h / c.h;
    if (a.type === "arrow") {
      view.x2 = mapX(a.x2);
      view.y2 = mapY(a.y2);
    }
    if (a.points) view.points = a.points.map(([px, py]) => [mapX(px), mapY(py)]);
    return view;
  }

  function drawShape(a, w, h) {
    const stroke = Math.max(1, (a.size || 0.004) * w);
    ctx.save();
    ctx.strokeStyle = a.color;
    ctx.fillStyle = a.color;
    ctx.lineWidth = stroke;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (a.type === "rect") {
      ctx.strokeRect(a.x * w, a.y * h, a.w * w, a.h * h);
    } else if (a.type === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(
        (a.x + a.w / 2) * w,
        (a.y + a.h / 2) * h,
        Math.abs((a.w * w) / 2),
        Math.abs((a.h * h) / 2),
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    } else if (a.type === "highlight") {
      ctx.globalAlpha = 0.32;
      ctx.fillRect(a.x * w, a.y * h, a.w * w, a.h * h);
    } else if (a.type === "arrow") {
      const x1 = a.x * w;
      const y1 = a.y * h;
      const x2 = a.x2 * w;
      const y2 = a.y2 * h;
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const head = Math.max(7, stroke * 4);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - head * Math.cos(angle - 0.45), y2 - head * Math.sin(angle - 0.45));
      ctx.lineTo(x2 - head * Math.cos(angle + 0.45), y2 - head * Math.sin(angle + 0.45));
      ctx.closePath();
      ctx.fill();
    } else if (a.type === "pen" && a.points?.length) {
      ctx.beginPath();
      a.points.forEach(([px, py], index) => {
        if (index === 0) ctx.moveTo(px * w, py * h);
        else ctx.lineTo(px * w, py * h);
      });
      ctx.stroke();
    } else if (a.type === "text" && a.text) {
      const size = Math.max(10, (a.size || 0.035) * w);
      ctx.font = `600 ${size}px "Source Sans 3", "DejaVu Sans", sans-serif`;
      ctx.textBaseline = "alphabetic";
      ctx.fillText(a.text, a.x * w, a.y * h);
    }
    ctx.restore();
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    if (state.mode === "crop") {
      ctx.drawImage(img, 0, 0, cssW, cssH);

      const x = state.crop.x * cssW;
      const y = state.crop.y * cssH;
      const w = state.crop.w * cssW;
      const h = state.crop.h * cssH;

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, cssW, cssH);
      ctx.rect(x, y, w, h);
      ctx.fillStyle = "rgba(15, 23, 42, 0.55)";
      ctx.fill("evenodd");
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
      ctx.strokeStyle = "#1e3a5f";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

      const handle = 9;
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#1e3a5f";
      for (const [hx, hy] of [
        [x, y],
        [x + w, y],
        [x, y + h],
        [x + w, y + h],
      ]) {
        ctx.fillRect(hx - handle / 2, hy - handle / 2, handle, handle);
        ctx.strokeRect(hx - handle / 2, hy - handle / 2, handle, handle);
      }
      ctx.restore();
    } else {
      const sx = state.crop.x * img.naturalWidth;
      const sy = state.crop.y * img.naturalHeight;
      const sw = state.crop.w * img.naturalWidth;
      const sh = state.crop.h * img.naturalHeight;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cssW, cssH);

      for (const a of state.annotations) drawShape(toView(a), cssW, cssH);
      if (state.draft) drawShape(toView(state.draft), cssW, cssH);
    }
  }

  function showTextEntry(event, origin) {
    const canvasRect = canvas.getBoundingClientRect();
    const wrapRect = canvasWrap.getBoundingClientRect();
    const input = document.createElement("input");
    input.className = "text-entry";
    input.style.left = `${canvasRect.left - wrapRect.left + (event.clientX - canvasRect.left)}px`;
    input.style.top = `${canvasRect.top - wrapRect.top + (event.clientY - canvasRect.top)}px`;
    input.placeholder = "Texto…";
    canvasWrap.append(input);
    input.focus();

    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      if (commit && value) {
        state.annotations.push({
          type: "text",
          x: origin.x,
          y: origin.y,
          text: value,
          color: state.color,
          size: 0.035,
        });
        draw();
      }
      input.remove();
    };

    input.addEventListener("keydown", (keyEvent) => {
      if (keyEvent.key === "Enter") {
        keyEvent.preventDefault();
        finish(true);
      } else if (keyEvent.key === "Escape") {
        keyEvent.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
  }

  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  }

  function cropHit(p) {
    const { x, y, w, h } = state.crop;
    const tol = 0.025;
    const near = (a, b) => Math.abs(a - b) <= tol;
    if (near(p.x, x) && near(p.y, y)) return "nw";
    if (near(p.x, x + w) && near(p.y, y)) return "ne";
    if (near(p.x, x) && near(p.y, y + h)) return "sw";
    if (near(p.x, x + w) && near(p.y, y + h)) return "se";
    if (p.x > x && p.x < x + w && p.y > y && p.y < y + h) return "move";
    return null;
  }

  canvasWrap.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    openContextMenu(event.clientX, event.clientY, [
      {
        label: "Copiar estilo (ancho/alto/ajuste)",
        action: () => {
          setStyle({
            kind: "image",
            width: Number(widthInput.value),
            height: heightInput.value.trim(),
            fit: fitSelect.value,
          });
          setStatus("Estilo de imagen copiado", "ok");
        },
      },
      {
        label: "Pegar estilo",
        action: () => {
          const style = getStyle();
          if (!style || style.kind !== "image") {
            setStatus("No hay un estilo de imagen copiado", "bad");
            return;
          }
          widthInput.value = String(style.width ?? 70);
          heightInput.value = style.height ?? "";
          fitSelect.value = style.fit ?? "contain";
          setStatus("Estilo de imagen pegado (pulsa Guardar)", "ok");
        },
      },
    ]);
  });

  canvas.addEventListener("pointerdown", (event) => {
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // eventos sintéticos no capturan puntero
    }
    const p = point(event);

    if (state.mode === "crop") {
      state.drag = { kind: cropHit(p), start: p, crop: { ...state.crop } };
      return;
    }

    const o = toOriginal(p);

    if (state.tool === "text") {
      showTextEntry(event, o);
      return;
    }

    state.drag = { start: p };
    if (state.tool === "arrow") {
      state.draft = { type: "arrow", x: o.x, y: o.y, x2: o.x, y2: o.y, color: state.color, size: state.size };
    } else if (state.tool === "pen") {
      state.draft = { type: "pen", points: [[o.x, o.y]], color: state.color, size: state.size };
    } else {
      state.draft = { type: state.tool, x: o.x, y: o.y, w: 0, h: 0, color: state.color, size: state.size };
    }
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!state.drag) return;
    const p = point(event);

    if (state.mode === "crop") {
      const { kind, start, crop } = state.drag;
      if (!kind) return;
      const min = 0.04;

      if (kind === "move") {
        const dx = p.x - start.x;
        const dy = p.y - start.y;
        state.crop.x = Math.min(1 - crop.w, Math.max(0, crop.x + dx));
        state.crop.y = Math.min(1 - crop.h, Math.max(0, crop.y + dy));
      } else {
        let x = crop.x;
        let y = crop.y;
        let w = crop.w;
        let h = crop.h;
        if (kind.includes("w")) {
          x = Math.min(crop.x + crop.w - min, Math.max(0, p.x));
          w = crop.x + crop.w - x;
        }
        if (kind.includes("e")) {
          w = Math.min(1 - crop.x, Math.max(min, p.x - crop.x));
        }
        if (kind.includes("n")) {
          y = Math.min(crop.y + crop.h - min, Math.max(0, p.y));
          h = crop.y + crop.h - y;
        }
        if (kind.includes("s")) {
          h = Math.min(1 - crop.y, Math.max(min, p.y - crop.y));
        }
        state.crop = { x, y, w, h };
      }
      draw();
      return;
    }

    if (!state.draft) return;
    const o = toOriginal(p);
    if (state.draft.type === "arrow") {
      state.draft.x2 = o.x;
      state.draft.y2 = o.y;
    } else if (state.draft.type === "pen") {
      const last = state.draft.points.at(-1);
      if (!last || Math.hypot(o.x - last[0], o.y - last[1]) > 0.004) {
        state.draft.points.push([o.x, o.y]);
      }
    } else {
      state.draft.w = o.x - state.draft.x;
      state.draft.h = o.y - state.draft.y;
    }
    draw();
  });

  canvas.addEventListener("pointerup", () => {
    if (!state.drag) return;
    state.drag = null;

    if (state.mode === "annotate" && state.draft) {
      const draft = state.draft;
      state.draft = null;
      const small =
        draft.type === "pen"
          ? draft.points.length < 2
          : draft.type === "arrow"
            ? Math.hypot(draft.x2 - draft.x, draft.y2 - draft.y) < 0.01
            : Math.abs(draft.w) < 0.01 || Math.abs(draft.h) < 0.01;
      if (!small) {
        if (draft.w < 0) {
          draft.x += draft.w;
          draft.w = Math.abs(draft.w);
        }
        if (draft.h < 0) {
          draft.y += draft.h;
          draft.h = Math.abs(draft.h);
        }
        state.annotations.push(draft);
      }
    }
    draw();
  });

  // --- footer ---------------------------------------------------------------

  const foot = document.createElement("div");
  foot.style.display = "flex";
  foot.style.alignItems = "center";
  foot.style.width = "100%";
  foot.style.gap = "8px";

  const info = document.createElement("span");
  info.className = "hint";
  info.textContent = `${rel} · ${data.width}×${data.height} px`;
  const spacer = document.createElement("span");
  spacer.className = "spacer";
  const cancel = button("Cancelar");
  cancel.addEventListener("click", closeModal);
  const save = button("Guardar cambios", "primary");
  save.addEventListener("click", async () => {
    save.disabled = true;
    try {
      await api.saveImageEdit(rel, {
        version: 1,
        crop: state.crop,
        annotations: state.annotations,
      });

      if (inDocument) {
        const width = Number(widthInput.value);
        setImageAttrs(editor, rel, {
          width: width >= 10 && width <= 100 ? Math.round(width) : null,
          height: heightInput.value.trim(),
          fit: fitSelect.value,
        });
      }

      closeModal();
      if (onSaved) await onSaved();
    } catch (error) {
      setStatus(String(error.message ?? error), "bad");
      save.disabled = false;
    }
  });

  foot.append(info, spacer, cancel, save);

  openModal({ title: `Imagen — ${rel.split("/").pop()}`, body, footer: foot });
  syncTools();
  draw();
}

export function findImageAttrs(text, rel) {
  const escaped = rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\]\\(\\s*${escaped}[^)]*\\)\\{([^}]*)\\}`);
  const match = text.match(re);
  const attrs = {};
  if (!match) return attrs;

  const width = match[1].match(/width\s*=\s*([\d.]+)\s*%?/);
  if (width) attrs.width = Number(width[1]);
  const height = match[1].match(/height\s*=\s*([\w.]+)/);
  if (height) attrs.height = height[1];
  const fit = match[1].match(/fit\s*=\s*"?([a-z]+)"?/);
  if (fit) attrs.fit = fit[1];
  return attrs;
}

export function setImageAttrs(editor, rel, { width, height, fit }) {
  const text = editor.getValue();
  const escaped = rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(!\\[[^\\]]*\\]\\(\\s*${escaped}(?:\\s+"[^"]*")?\\s*\\))(\\{[^}]*\\})?`, "g");
  let found = false;

  const next = text.replace(re, (match, base, attrs) => {
    found = true;
    let inner = attrs ? attrs.slice(1, -1).trim() : "";

    if (width) {
      if (/width\s*=\s*\S+/.test(inner)) inner = inner.replace(/width\s*=\s*\S+/, `width=${width}%`);
      else inner = `${inner} width=${width}%`.trim();
    }
    if (height) {
      if (/height\s*=\s*\S+/.test(inner)) inner = inner.replace(/height\s*=\s*\S+/, `height=${height}`);
      else inner = `${inner} height=${height}`.trim();
    } else {
      inner = inner.replace(/\s*height\s*=\s*\S+/, "").trim();
    }
    if (fit) {
      if (/fit\s*=\s*\S+/.test(inner)) inner = inner.replace(/fit\s*=\s*\S+/, `fit=${fit}`);
      else inner = `${inner} fit=${fit}`.trim();
    }

    return inner ? `${base}{${inner}}` : base;
  });

  if (found) editor.setValue(next);
  return found;
}

// Edición del HTML fuente (no de la URL data: usada por la vista de lectura).
export function openHtmlImageEditor({ editor, image, block, onSaved, setStatus }) {
  const inTable = Boolean(image.closest("td, th"));
  const start = Number(block?.dataset.start);
  const end = Number(block?.dataset.end);
  const source = editor.getValue();
  const lines = source.split("\n");
  const before = lines.slice(0, Math.max(0, start - 1)).join("\n").length + (start > 1 ? 1 : 0);
  const region = lines.slice(start - 1, end).join("\n");
  const tags = [...region.matchAll(/<img\b[^>]*>|!\[[^\]]*\]\([^\n)]*\)(?:\{[^\n}]*\})?/gi)];
  const index = [...block.querySelectorAll("img")].indexOf(image);
  const match = tags[index];
  if (!match) {
    setStatus("No se encontró la imagen HTML en el código", "bad");
    return;
  }
  const attr = (tag, name) => new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag)?.slice(1).find((v) => v !== undefined) ?? "";
  const tag = match[0];
  const isHtml = /^<img\b/i.test(tag);
  const markdownImage = !isHtml ? /^!\[([^\]]*)\]\(([^)]*)\)/.exec(tag) : null;
  const wrapper = region.slice(0, match.index).match(/<(div|p)\b[^>]*align\s*=\s*["']?(left|center|right)["']?[^>]*>\s*(?:<a\b[^>]*>\s*)?$/i);
  const currentAlign = wrapper?.[2]?.toLowerCase() ?? "left";
  const body = document.createElement("div");
  body.className = "html-image-editor";
  const field = (label, value) => {
    const wrap = document.createElement("label");
    wrap.className = "image-field";
    wrap.textContent = label;
    const input = document.createElement("input");
    input.value = value;
    wrap.append(input);
    return { wrap, input };
  };
  const urlField = field("URL de la imagen", isHtml ? attr(tag, "src") : markdownImage?.[2] ?? "");
  const url = urlField.input;
  const sourceTabs = document.createElement("div");
  sourceTabs.className = "image-source-tabs";
  const urlTab = button("URL", "active");
  const fileTab = button("Archivo");
  const chooseFile = async () => {
    const picked = await window.api.pickImage();
    if (!picked) return;
    url.value = picked.rel;
    urlTab.classList.remove("active");
    fileTab.classList.add("active");
    if (!alt.value.trim()) alt.value = picked.alt ?? "";
    updateImagePreview();
  };
  fileTab.addEventListener("click", chooseFile);
  urlTab.addEventListener("click", () => { urlTab.classList.add("active"); fileTab.classList.remove("active"); url.focus(); });
  sourceTabs.append(urlTab, fileTab);
  const status = document.createElement("div");
  status.className = "image-load-status";
  status.setAttribute("aria-live", "polite");

  const preview = document.createElement("div");
  preview.className = "image-page-preview";
  const previewTitle = document.createElement("span");
  previewTitle.textContent = "Vista previa en la página";
  const imageStage = document.createElement("div");
  imageStage.className = "image-page-stage";
  const previewImage = document.createElement("img");
  previewImage.alt = "Vista previa de la imagen";
  imageStage.append(previewImage);
  preview.append(previewTitle, imageStage);

  const altField = field("Texto alternativo", isHtml ? attr(tag, "alt") : markdownImage?.[1] ?? "");
  const alt = altField.input;
  const altHint = document.createElement("small");
  altHint.textContent = "Describe la imagen para lectores de pantalla y para cuando no cargue.";
  altField.wrap.append(altHint);

  const inlineWidth = /(?:^|;)\s*width\s*:\s*(\d+(?:\.\d+)?(?:px|%)?)/i.exec(attr(tag, "style"))?.[1];
  const originalWidth = (isHtml ? attr(tag, "width") || inlineWidth : /\bwidth\s*=\s*([\w.%]+)/.exec(tag)?.[1]) || "";
  const widthIsPercent = !originalWidth || originalWidth.endsWith("%");
  const widthField = field("Ancho", originalWidth.replace(/(?:px|%)$/, ""));
  const width = widthField.input;
  width.inputMode = "decimal";
  const unitGroup = document.createElement("div");
  unitGroup.className = "image-unit-tabs";
  const percentBtn = button("%", widthIsPercent ? "active" : "");
  const pixelBtn = button("px", widthIsPercent ? "" : "active");
  let unit = widthIsPercent ? "%" : "px";
  for (const [node, value] of [[percentBtn, "%"], [pixelBtn, "px"]]) {
    node.addEventListener("click", () => {
      unit = value;
      percentBtn.classList.toggle("active", unit === "%");
      pixelBtn.classList.toggle("active", unit === "px");
      applyPreviewLayout();
    });
    unitGroup.append(node);
  }
  const widthLine = document.createElement("div");
  widthLine.className = "image-width-line";
  widthField.wrap.append(widthLine);
  widthLine.append(width, unitGroup);
  const widthHint = document.createElement("small");
  widthHint.textContent = "El alto se ajusta solo y mantiene la proporción.";
  widthField.wrap.append(widthHint);
  const presetRow = document.createElement("div");
  presetRow.className = "image-presets";
  for (const [label, amount] of [["Auto", ""], ["25 %", "25"], ["50 %", "50"], ["75 %", "75"], ["100 %", "100"]]) {
    const preset = button(label, "mini");
    preset.addEventListener("click", () => {
      width.value = amount;
      if (amount) percentBtn.click();
      applyPreviewLayout();
    });
    presetRow.append(preset);
  }
  widthField.wrap.append(presetRow);
  const alignWrap = document.createElement("div");
  alignWrap.className = "image-field";
  alignWrap.textContent = "Alineación";
  const alignButtons = document.createElement("div");
  alignButtons.className = "image-align-tabs";
  let selectedAlign = currentAlign;
  const alignNodes = [];
  for (const [value, label, path] of [
    ["left", "Izquierda", "M3 5h18M3 10h12M3 15h18M3 20h12"],
    ["center", "Centro", "M3 5h18M6 10h12M3 15h18M6 20h12"],
    ["right", "Derecha", "M3 5h18M9 10h12M3 15h18M9 20h12"],
  ]) {
    const control = button("");
    control.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="${path}"/></svg>`;
    control.setAttribute("aria-label", label);
    control.title = label;
    control.addEventListener("click", () => {
      selectedAlign = value;
      alignNodes.forEach(([node, id]) => node.classList.toggle("active", id === value));
      applyPreviewLayout();
    });
    alignNodes.push([control, value]);
    alignButtons.append(control);
  }
  alignNodes.forEach(([node, value]) => node.classList.toggle("active", value === selectedAlign));
  alignWrap.append(alignButtons);
  const dimensionRow = document.createElement("div");
  dimensionRow.className = "image-dimension-row";
  dimensionRow.append(widthField.wrap, alignWrap);

  const advanced = document.createElement("details");
  advanced.className = "image-advanced";
  advanced.open = true;
  const advancedTitle = document.createElement("summary");
  advancedTitle.textContent = "Opciones avanzadas";
  const captionValue = /^(?:\s*<\/a>)?\s*<br\s*\/?>\s*<em\s+class=["']image-caption["']>([\s\S]*?)<\/em>/i.exec(region.slice(match.index + tag.length))?.[1] ?? "";
  const captionField = field("Pie de imagen", captionValue);
  const referenceField = field("Referencia", (isHtml ? attr(tag, "id") : /\{#([\w:-]+)/.exec(tag)?.[1]) ?? "");
  referenceField.input.placeholder = "fig:logo-upc";
  const referenceHint = document.createElement("small");
  referenceHint.textContent = "Para citarla en el texto con @fig:logo-upc";
  referenceField.wrap.append(referenceHint);
  const heightField = field("Alto", isHtml ? attr(tag, "height") : /\bheight\s*=\s*([\w.%]+)/.exec(tag)?.[1] ?? "");
  heightField.input.placeholder = "Automático";
  const linkField = field("Enlace al hacer clic", /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>\s*$/i.exec(region.slice(0, match.index))?.[1] ?? "");
  linkField.input.placeholder = "https://";
  const advancedGrid = document.createElement("div");
  advancedGrid.className = "image-advanced-grid";
  advancedGrid.append(captionField.wrap, referenceField.wrap, heightField.wrap, linkField.wrap);
  advanced.append(advancedTitle, advancedGrid);

  body.append(sourceTabs, urlField.wrap, status, preview, altField.wrap, dimensionRow, advanced);

  let previewRequest = 0;
  function applyPreviewLayout() {
    imageStage.style.justifyContent = selectedAlign === "left" ? "flex-start" : selectedAlign === "right" ? "flex-end" : "center";
    const amount = Number(width.value.replace(",", "."));
    previewImage.style.width = amount > 0 ? `${amount}${unit}` : "auto";
    previewImage.style.maxWidth = "100%";
    previewImage.alt = alt.value;
  }
  async function updateImagePreview() {
    const request = ++previewRequest;
    const value = url.value.trim();
    status.textContent = value ? "Cargando imagen…" : "Introduce una URL o elige un archivo";
    status.classList.remove("error");
    applyPreviewLayout();
    if (!value) { previewImage.removeAttribute("src"); return; }
    try {
      const src = /^(?:https?:|data:|\/\/)/i.test(value) ? value : (await window.api.loadImage(value.replace(/^\.\//, ""))).data;
      if (request !== previewRequest) return;
      const probe = new Image();
      probe.src = src;
      await probe.decode();
      if (request !== previewRequest) return;
      previewImage.src = src;
      status.textContent = `✓ Imagen cargada · ${probe.naturalWidth} × ${probe.naturalHeight} px`;
    } catch {
      if (request !== previewRequest) return;
      previewImage.removeAttribute("src");
      status.classList.add("error");
      status.textContent = "No se pudo cargar la imagen. Revisa la URL o el archivo.";
    }
  }
  url.addEventListener("change", updateImagePreview);
  url.addEventListener("input", () => { urlTab.classList.add("active"); fileTab.classList.remove("active"); });
  width.addEventListener("input", applyPreviewLayout);
  alt.addEventListener("input", () => { previewImage.alt = alt.value; });

  const foot = document.createElement("div");
  foot.className = "image-modal-actions";
  const cancel = button("Cancelar", "mini");
  cancel.addEventListener("click", closeModal);
  const save = button("Guardar", "primary");
  save.addEventListener("click", () => {
    if (!url.value.trim() || (width.value.trim() && (!/^\d+(?:[.,]\d+)?$/.test(width.value.trim()) || (unit === "%" && Number(width.value.replace(",", ".")) > 100))) ||
      (heightField.input.value.trim() && !/^\d+(?:\.\d+)?(?:px|mm|cm|pt|%)$/.test(heightField.input.value.trim()))) {
      setStatus("Indica URL, ancho y alto válidos", "bad");
      return;
    }
    if (referenceField.input.value.trim() && !/^fig:[A-Za-z0-9_.-]+$/.test(referenceField.input.value.trim())) {
      setStatus("La referencia debe tener el formato fig:logo-upc", "bad");
      referenceField.input.focus();
      return;
    }
    if (linkField.input.value.trim() && !/^(?:https?:\/\/|mailto:|#|(?!(?:[a-z][a-z0-9+.-]*:|\/\/))[^\s<>]+$)/i.test(linkField.input.value.trim())) {
      setStatus("El enlace debe ser https://, mailto:, # o una ruta relativa", "bad");
      linkField.input.focus();
      return;
    }
    const quote = (value) => String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    let updated = isHtml ? tag : "<img>";
    const attrs = [["alt", alt.value], ["src", url.value.trim()],
      ["width", width.value.trim() ? `${width.value.replace(",", ".")}${unit === "%" ? "%" : ""}` : ""],
      ["height", heightField.input.value.trim().replace(/^(\d+(?:\.\d+)?)px$/i, "$1")], ["id", referenceField.input.value.trim()]];
    for (const [name, value] of attrs) {
      const re = new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, "i");
      if (!value) updated = updated.replace(re, "");
      else updated = re.test(updated) ? updated.replace(re, ` ${name}="${quote(value)}"`) : updated.replace(/\s*(\/?)>$/, ` ${name}="${quote(value)}"$1>`);
    }
    if (inTable) {
      // Un width inline antiguo tiene prioridad sobre el atributo width.
      // Quitarlo permite que el nuevo tamaño del panel surta efecto.
      updated = updated.replace(/\sstyle\s*=\s*("[^"]*"|'[^']*')/i, (whole, quoted) => {
        const styles = quoted.slice(1, -1).split(";").filter((part) => !/^\s*(?:width|height)\s*:/i.test(part) && part.trim());
        return styles.length ? ` style="${styles.join(";").replace(/"/g, "&quot;")}"` : "";
      });
    }
    let from = before + match.index;
    let to = from + tag.length;
    if (isHtml && wrapper && !inTable) {
      const opening = wrapper[0];
      const closing = new RegExp(`^(?:\\s*<\\/a>)?(?:\\s*<br\\s*\\/?>\\s*<em\\s+class=["']image-caption["']>[\\s\\S]*?<\\/em>)?\\s*<\\/${wrapper[1]}>`, "i").exec(region.slice(match.index + tag.length));
      if (closing) {
        from -= opening.length;
        to += closing[0].length;
      }
    }
    const linked = linkField.input.value.trim() ? `<a href="${quote(linkField.input.value.trim())}">${updated}</a>` : updated;
    const note = captionField.input.value.trim() ? `<br><em class="image-caption">${quote(captionField.input.value.trim())}</em>` : "";
    // Un div dentro de td/th rompe el DOM de la tabla y mueve la imagen fuera
    // de su celda. En tablas conservar contenido inline, sin envoltorios.
    const replacement = inTable ? `${linked}${note}` : `<div align="${selectedAlign}">\n${linked}${note}\n</div>`;
    editor.replaceRange(from, to, replacement);
    closeModal();
    onSaved?.();
  });
  foot.append(cancel, save);
  openModal({ title: "Editar imagen", body, footer: foot, size: "image" });
  updateImagePreview();
  url.focus();
}

function findImageWidth(text, rel) {
  const escaped = rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\]\\(\\s*${escaped}[^)]*\\)\\{([^}]*)\\}`);
  const match = text.match(re);
  if (!match) return null;
  const width = match[1].match(/width\s*=\s*([\d.]+)\s*%?/);
  return width ? Number(width[1]) : null;
}

function setImageWidth(editor, rel, pct) {
  const text = editor.getValue();
  const escaped = rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(!\\[[^\\]]*\\]\\(\\s*${escaped}(?:\\s+"[^"]*")?\\s*\\))(\\{[^}]*\\})?`, "g");
  let found = false;

  const next = text.replace(re, (match, base, attrs) => {
    found = true;
    if (!attrs) return `${base}{width=${pct}%}`;
    let inner = attrs.slice(1, -1).trim();
    if (/width\s*=\s*\S+/.test(inner)) inner = inner.replace(/width\s*=\s*\S+/, `width=${pct}%`);
    else inner = `${inner} width=${pct}%`.trim();
    return `${base}{${inner}}`;
  });

  if (found) editor.setValue(next);
  return found;
}

// ============================================================================
//  Fórmulas: editor con vista previa real (Typst) e inserción en el cursor
// ============================================================================

const SYMBOLS = [
  ["\\frac{a}{b}", "a/b"],
  ["\\sqrt{x}", "√"],
  ["x^{2}", "x²"],
  ["x_{i}", "xᵢ"],
  ["\\sum_{i=1}^{n}", "∑"],
  ["\\int_{a}^{b}", "∫"],
  ["\\alpha", "α"],
  ["\\beta", "β"],
  ["\\gamma", "γ"],
  ["\\theta", "θ"],
  ["\\lambda", "λ"],
  ["\\mu", "μ"],
  ["\\sigma", "σ"],
  ["\\pi", "π"],
  ["\\le", "≤"],
  ["\\ge", "≥"],
  ["\\ne", "≠"],
  ["\\times", "×"],
  ["\\cdot", "·"],
  ["\\infty", "∞"],
  ["\\partial", "∂"],
  ["\\nabla", "∇"],
  ["\\rightarrow", "→"],
  ["\\Rightarrow", "⇒"],
  ["\\approx", "≈"],
  ["\\pm", "±"],
];

export async function openFormulaEditor({ api, editor, setStatus, onSaved }) {
  const prefs = await api.getPrefs().catch(() => ({}));
  const body = document.createElement("div");
  body.className = "formula-layout";

  const left = document.createElement("div");
  left.className = "formula-left";

  const textarea = document.createElement("textarea");
  textarea.className = "formula-input";
  textarea.placeholder = "\\frac{\\partial C}{\\partial t} = \\nabla \\cdot (D \\nabla C)";
  textarea.spellcheck = false;

  const symbols = document.createElement("div");
  symbols.className = "symbols";
  for (const [snippet, label] of SYMBOLS) {
    const node = document.createElement("button");
    node.className = "mini";
    node.textContent = label;
    node.title = snippet;
    node.addEventListener("click", () => {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.value = textarea.value.slice(0, start) + snippet + textarea.value.slice(end);
      textarea.selectionStart = textarea.selectionEnd = start + snippet.length;
      textarea.focus();
      schedule();
    });
    symbols.append(node);
  }

  const modeSeg = document.createElement("div");
  modeSeg.className = "seg";
  const btnDisplay = button("En bloque");
  const btnInline = button("En línea");
  btnDisplay.classList.add("active");
  modeSeg.append(btnDisplay, btnInline);

  const modeRow = document.createElement("div");
  modeRow.className = "tool-row";
  modeRow.append(document.createTextNode("Modo:"), modeSeg);

  // --- favoritos ------------------------------------------------------------

  const FAV_KEY = "informe.formulaFavorites";
  const DEFAULT_FAVS = [
    { name: "Fracción", latex: "\\frac{a}{b}" },
    { name: "Suma", latex: "\\sum_{i=1}^{n} x_i" },
    { name: "Integral", latex: "\\int_{a}^{b} f(x)\\,dx" },
    { name: "Derivada", latex: "\\frac{d y}{d x}" },
  ];

  const loadFavs = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(FAV_KEY));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const saveFavs = (list) => {
    localStorage.setItem(FAV_KEY, JSON.stringify(list.slice(0, 40)));
    api.setPrefs({ formulaFavorites: list.slice(0, 40) }).catch(() => {});
  };

  let favorites = Array.isArray(prefs.formulaFavorites) ? prefs.formulaFavorites : loadFavs();
  if (!favorites.length) favorites = DEFAULT_FAVS.map((item) => ({ ...item }));

  const favBox = document.createElement("div");
  favBox.className = "favorites";
  const favHead = document.createElement("div");
  favHead.className = "tool-label";
  favHead.textContent = "Favoritos";
  const favList = document.createElement("div");
  favList.className = "fav-list";
  const favSaveRow = document.createElement("div");
  favSaveRow.className = "fav-save";
  const favName = document.createElement("input");
  favName.className = "fav-name";
  favName.placeholder = "Nombre de la fórmula";
  const favSave = button("Guardar favorito", "mini");
  favSaveRow.append(favName, favSave);

  function renderFavorites() {
    favList.innerHTML = "";
    favorites.forEach((favorite, index) => {
      const chip = document.createElement("span");
      chip.className = "fav-chip";

      const load = button(favorite.name, "mini");
      load.title = favorite.latex;
      load.addEventListener("click", () => {
        textarea.value = favorite.latex;
        textarea.focus();
        schedule();
      });

      const remove = button("×", "fav-del");
      remove.title = "Quitar de favoritos";
      remove.addEventListener("click", () => {
        favorites.splice(index, 1);
        saveFavs(favorites);
        renderFavorites();
      });

      chip.append(load, remove);
      favList.append(chip);
    });
  }

  favSave.addEventListener("click", () => {
    const latex = textarea.value.trim();
    if (!latex) {
      setStatus("Escribe una fórmula primero", "bad");
      return;
    }
    const name = favName.value.trim() || `Fórmula ${favorites.length + 1}`;
    favorites.push({ name, latex });
    saveFavs(favorites);
    favName.value = "";
    renderFavorites();
  });

  favName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      favSave.click();
    }
  });

  renderFavorites();
  favBox.append(favHead, favList, favSaveRow);

  left.append(textarea, symbols, modeRow, favBox);

  const right = document.createElement("div");
  right.className = "formula-right";
  const preview = document.createElement("div");
  preview.className = "formula-preview";
  preview.innerHTML = '<span class="hint">Escribe una fórmula…</span>';
  const errorBox = document.createElement("pre");
  errorBox.className = "formula-error hidden";
  right.append(preview, errorBox);

  body.append(left, right);

  let display = true;
  let timer = null;
  let lastSvg = null;

  btnDisplay.addEventListener("click", () => {
    display = true;
    btnDisplay.classList.add("active");
    btnInline.classList.remove("active");
    render();
  });
  btnInline.addEventListener("click", () => {
    display = false;
    btnInline.classList.add("active");
    btnDisplay.classList.remove("active");
    render();
  });

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(render, 280);
  }

  async function render() {
    const latex = textarea.value.trim();
    if (!latex) {
      preview.innerHTML = '<span class="hint">Escribe una fórmula…</span>';
      errorBox.classList.add("hidden");
      lastSvg = null;
      return;
    }

    const result = await api.formulaPreview(latex, display);
    if (result.ok) {
      lastSvg = result.svg;
      preview.innerHTML = result.svg;
      errorBox.classList.add("hidden");
    } else {
      lastSvg = null;
      preview.innerHTML = '<span class="hint">Error en la fórmula</span>';
      errorBox.textContent = result.error;
      errorBox.classList.remove("hidden");
    }
  }

  textarea.addEventListener("input", schedule);

  const foot = document.createElement("div");
  foot.style.display = "flex";
  foot.style.alignItems = "center";
  foot.style.width = "100%";
  foot.style.gap = "8px";

  const hint = document.createElement("span");
  hint.className = "hint";
  hint.textContent = "Se inserta en el cursor del documento.";
  const spacer = document.createElement("span");
  spacer.className = "spacer";

  const cancel = button("Cancelar");
  cancel.addEventListener("click", closeModal);

  const insert = button("Insertar", "primary");
  insert.addEventListener("click", () => {
    const latex = textarea.value.trim();
    if (!latex) {
      setStatus("Escribe una fórmula primero", "bad");
      return;
    }
    const snippet = display ? `\n$$\n${latex}\n$$\n` : `$${latex}$`;
    editor.insertAtCursor(snippet);
    closeModal();
    if (onSaved) onSaved();
  });

  foot.append(hint, spacer, cancel, insert);

  openModal({ title: "Fórmula", body, footer: foot, size: "md" });
  textarea.focus();
  render();
}

// ============================================================================
//  Tablas: editor estilo Word e inserción
// ============================================================================

export { findTables, openInsertTable, openTableEditor, tableAtLine } from "./table-editor.js";

// ============================================================================
//  Diálogos simples: nombre y confirmación
// ============================================================================

export function openPrompt({ title, label, placeholder = "", value = "", confirmLabel = "Crear", onOk }) {
  const body = document.createElement("div");
  body.className = "prompt";

  const labelEl = document.createElement("label");
  labelEl.textContent = label;
  const input = document.createElement("input");
  input.className = "prompt-input";
  input.placeholder = placeholder;
  input.value = value;
  const error = document.createElement("div");
  error.className = "prompt-error";
  body.append(labelEl, input, error);

  const foot = document.createElement("div");
  foot.style.display = "flex";
  foot.style.gap = "8px";
  foot.style.justifyContent = "flex-end";
  foot.style.width = "100%";

  const cancel = document.createElement("button");
  cancel.textContent = "Cancelar";
  cancel.className = "mini";
  cancel.addEventListener("click", closeModal);

  const accept = document.createElement("button");
  accept.textContent = confirmLabel;
  accept.className = "primary small";

  let busy = false;
  const submit = async () => {
    if (busy) return;
    const name = input.value.trim();
    if (!name) {
      error.textContent = "Escribe un nombre";
      return;
    }
    busy = true;
    accept.disabled = true;
    try {
      await onOk(name);
      closeModal();
    } catch (exception) {
      error.textContent = String(exception.message ?? exception);
      busy = false;
      accept.disabled = false;
    }
  };

  accept.addEventListener("click", submit);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  });

  foot.append(cancel, accept);
  openModal({ title, body, footer: foot, size: "sm" });
  input.focus();
  input.select();
}

export function openConfirm({ title, message, confirmLabel = "Eliminar", onOk }) {
  const body = document.createElement("div");
  body.className = "prompt";
  const text = document.createElement("p");
  text.style.margin = "4px 0 12px";
  text.textContent = message;
  const error = document.createElement("div");
  error.className = "prompt-error";
  body.append(text, error);

  const foot = document.createElement("div");
  foot.style.display = "flex";
  foot.style.gap = "8px";
  foot.style.justifyContent = "flex-end";
  foot.style.width = "100%";

  const cancel = document.createElement("button");
  cancel.textContent = "Cancelar";
  cancel.className = "mini";
  cancel.addEventListener("click", closeModal);

  const accept = document.createElement("button");
  accept.textContent = confirmLabel;
  accept.className = "primary small";
  accept.addEventListener("click", async () => {
    accept.disabled = true;
    try {
      await onOk();
      closeModal();
    } catch (exception) {
      error.textContent = String(exception.message ?? exception);
      accept.disabled = false;
    }
  });

  foot.append(cancel, accept);
  openModal({ title, body, footer: foot, size: "sm" });
  accept.focus();
}
