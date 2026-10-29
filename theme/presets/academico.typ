// Tema 3 — Académico Estructurado · A4 · celeste y azul institucional
// API: palette, tline, callout, cover, toc-page, lof-page,
// page-header, page-footer y rules. No reescribe la numeración del Markdown.

#let palette = (
  ink: rgb("#202c3b"),
  muted: rgb("#61758a"),
  accent: rgb("#237db7"),
  accent-dark: rgb("#174e7c"),
  accent-soft: rgb("#e8f5fc"),
  accent-pale: rgb("#f4faff"),
  rule: rgb("#c9deec"),
  code-bg: rgb("#f0f6fa"),
)

#let tline = table.hline(stroke: 0.8pt + palette.rule)

#let callout(type: "info", title: none, body) = {
  let colors = if type == "warning" {
    (rgb("#a66c15"), rgb("#fff7e8"))
  } else if type == "danger" {
    (rgb("#a7384b"), rgb("#fff1f3"))
  } else if type == "success" {
    (rgb("#237e76"), rgb("#edf9f6"))
  } else {
    (palette.accent, palette.accent-soft)
  }
  block(
    width: 100%, fill: colors.at(1),
    stroke: (left: 3pt + colors.at(0)), radius: (right: 4pt),
    inset: (x: 11pt, y: 9pt), above: 10pt, below: 10pt,
  )[
    #if title != none {
      text(font: "Source Sans 3", size: 9.5pt, weight: "bold", fill: colors.at(0), title)
      v(4pt)
    }
    #body
  ]
}

#let cover(cfg) = {
  grid(
    columns: (18mm, 1fr), column-gutter: 13mm,
    rect(width: 18mm, height: 214mm, fill: palette.accent-dark, radius: 1pt),
    [
      #v(12mm)
      #text(font: "Source Sans 3", size: 8.5pt, tracking: 1.2pt,
        fill: palette.muted, weight: "semibold", upper(cfg.institution))
      #v(4mm)
      #rect(width: 25mm, height: 2pt, fill: palette.accent)
      #v(28mm)
      #text(font: "Source Sans 3", size: 25pt, weight: "bold",
        fill: palette.accent-dark, lang: cfg.lang, cfg.title)
      #v(7mm)
      #text(font: "Source Serif 4", size: 12pt, fill: palette.muted, cfg.subtitle)
      #v(34mm)
      #line(length: 100%, stroke: 0.7pt + palette.rule)
      #v(7mm)
      #text(font: "Source Sans 3", size: 10.5pt,
        weight: "semibold", cfg.authors.join(", "))
      #v(3mm)
      #text(font: "Source Sans 3", size: 9.5pt, fill: palette.muted, cfg.course)
      #v(3mm)
      #text(font: "Source Sans 3", size: 9pt, fill: palette.muted, cfg.date)
      #v(1fr)
      #text(font: "Source Sans 3", size: 7.5pt, fill: palette.muted)[
        DOCUMENTO ACADÉMICO · MARKDOWN / TYPST
      ]
    ],
  )
}

#let section-banner(title) = block(below: 13pt)[
  #text(font: "Source Sans 3", size: 20pt,
    weight: "bold", fill: palette.accent-dark, title)
  #v(4pt)
  #line(length: 100%, stroke: 1.5pt + palette.accent)
]

#let toc-page(cfg) = {
  section-banner([Contenido])
  outline(title: none, indent: auto, depth: 3)
}

#let lof-page(cfg) = {
  section-banner([Figuras y tablas])
  text(font: "Source Sans 3", size: 11pt, weight: "bold",
    fill: palette.accent-dark)[Figuras]
  v(4pt)
  outline(title: none, target: figure.where(kind: image), depth: 1)
  v(12pt)
  text(font: "Source Sans 3", size: 11pt, weight: "bold",
    fill: palette.accent-dark)[Tablas]
  v(4pt)
  outline(title: none, target: figure.where(kind: table), depth: 1)
}

#let page-header(cfg) = context {
  set text(font: "Source Sans 3", size: 7.8pt, fill: palette.muted)
  grid(columns: (1fr, auto), column-gutter: 10pt,
    [#cfg.course], align(right)[#cfg.title])
  v(3pt)
  line(length: 100%, stroke: 0.65pt + palette.rule)
}

#let page-footer(cfg) = context {
  line(length: 100%, stroke: 0.55pt + palette.rule)
  v(4pt)
  set text(font: "Source Sans 3", size: 8pt, fill: palette.muted)
  grid(columns: (1fr, auto),
    [#cfg.institution],
    text(weight: "bold", fill: palette.accent-dark, counter(page).display()))
}

#let rules(cfg, body) = {
  set document(title: cfg.title, author: cfg.authors)
  set page(
    paper: cfg.page.size,
    margin: (
      top: cfg.page.top * 1mm, bottom: cfg.page.bottom * 1mm,
      left: cfg.page.left * 1mm, right: cfg.page.right * 1mm,
    ),
    header: page-header(cfg), footer: page-footer(cfg),
  )
  set text(font: "Source Serif 4", size: cfg.page.fontsize * 1pt,
    lang: cfg.lang, hyphenate: true, fill: palette.ink)
  set par(justify: true, leading: 0.72em, spacing: 0.9em)
  set footnote(numbering: "1")
  show footnote.entry: set text(size: 8.5pt, fill: palette.muted)

  // El número (si lo hay) forma parte del título escrito por el autor.
  set heading(numbering: none)
  show heading.where(level: 1): it => {
    pagebreak(weak: true)
    block(above: 0pt, below: 15pt, sticky: true)[
      #grid(columns: (11mm, 1fr), column-gutter: 8pt,
        align(center + horizon,
          box(width: 11mm, height: 11mm, fill: palette.accent,
            radius: 1pt)[#align(center + horizon)[
              #text(font: "Source Sans 3", size: 12pt, weight: "bold", fill: white)[§]
            ]]),
        [
          #set text(font: "Source Sans 3", size: 19pt,
            weight: "bold", fill: palette.accent-dark)
          #it.body
        ],
      )
      #v(5pt)
      #line(length: 100%, stroke: 1.25pt + palette.accent)
    ]
  }
  show heading.where(level: 2): it => block(above: 15pt, below: 7pt, sticky: true)[
    #set text(font: "Source Sans 3", size: 12.5pt,
      weight: "semibold", fill: palette.accent-dark)
    #it.body
  ]
  show heading.where(level: 3): it => block(above: 11pt, below: 5pt, sticky: true)[
    #set text(font: "Source Sans 3", size: 10.8pt,
      weight: "semibold", fill: palette.accent)
    #it.body
  ]
  show heading.where(level: 4): it => block(sticky: true, above: 10pt, below: 4pt)[
    #set text(font: "Source Sans 3", weight: "semibold", fill: palette.accent-dark)
    #it.body
  ]
  show heading.where(level: 5): it => block(sticky: true, above: 8pt, below: 4pt)[
    #set text(font: "Source Sans 3", weight: "semibold", fill: palette.accent-dark)
    #it.body
  ]
  show heading.where(level: 6): it => block(sticky: true, above: 8pt, below: 4pt)[
    #set text(font: "Source Sans 3", weight: "semibold", fill: palette.accent-dark)
    #it.body
  ]

  show figure.where(kind: image): set figure(supplement: [Figura], numbering: "1", gap: 0.7em)
  show figure.where(kind: table): set figure(supplement: [Tabla], numbering: "1", gap: 0.7em)
  show figure.caption: set text(font: "Source Sans 3", size: 9pt, fill: palette.muted)
  show figure: set block(breakable: false, above: 11pt, below: 11pt)
  show table: it => {
    set table(inset: (x: 7pt, y: 6pt), stroke: 0.45pt + palette.rule)
    show table.cell.where(y: 0): set table.cell(fill: palette.accent-soft)
    show table.cell.where(y: 0): set text(font: "Source Sans 3", size: 9pt,
      weight: "bold", fill: palette.accent-dark)
    it
  }
  show outline.entry: set block(above: 0.3em, below: 0em)
  show outline.entry.where(level: 1): set text(weight: "semibold", fill: palette.accent-dark)

  show raw.where(block: true): it => block(
    width: 100%, fill: palette.code-bg,
    stroke: (left: 2pt + palette.accent),
    radius: (right: 3pt), inset: 10pt,
    above: 9pt, below: 9pt,
  )[
    #set text(font: "JetBrains Mono", size: 8.3pt)
    #it
  ]
  show raw.where(block: false): it => box(
    fill: palette.code-bg, radius: 2pt, inset: (x: 3pt, y: 1pt),
    text(font: "JetBrains Mono", size: 8.4pt, it),
  )
  show quote.where(block: true): it => block(
    width: 100%, stroke: (left: 2.5pt + palette.accent-dark),
    fill: palette.accent-pale,
    inset: (left: 11pt, right: 9pt, y: 7pt),
    above: 9pt, below: 9pt,
  )[
    #set text(fill: palette.accent-dark, style: "italic")
    #it
  ]
  show link: set text(fill: palette.accent)
  set list(spacing: 0.5em)
  set enum(spacing: 0.5em)
  body
}
