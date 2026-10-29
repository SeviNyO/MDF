// ============================================================================
//  Portapapeles de estilos y menú contextual compartido
// ============================================================================

let clipboard = null;

export function setStyle(style) {
  clipboard = style;
}

export function getStyle() {
  return clipboard;
}

export function hasStyle() {
  return Boolean(clipboard);
}

export function openContextMenu(x, y, items) {
  document.querySelectorAll(".context-menu").forEach((node) => node.remove());

  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - 220))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - Math.min(items.length * 36 + 12, window.innerHeight - 16) - 8))}px`;

  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement("div");
      sep.className = "context-sep";
      menu.append(sep);
      continue;
    }
    const node = document.createElement("button");
    node.textContent = item.label;
    if (item.disabled) node.disabled = true;
    node.addEventListener("click", () => {
      menu.remove();
      item.action?.();
    });
    menu.append(node);
  }

  document.body.append(menu);

  const close = (event) => {
    if (!menu.contains(event.target)) {
      menu.remove();
      document.removeEventListener("mousedown", close, true);
    }
  };
  setTimeout(() => document.addEventListener("mousedown", close, true), 0);

  return menu;
}
