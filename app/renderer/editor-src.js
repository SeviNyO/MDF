import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, dropCursor, highlightSpecialChars, Decoration } from "@codemirror/view";
import { EditorState, Compartment, StateField, StateEffect } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  syntaxHighlighting,
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  HighlightStyle,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { tags } from "@lezer/highlight";

const lightTheme = EditorView.theme(
  {
    "&": {
      fontSize: "13.5px",
      fontFamily: '"Source Sans 3", "Cantarell", "DejaVu Sans", sans-serif',
      height: "100%",
      color: "#1b1d21",
      backgroundColor: "#ffffff",
    },
    ".cm-scroller": {
      fontFamily: '"Source Sans 3", "Cantarell", "DejaVu Sans", sans-serif',
      fontSize: "14px",
      lineHeight: "1.7",
      padding: "10px 0 40px",
    },
    ".cm-content": { caretColor: "#1e3a5f", maxWidth: "920px" },
    ".cm-gutters": {
      backgroundColor: "#fbfcfd",
      color: "#9aa4b2",
      border: "none",
      paddingRight: "4px",
    },
    ".cm-activeLineGutter": { backgroundColor: "#eef3f8", color: "#1e3a5f" },
    ".cm-activeLine": { backgroundColor: "#f7fafc" },
    "& ::selection": { backgroundColor: "#a3c6e8" },
    ".cm-content ::selection": { backgroundColor: "#a3c6e8" },
    ".cm-selectionMatch": { backgroundColor: "#fde68a", borderRadius: "2px" },
    ".cm-cursor": { borderLeftColor: "#1e3a5f", borderLeftWidth: "1.5px" },
    ".cm-foldGutter span": { color: "#8aa0b8" },
    ".cm-flash-line": { backgroundColor: "rgba(250, 204, 21, 0.28)" },
  },
  { dark: false },
);

const darkTheme = EditorView.theme(
  {
    "&": {
      fontSize: "13.5px",
      fontFamily: '"Source Sans 3", "Cantarell", "DejaVu Sans", sans-serif',
      height: "100%",
      color: "#edecee",
      backgroundColor: "#0f0f0f",
    },
    ".cm-scroller": {
      fontFamily: '"Source Sans 3", "Cantarell", "DejaVu Sans", sans-serif',
      fontSize: "14px",
      lineHeight: "1.7",
      padding: "10px 0 40px",
    },
    ".cm-content": { caretColor: "#a277ff", maxWidth: "920px" },
    ".cm-gutters": {
      backgroundColor: "#15141b",
      color: "#b0aab9",
      border: "none",
      paddingRight: "4px",
    },
    ".cm-activeLineGutter": { backgroundColor: "#211e29", color: "#a277ff" },
    ".cm-activeLine": { backgroundColor: "#1b1822" },
    "& ::selection": { backgroundColor: "#604888" },
    ".cm-content ::selection": { backgroundColor: "#604888" },
    ".cm-selectionMatch": { backgroundColor: "#5b395c", borderRadius: "2px" },
    ".cm-cursor": { borderLeftColor: "#a277ff", borderLeftWidth: "1.5px" },
    ".cm-foldGutter span": { color: "#a9a4b4" },
    ".cm-flash-line": { backgroundColor: "rgba(255, 202, 133, 0.22)" },
  },
  { dark: true },
);

const lightHighlight = HighlightStyle.define([
  { tag: tags.heading1, color: "#1e3a5f", fontWeight: "700", fontSize: "1.18em" },
  { tag: tags.heading2, color: "#1e3a5f", fontWeight: "700" },
  { tag: tags.heading3, color: "#2c5282", fontWeight: "600" },
  { tag: [tags.heading4, tags.heading5, tags.heading6], color: "#2c5282" },
  { tag: tags.strong, fontWeight: "700", color: "#111827" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through", color: "#8a94a3" },
  { tag: tags.link, color: "#1e5f9e", textDecoration: "underline" },
  { tag: tags.url, color: "#5d6672" },
  { tag: tags.monospace, color: "#9a3412", backgroundColor: "#f6f1ec", fontFamily: '"JetBrains Mono", monospace' },
  { tag: tags.quote, color: "#5d6672", fontStyle: "italic" },
  { tag: tags.meta, color: "#6b7c93", fontFamily: '"JetBrains Mono", monospace' },
  { tag: tags.comment, color: "#7c8794" },
  { tag: tags.keyword, color: "#1e3a5f" },
  { tag: tags.string, color: "#166534" },
]);

const darkHighlight = HighlightStyle.define([
  { tag: tags.heading1, color: "#a277ff", fontWeight: "700", fontSize: "1.18em" },
  { tag: tags.heading2, color: "#a277ff", fontWeight: "700" },
  { tag: tags.heading3, color: "#f694ff", fontWeight: "600" },
  { tag: [tags.heading4, tags.heading5, tags.heading6], color: "#f694ff" },
  { tag: tags.strong, fontWeight: "700", color: "#f3f5f8" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through", color: "#8a94a3" },
  { tag: tags.link, color: "#82e2ff", textDecoration: "underline" },
  { tag: tags.url, color: "#9aa6b4" },
  { tag: tags.monospace, color: "#ffca85", backgroundColor: "#29221b", fontFamily: '"JetBrains Mono", monospace' },
  { tag: tags.quote, color: "#9aa6b4", fontStyle: "italic" },
  { tag: tags.meta, color: "#a8a3b2", fontFamily: '"JetBrains Mono", monospace' },
  { tag: tags.comment, color: "#7f8d9c" },
  { tag: tags.keyword, color: "#a277ff" },
  { tag: tags.string, color: "#61ffca" },
]);

const flashEffect = StateEffect.define();

const flashField = StateField.define({
  create: () => Decoration.none,
  update(decorations, transaction) {
    let next = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(flashEffect)) continue;
      next =
        effect.value == null
          ? Decoration.none
          : Decoration.set([Decoration.line({ class: "cm-flash-line" }).range(effect.value)]);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function createEditor({ parent, doc, onChange, onCursorLine }) {
  const themeCompartment = new Compartment();
  const languageCompartment = new Compartment();
  let isDark = false;
  let isLarge = false;

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        dropCursor(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        languageCompartment.of(markdown()),
        EditorView.lineWrapping,
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        // Evita que arrastrar una selección mueva el texto.
        EditorView.domEventHandlers({
          dragstart: (event) => {
            event.preventDefault();
            return true;
          },
        }),
        EditorView.updateListener.of((update) => {
          // No serializamos el documento en cada tecla: en un informe de 600
          // páginas toString() es O(n) y bloquea la escritura. saveNow() lo
          // convierte una sola vez, cuando toca guardar.
          if (update.docChanged) onChange();
          // Solo sincronizamos al mover el cursor, no al teclear.
          if (update.selectionSet && !update.docChanged && onCursorLine) {
            const line = update.state.doc.lineAt(update.state.selection.main.head).number;
            onCursorLine(line);
          }
        }),
        flashField,
        themeCompartment.of([lightTheme, syntaxHighlighting(lightHighlight)]),
      ],
    }),
  });

  return {
    view,
    getValue: () => view.state.doc.toString(),
    getLength: () => view.state.doc.length,
    getRange: (from, to) => view.state.sliceDoc(from, to),
    getLineStart: (line) => {
      const doc = view.state.doc;
      return doc.line(Math.min(Math.max(1, line), doc.lines)).from;
    },
    setValue: (text) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
    },
    focus: () => view.focus(),
    setDark: (dark) => {
      isDark = dark;
      view.dispatch({
        effects: themeCompartment.reconfigure(
          isLarge
            ? [dark ? darkTheme : lightTheme]
            : [dark ? darkTheme : lightTheme, syntaxHighlighting(dark ? darkHighlight : lightHighlight)],
        ),
      });
    },
    setLargeDoc: (large) => {
      if (isLarge === large) return;
      isLarge = large;
      view.dispatch({
        effects: [
          languageCompartment.reconfigure(large ? [] : markdown()),
          themeCompartment.reconfigure(
            large
              ? [isDark ? darkTheme : lightTheme]
              : [isDark ? darkTheme : lightTheme, syntaxHighlighting(isDark ? darkHighlight : lightHighlight)],
          ),
        ],
      });
    },
    getCursorLine: () => view.state.doc.lineAt(view.state.selection.main.head).number,
    getLineAtCoords: (x, y) => {
      const pos = view.posAtCoords({ x, y });
      return pos == null ? null : view.state.doc.lineAt(pos).number;
    },
    getPosAtCoords: (x, y) => view.posAtCoords({ x, y }),
    scrollToLine: (line) => {
      const target = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines));
      view.dispatch({ effects: EditorView.scrollIntoView(target.from, { y: "center" }) });
    },
    getSelectionInfo: () => {
      const { from, to } = view.state.selection.main;
      return { from, to, line: view.state.doc.lineAt(from).number, text: view.state.sliceDoc(from, to) };
    },
    getCursorInfo: () => {
      const pos = view.state.selection.main.head;
      const line = view.state.doc.lineAt(pos);
      return { pos, line: line.number, ch: pos - line.from, text: line.text, from: line.from };
    },
    coordsAt: (pos) => view.coordsAtPos(pos),
    replaceRange: (from, to, text) => {
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
      view.focus();
    },
    setSelection: (anchor, head = anchor) => {
      view.dispatch({ selection: { anchor, head } });
      view.focus();
    },
    revealLine: (line) => {
      const doc = view.state.doc;
      const target = doc.line(Math.min(Math.max(1, line), doc.lines));
      view.dispatch({
        selection: { anchor: target.from },
        effects: EditorView.scrollIntoView(target.from, { y: "center" }),
      });
      view.focus();
    },
    flashLine: (line) => {
      const doc = view.state.doc;
      const target = doc.line(Math.min(Math.max(1, line), doc.lines));
      view.dispatch({ effects: flashEffect.of(target.from) });
      clearTimeout(view._flashTimer);
      view._flashTimer = setTimeout(() => {
        view.dispatch({ effects: flashEffect.of(null) });
      }, 1700);
    },
    selectMatch: (line, text) => {
      const doc = view.state.doc;
      const target = doc.line(Math.min(Math.max(1, line), doc.lines));
      const content = target.text;
      const index = content.toLowerCase().indexOf(String(text ?? "").toLowerCase());
      const from = target.from + (index >= 0 ? index : 0);
      const to = index >= 0 ? from + String(text).length : target.to;
      view.dispatch({
        selection: { anchor: from, head: to },
        effects: EditorView.scrollIntoView(from, { y: "center" }),
      });
      view.focus();
    },
    insertAtCursor: (text) => {
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
      });
      view.focus();
    },
    replaceLines: (fromLine, toLine, text) => {
      const doc = view.state.doc;
      const from = doc.line(fromLine).from;
      const to = doc.line(toLine).to;
      view.dispatch({ changes: { from, to, insert: text } });
    },
  };
}
