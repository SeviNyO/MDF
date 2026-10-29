// Comentario invisible para GitHub/Obsidian; la tabla en sí siempre es GFM.
export const TABLE_META_PREFIX = "mdpdf-table:";

export function attachTableMetadata(tree) {
  function walk(parent) {
    const children = parent.children ?? [];
    for (let i = 1; i < children.length; i += 1) {
      const table = children[i];
      const previous = children[i - 1];
      if (table.type !== "table" || previous.type !== "html") continue;
      const match = /^<!-- mdpdf-table:([^\s<>]+) -->$/.exec(previous.value.trim());
      if (!match) continue;
      try {
        table.data ??= {};
        table.data.tableMeta = JSON.parse(decodeURIComponent(match[1]));
      } catch { /* conservar la tabla GFM aunque el comentario esté dañado */ }
    }
    for (const child of children) walk(child);
  }
  walk(tree);
  return tree;
}
