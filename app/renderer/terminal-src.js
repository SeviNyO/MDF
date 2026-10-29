import { Terminal } from "@xterm/xterm";

const LIGHT_THEME = {
  background: "#fbfcfd",
  foreground: "#263241",
  cursor: "#1e3a5f",
  cursorAccent: "#fbfcfd",
  selectionBackground: "#cfe0f0",
  black: "#263241",
  red: "#b91c1c",
  green: "#15803d",
  yellow: "#a16207",
  blue: "#1e5f9e",
  magenta: "#7e22ce",
  cyan: "#0e7490",
  white: "#e5e7eb",
  brightBlack: "#6b7684",
  brightRed: "#dc2626",
  brightGreen: "#16a34a",
  brightYellow: "#ca8a04",
  brightBlue: "#2563eb",
  brightMagenta: "#9333ea",
  brightCyan: "#0891b2",
  brightWhite: "#ffffff",
};

const DARK_THEME = {
  background: "#0f0f0f",
  foreground: "#edecee",
  cursor: "#a277ff",
  cursorAccent: "#0f0f0f",
  selectionBackground: "#604888",
  black: "#15141b",
  red: "#ff6767",
  green: "#61ffca",
  yellow: "#ffca85",
  blue: "#82e2ff",
  magenta: "#f694ff",
  cyan: "#82e2ff",
  white: "#edecee",
  brightBlack: "#a9a4b4",
  brightRed: "#ff8f8f",
  brightGreen: "#91ffd9",
  brightYellow: "#ffddb0",
  brightBlue: "#b7efff",
  brightMagenta: "#ffd0ff",
  brightCyan: "#b7efff",
  brightWhite: "#ffffff",
};
import { FitAddon } from "@xterm/addon-fit";

export function createTerminal({ parent, onData, onResize, onSelection }) {
  const term = new Terminal({
    fontFamily: '"JetBrains Mono", "DejaVu Sans Mono", monospace',
    fontSize: 12,
    lineHeight: 1.35,
    cursorBlink: true,
    scrollback: 5000,
    allowProposedApi: true,
    theme: LIGHT_THEME,
  });

  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(parent);

  if (onResize) {
    term.onResize(({ cols, rows }) => onResize(cols, rows));
  }
  term.onData(onData);

  if (onSelection) {
    let timer = null;
    term.onSelectionChange(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const text = term.getSelection();
        if (text) onSelection(text);
      }, 35);
    });
  }

  fit.fit();

  return {
    term,
    write: (data) => term.write(data),
    clear: () => term.clear(),
    focus: () => term.focus(),
    setDark: (dark) => {
      term.options.theme = dark ? DARK_THEME : LIGHT_THEME;
    },
    fit: () => fit.fit(),
    dispose: () => term.dispose(),
  };
}
