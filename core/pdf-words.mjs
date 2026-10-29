// Coordenadas de glifos extraídas del PDF compilado, no del tamaño del SVG.
function decode(value) {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
    if (entity[0] === "#") return String.fromCodePoint(parseInt(entity.slice(entity[1].toLowerCase() === "x" ? 2 : 1), entity[1].toLowerCase() === "x" ? 16 : 10));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[entity.toLowerCase()] ?? _;
  });
}

export function parsePdfWords(xml) {
  const words = [];
  let page = 0;
  for (const part of xml.matchAll(/<page\b[^>]*>|<word\b[^>]*>[\s\S]*?<\/word>/gi)) {
    const fragment = part[0];
    if (fragment.startsWith("<page")) { page += 1; continue; }
    const read = (name) => Number(new RegExp(`\\b${name}="([\\d.]+)"`).exec(fragment)?.[1]);
    const text = decode(fragment.replace(/^<word\b[^>]*>/i, "").replace(/<\/word>$/i, "")).trim();
    const [x1, y1, x2, y2] = ["xMin", "yMin", "xMax", "yMax"].map(read);
    if (text && [x1, y1, x2, y2].every(Number.isFinite)) words.push({ page, text, x1, y1, x2, y2 });
  }
  return words;
}

export function findPdfPhrase(words, phrase, bounds, occurrence = 0) {
  const tokens = phrase.trim().split(/\s+/).map((token) => token.normalize("NFC"));
  if (!tokens.length || !tokens[0]) return [];
  const nearby = words.filter((word) => {
    if (word.page < bounds.startPage || word.page > bounds.endPage) return false;
    if (word.page === bounds.startPage && word.y1 < bounds.startY - 12) return false;
    if (word.page === bounds.endPage && word.y1 >= bounds.endY) return false;
    return true;
  });
  let seen = 0;
  for (let index = 0; index <= nearby.length - tokens.length; index += 1) {
    if (tokens.every((token, at) => nearby[index + at].text.normalize("NFC") === token)) {
      if (seen++ === occurrence) return nearby.slice(index, index + tokens.length);
    }
  }
  return [];
}
