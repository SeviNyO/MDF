// ============================================================================
//  Adaptación Typst del perfil activo "Proposal" de Beautiful PDF 1.2.4.
//  Origen: configuración instalada; KoPubWorld no está disponible localmente:
//  Noto Serif / Noto Sans son sustituciones, no una copia del motor HTML.
// ============================================================================

#let palette = (
  ink: rgb("#334155"),
  muted: rgb("#64748b"),
  accent: rgb("#0284c7"),
  accent-soft: rgb("#e0f2fe"),
  rule: rgb("#bae6fd"),
  code-bg: rgb("#0f172a"),
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
  v(24mm)
  text(size: 9pt, tracking: 1.5pt, fill: palette.accent, font: "Noto Sans")[
    #upper(cfg.institution)
  ]
  v(6mm)
  line(length: 100%, stroke: 1.5pt + palette.accent)
  v(32mm)
  text(size: 24pt, weight: "bold", fill: rgb("#0f172a"), font: ("Noto Serif", "Source Serif 4"), lang: cfg.lang)[
    #cfg.title
  ]
  v(8mm)
  text(size: 13pt, fill: palette.muted, font: "Noto Sans")[#cfg.subtitle]
  v(50mm)
  text(size: 10.5pt, weight: "semibold", font: "Noto Sans")[#cfg.authors.join(", ")]
  v(4mm)
  text(size: 9.6pt, fill: palette.muted)[#cfg.course]
  v(4mm)
  text(size: 9.4pt, fill: palette.muted)[#cfg.date]
  v(1fr)
  line(length: 100%, stroke: 0.5pt + palette.rule)
  v(2pt)
  text(size: 7.8pt, fill: palette.muted, font: "Source Sans 3")[
    Documento · Beautiful PDF (perfil Proposal)
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
      top: 18mm,
      bottom: 16mm,
      left: 16mm,
      right: 16mm,
    ),
    header: page-header(cfg),
    footer: page-footer(cfg),
  )

  set text(
    font: ("Noto Sans", "Source Sans 3"),
    size: 9.5pt,
    lang: cfg.lang,
    hyphenate: true,
    fill: palette.ink,
  )
  set par(justify: false, leading: 0.5em, spacing: 8pt)
  show raw: set text(font: "JetBrains Mono", size: 8.7pt)
  set footnote(numbering: "1")
  show footnote.entry: set text(size: 8.4pt, fill: palette.muted)

  // títulos
  set heading(numbering: none)
  show heading: set text(font: ("Noto Sans", "Source Sans 3"), fill: palette.accent)
  show heading: it => {
    if it.numbering != none {
      context counter(heading).display(it.numbering)
      h(0.55em, weak: true)
    }
    it.body
  }
  show heading.where(level: 1): it => {
    pagebreak(weak: true)
    block(above: 0pt, below: 8pt, sticky: true)[
      #set text(font: ("Noto Serif", "Source Serif 4"), fill: rgb("#0f172a"), size: 24pt, weight: "bold")
      #set align(center)
      #if it.numbering != none {
        context counter(heading).display(it.numbering)
        h(0.5em, weak: true)
      }
      #it.body
    ]
  }
  show heading.where(level: 2): it => block(above: 16pt, below: 6pt, sticky: true)[
    #set text(font: ("Bitstream Vera Serif", "Source Serif 4"), size: 14pt, weight: "bold", fill: rgb("#3f9ed9"))
    #if it.numbering != none {
      context counter(heading).display(it.numbering)
      h(0.5em, weak: true)
    }
    #it.body
  ]
  show heading.where(level: 3): it => block(above: 14pt, below: 8pt, sticky: true)[
    #set text(size: 11.5pt, weight: "bold", fill: palette.accent)
    #if it.numbering != none {
      context counter(heading).display(it.numbering)
      h(0.5em, weak: true)
    }
    #it.body
  ]
  show heading.where(level: 4): it => block(above: 12pt, below: 6pt, sticky: true)[
    #set text(size: 13pt, weight: "bold", fill: rgb("#1a1a1a"))
    #if it.numbering != none {
      context counter(heading).display(it.numbering)
      h(0.5em, weak: true)
    }
    #it.body
  ]
  show heading.where(level: 5): it => block(above: 10pt, below: 4pt, sticky: true)[
    #set text(size: 12pt, weight: "bold", fill: rgb("#1a1a1a"))
    #if it.numbering != none {
      context counter(heading).display(it.numbering)
      h(0.5em, weak: true)
    }
    #it.body
  ]
  show heading.where(level: 6): it => block(above: 8pt, below: 4pt, sticky: true)[
    #set text(size: 11pt, weight: "bold", fill: rgb("#444444"))
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
    set text(size: 9pt, fill: rgb("#1a1a1a"))
    set table(inset: (x: 7pt, y: 5pt), stroke: 0.5pt + rgb("#bbbbbb"))
    show table.cell.where(y: 0): set table.cell(fill: rgb("#0369a1"))
    show table.cell.where(y: 0): set text(weight: "bold", fill: white, size: 9pt)
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
    #set text(size: 8.5pt, fill: rgb("#e2e8f0"))
    #it
  ]
  show raw.where(block: false): it => box(
    fill: rgb("#ecfeff"),
    inset: (x: 2.5pt, y: 0.6pt),
    radius: 2pt,
    text(font: "JetBrains Mono", size: 10pt, fill: rgb("#0e7490"), it),
  )

  // citas y enlaces
  show quote.where(block: true): it => block(
    width: 100%,
    fill: palette.accent-soft,
    stroke: 0.6pt + palette.rule,
    inset: (left: 12pt, right: 8pt, y: 8pt),
    above: 0.9em,
    below: 0.9em,
  )[
    #set text(fill: rgb("#0369a1"))
    #it
  ]
  show link: set text(fill: palette.accent)

  // listas un poco más compactas
  set list(spacing: 6pt)
  set enum(spacing: 6pt)

  body
}
