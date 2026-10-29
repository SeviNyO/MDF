/** Formato sobre el rango seleccionado; no introduce directivas propias. */
export function formatInlineSelection(source, from, to, kind, url = "") {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to > source.length) return null;
  const text = source.slice(from, to);
  const fence = "`".repeat(Math.max(1, ...[...text.matchAll(/`+/g)].map((match) => match[0].length + 1)));
  const wrappers = {
    bold: `**${text}**`, italic: `*${text}*`, underline: `<u>${text}</u>`,
    strike: `~~${text}~~`, math: `$${text}$`,
    code: `${fence}${text}${fence}`,
  };
  if (kind === "clear") {
    const cleared = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/<\/?(?:u|strong|em|del|code)>/gi, "")
      .replace(/(\*\*|__|~~|\*|_|`+|\$)/g, "");
    return { from, to, insert: cleared };
  }
  if (kind === "link") {
    if (!url || /[\s<>]/.test(url) ||
      /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url) && !/^(?:https?:\/\/|mailto:)/i.test(url) ||
      !/^(?:https?:\/\/|mailto:|#|\.?\.?\/|[A-Za-z0-9_-])/.test(url)) return null;
    return { from, to, insert: `[${text}](${url.replace(/[()]/g, (ch) => `\\${ch}`)})` };
  }
  return Object.hasOwn(wrappers, kind) ? { from, to, insert: wrappers[kind] } : null;
}
