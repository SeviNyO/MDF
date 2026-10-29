#!/usr/bin/env python3
"""Genera las figuras de ejemplo (PNG a 300 dpi) para la plantilla."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "theme" / "fonts"
OUT = ROOT / "assets"
OUT.mkdir(exist_ok=True)

INK = (27, 29, 33)
MUTED = (93, 102, 114)
ACCENT = (30, 58, 95)
SOFT = (234, 240, 246)
RULE = (198, 208, 220)
WHITE = (255, 255, 255)


def font(name, size):
    return ImageFont.truetype(str(FONTS / name), size)


def center_text(draw, box, text, f, fill=INK):
    x0, y0, x1, y1 = box
    left, top, right, bottom = draw.textbbox((0, 0), text, font=f)
    w, h = right - left, bottom - top
    draw.text(
        ((x0 + x1 - w) / 2 - left, (y0 + y1 - h) / 2 - top),
        text,
        font=f,
        fill=fill,
    )


def rounded(draw, box, fill, outline=None, width=4, radius=18):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def arrow(draw, start, end, color=ACCENT, width=6):
    draw.line([start, end], fill=color, width=width)
    x, y = end
    sx, sy = start
    if abs(x - sx) >= abs(y - sy):
        direction = 1 if x > sx else -1
        head = [(x, y), (x - 22 * direction, y - 12), (x - 22 * direction, y + 12)]
    else:
        direction = 1 if y > sy else -1
        head = [(x, y), (x - 12, y - 22 * direction), (x + 12, y - 22 * direction)]
    draw.polygon(head, fill=color)


def figure_arquitectura():
    W, H = 1800, 860
    img = Image.new("RGB", (W, H), WHITE)
    d = ImageDraw.Draw(img)

    f_title = font("SourceSans3-Semibold.otf", 40)
    f_box = font("SourceSans3-Bold.otf", 44)
    f_sub = font("SourceSans3-Regular.otf", 34)

    d.text((70, 50), "Canalización de compilación", font=f_title, fill=MUTED)

    boxes = [
        ("Markdown", "manuscript/*.md"),
        ("Conversor", "md2typst.mjs"),
        ("Typst", "theme.typ"),
        ("PDF", "dist/informe.pdf"),
    ]
    box_w, box_h, gap = 340, 200, 120
    total = len(boxes) * box_w + (len(boxes) - 1) * gap
    x = (W - total) / 2
    y = 300

    positions = []
    for index, (title, subtitle) in enumerate(boxes):
        box = (x, y, x + box_w, y + box_h)
        fill = SOFT if index % 2 == 0 else WHITE
        rounded(d, box, fill, outline=ACCENT if index in (0, 3) else RULE)
        center_text(d, (box[0], y + 45, box[2], y + 115), title, f_box, ACCENT)
        center_text(d, (box[0], y + 115, box[2], y + 175), subtitle, f_sub, MUTED)
        positions.append(box)
        x += box_w + gap

    for i in range(len(positions) - 1):
        start = (positions[i][2] + 18, y + box_h / 2)
        end = (positions[i + 1][0] - 18, y + box_h / 2)
        arrow(d, start, end)

    f_note = font("SourceSans3-Regular.otf", 34)
    d.text(
        (70, H - 120),
        "Misma entrada + mismas fuentes = mismo PDF, en cualquier máquina.",
        font=f_note,
        fill=MUTED,
    )
    d.line([(70, H - 145), (W - 70, H - 145)], fill=RULE, width=3)

    img.save(OUT / "figura-arquitectura.png", dpi=(300, 300))


def figure_rendimiento():
    W, H = 1600, 900
    img = Image.new("RGB", (W, H), WHITE)
    d = ImageDraw.Draw(img)

    f_title = font("SourceSans3-Semibold.otf", 40)
    f_label = font("SourceSans3-Regular.otf", 36)
    f_value = font("SourceSans3-Semibold.otf", 36)

    d.text((80, 50), "Tiempo de compilación (segundos)", font=f_title, fill=MUTED)

    left, right, top, bottom = 150, W - 120, 180, H - 150
    d.line([(left, top), (left, bottom)], fill=MUTED, width=4)
    d.line([(left, bottom), (right, bottom)], fill=MUTED, width=4)

    max_value = 14
    for tick in range(0, max_value + 1, 2):
        y = bottom - (tick / max_value) * (bottom - top)
        d.line([(left, y), (right, y)], fill=(238, 241, 245), width=2)
        d.text((70, y - 20), str(tick), font=f_label, fill=MUTED)

    data = [("v1", 12.4), ("v2", 6.8), ("v3", 2.9)]
    slot = (right - left) / len(data)
    bar_w = 170

    for index, (label, value) in enumerate(data):
        cx = left + slot * (index + 0.5)
        x0, x1 = cx - bar_w / 2, cx + bar_w / 2
        y = bottom - (value / max_value) * (bottom - top)
        d.rectangle([x0, y, x1, bottom], fill=ACCENT if index == len(data) - 1 else SOFT,
                    outline=ACCENT, width=3)
        center_text(d, (x0, y - 60, x1, y - 8), f"{value:.1f}", f_value, ACCENT)
        center_text(d, (x0, bottom + 18, x1, bottom + 80), label, f_label, INK)

    d.line([(left, top), (right, top)], fill=RULE, width=2)

    img.save(OUT / "figura-rendimiento.png", dpi=(300, 300))


if __name__ == "__main__":
    figure_arquitectura()
    figure_rendimiento()
    print("figuras generadas en", OUT)
