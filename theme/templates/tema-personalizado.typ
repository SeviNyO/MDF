// ============================================================================
//  PLANTILLA DE TEMA PERSONALIZADO
//  Copia esta plantilla a theme/custom/mi-tema.typ desde la app.
//  Edita colores y diseño sin tocar theme/theme.typ ni el contenido Markdown.
//  API disponible: palette, tline, callout, page-header, page-footer y
//  rules(cfg, body). cover, toc-page y lof-page se conservan por compatibilidad.
//  Los títulos NO deben renumerarse: deja set heading(numbering: none) en rules.
// ============================================================================

#let palette = (
  ink: rgb("#1b1d21"),
  muted: rgb("#5d6672"),
  accent: rgb("#1e3a5f"),
  accent-soft: rgb("#eaf0f6"),
  rule: rgb("#c6d0dc"),
  code-bg: rgb("#f4f6f8"),
)

// --- bloques reutilizables -------------------------------------------------

#let tline = table.hline(stroke: 0.9pt + palette.rule)

// Limita imágenes excepcionalmente altas al área útil y mantiene la
// proporción; las figuras (incluido el pie) se paginan como una sola unidad.
#let fit-image(src, alt: "", width: auto, height: auto, fit: "contain") = context {
  let content = image(src, alt: alt, width: width, height: height, fit: fit)
  let measured = measure(content)
  if measured.height > 205mm or measured.width > 160mm {
    image(
      src, alt: alt,
      width: if measured.width > 160mm { 100% } else { width },
      height: if measured.height > 205mm { 205mm } else { height },
      fit: "contain",
    )
  } else {
    content
  }
}

#let callout(type: "info", title: none, body) = {
  let colors = if type == "warning" {
    (rgb("#b45309"), rgb("#fff8ed"))
  } else if type == "danger" {
    (rgb("#b91c1c"), rgb("#fef2f2"))
  } else if type == "success" {
    (rgb("#15803d"), rgb("#f0fdf4"))
  } else {
    (palette.accent, palette.accent-soft)
  }
  block(
    width: 100%,
    fill: colors.at(1),
    stroke: (left: 3pt + colors.at(0)),
    radius: (right: 3pt),
    inset: (x: 10pt, y: 8pt),
    above: 1em,
    below: 1em,
  )[
    #if title != none {
      set text(size: 9.3pt, weight: "bold", fill: colors.at(0), font: "Source Sans 3")
      title
      v(2pt, weak: true)
    }
    #body
  ]
}

// --- portada ---------------------------------------------------------------

#let cover(cfg) = {
  set align(center)
  v(20mm)
  text(size: 8.6pt, tracking: 1.8pt, fill: palette.muted, font: "Source Sans 3")[
    #upper(cfg.institution)
  ]
  v(4mm)
  rect(width: 34mm, height: 2.2pt, fill: palette.accent)
  v(16mm)
  text(size: 23pt, weight: "bold", fill: palette.accent, font: "Source Sans 3", lang: cfg.lang)[
    #cfg.title
  ]
  v(5mm)
  text(size: 11.5pt, fill: palette.muted, font: "Source Sans 3")[#cfg.subtitle]
  v(40mm)
  text(size: 11pt, weight: "semibold", font: "Source Sans 3")[#cfg.authors.join(", ")]
  v(3mm)
  text(size: 9.6pt, fill: palette.muted)[#cfg.course]
  v(24mm)
  text(size: 9.4pt, fill: palette.muted)[#cfg.date]
  v(1fr)
  line(length: 100%, stroke: 0.5pt + palette.rule)
  v(2pt)
  text(size: 7.8pt, fill: palette.muted, font: "Source Sans 3")[
    Documento reproducible · Markdown → Typst → PDF · Git
  ]
}

// --- índice -----------------------------------------------------------------

#let toc-page(cfg) = {
  text(size: 19pt, weight: "bold", fill: palette.accent, font: "Source Sans 3")[Contenido]
  v(2.5mm)
  line(length: 100%, stroke: 1.4pt + palette.accent)
  v(4mm)
  outline(title: none, indent: auto, depth: 3)
}

#let lof-page(cfg) = {
  text(size: 19pt, weight: "bold", fill: palette.accent, font: "Source Sans 3")[Figuras y tablas]
  v(2.5mm)
  line(length: 100%, stroke: 1.4pt + palette.accent)
  v(5mm)
  text(size: 10.5pt, weight: "semibold", fill: palette.accent, font: "Source Sans 3")[Figuras]
  v(2mm)
  outline(title: none, target: figure.where(kind: image), depth: 1)
  v(7mm)
  text(size: 10.5pt, weight: "semibold", fill: palette.accent, font: "Source Sans 3")[Tablas]
  v(2mm)
  outline(title: none, target: figure.where(kind: table), depth: 1)
}

// --- cabecera y pie ---------------------------------------------------------

#let page-header(cfg) = context {
  set text(size: 7.8pt, fill: palette.muted, font: "Source Sans 3")
  grid(
    columns: (1fr, auto),
    column-gutter: 8pt,
    [#cfg.course],
    align(right)[#cfg.title],
  )
  v(1.5pt)
  line(length: 100%, stroke: 0.6pt + palette.rule)
}

#let page-footer(cfg) = context {
  set text(size: 8.6pt, fill: palette.muted, font: "Source Sans 3")
  line(length: 100%, stroke: 0.4pt + palette.rule)
  v(2pt)
  align(center)[#counter(page).display()]
}

// --- reglas globales --------------------------------------------------------

#let rules(cfg, body) = {
  set document(title: cfg.title, author: cfg.authors)

  set page(
    paper: cfg.page.size,
    margin: (
      top: cfg.page.top * 1mm,
      bottom: cfg.page.bottom * 1mm,
      left: cfg.page.left * 1mm,
      right: cfg.page.right * 1mm,
    ),
    header: page-header(cfg),
    footer: page-footer(cfg),
  )

  set text(
    font: "Source Serif 4",
    size: cfg.page.fontsize * 1pt,
    lang: cfg.lang,
    hyphenate: true,
    fill: palette.ink,
  )
  set par(justify: true, leading: 0.71em, spacing: 0.95em)
  show raw: set text(font: "JetBrains Mono", size: 8.7pt)
  set footnote(numbering: "1")
  show footnote.entry: set text(size: 8.4pt, fill: palette.muted)

  // títulos
  set heading(numbering: none)
  show heading: set text(font: "Source Sans 3", fill: palette.accent)
  show heading: it => {
    if it.numbering != none {
      context counter(heading).display(it.numbering)
      h(0.55em, weak: true)
    }
    it.body
  }
  show heading.where(level: 1): it => {
    pagebreak(weak: true)
    block(above: 0pt, below: 13pt, sticky: true)[
      #set text(size: 19.5pt, weight: "bold")
      #if it.numbering != none {
        context counter(heading).display(it.numbering)
        h(0.5em, weak: true)
      }
      #it.body
      #v(3pt, weak: true)
      #line(length: 100%, stroke: 1.4pt + palette.accent)
    ]
  }
  show heading.where(level: 2): it => block(above: 1.5em, below: 0.5em, sticky: true)[
    #set text(size: 13pt, weight: "semibold")
    #if it.numbering != none {
      context counter(heading).display(it.numbering)
      h(0.5em, weak: true)
    }
    #it.body
  ]
  show heading.where(level: 3): it => block(above: 1.3em, below: 0.45em, sticky: true)[
    #set text(size: 11.4pt, weight: "semibold")
    #if it.numbering != none {
      context counter(heading).display(it.numbering)
      h(0.5em, weak: true)
    }
    #it.body
  ]
  show heading.where(level: 4): it => block(above: 1.1em, below: 0.4em, sticky: true)[
    #set text(size: 10.8pt, weight: "semibold")
    #if it.numbering != none {
      context counter(heading).display(it.numbering)
      h(0.5em, weak: true)
    }
    #it.body
  ]
  show heading.where(level: 5): it => block(above: 1em, below: 0.4em, sticky: true)[
    #set text(size: 10.5pt, weight: "semibold")
    #if it.numbering != none {
      context counter(heading).display(it.numbering)
      h(0.5em, weak: true)
    }
    #it.body
  ]
  show heading.where(level: 6): it => block(above: 0.9em, below: 0.4em, sticky: true)[
    #set text(size: 10pt, weight: "semibold")
    #if it.numbering != none {
      context counter(heading).display(it.numbering)
      h(0.5em, weak: true)
    }
    #it.body
  ]

  // figuras y tablas
  show figure.where(kind: image): set figure(supplement: [Figura], numbering: "1", gap: 0.7em)
  show figure.where(kind: table): set figure(supplement: [Tabla], numbering: "1", gap: 0.7em)
  show figure.caption: set text(size: 9pt, fill: palette.muted)
  show outline.entry: set block(above: 0.32em, below: 0em)
  show outline.entry.where(level: 1): set text(weight: "semibold")
  show figure: set block(breakable: false, above: 1em, below: 1.1em)

  show table: it => {
    set table(inset: (x: 0.6em, y: 0.45em))
    show table.cell.where(y: 0): set table.cell(fill: palette.accent-soft)
    show table.cell.where(y: 0): set text(weight: "bold", fill: palette.accent, size: 9.5pt)
    it
  }

  // código
  show raw.where(block: true): it => block(
    width: 100%,
    fill: palette.code-bg,
    inset: 9pt,
    radius: 3pt,
    above: 0.8em,
    below: 0.8em,
  )[
    #set text(size: 8.4pt)
    #it
  ]
  show raw.where(block: false): it => box(
    fill: palette.code-bg,
    inset: (x: 2.5pt, y: 0.6pt),
    radius: 2pt,
    text(font: "JetBrains Mono", size: 8.6pt, it),
  )

  // citas y enlaces
  show quote.where(block: true): it => block(
    width: 100%,
    stroke: (left: 2.5pt + palette.rule),
    inset: (left: 10pt, y: 2pt),
    above: 0.9em,
    below: 0.9em,
  )[
    #set text(fill: palette.muted, style: "italic")
    #it
  ]
  show link: set text(fill: palette.accent)

  // listas un poco más compactas
  set list(spacing: 0.55em)
  set enum(spacing: 0.55em)

  body
}
