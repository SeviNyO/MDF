/** Coordenadas pintadas por Typst en el SVG, en puntos de la página. */
export function svgImageBounds(svg) {
  const boxes = [];
  // Typst coloca las imágenes raster como <g transform="translate(x y)"><image
  // ... width="w" height="h"/>. No inferir tamaños de la figura/caption.
  const pattern = /<g\s+transform="translate\(([-\d.]+)[ ,]+([-\d.]+)\)"\s*>\s*<image\b([^>]*?)\/>/g;
  for (const match of String(svg).matchAll(pattern)) {
    const width = Number(/\bwidth="([\d.]+)"/.exec(match[3])?.[1]);
    const height = Number(/\bheight="([\d.]+)"/.exec(match[3])?.[1]);
    const x = Number(match[1]) + Number(/\bx="([\d.]+)"/.exec(match[3])?.[1] ?? 0);
    const y = Number(match[2]) + Number(/\by="([\d.]+)"/.exec(match[3])?.[1] ?? 0);
    if ([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0) {
      boxes.push({ x, y, width, height });
    }
  }
  return boxes;
}
