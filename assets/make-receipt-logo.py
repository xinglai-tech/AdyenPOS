#!/usr/bin/env python3
"""Regenerates the receipt header image.

The S1F2L only renders an XHTML print document when its root element is a bare
<img/>: a wrapping <div>, plain text and tables all print nothing. Text output
has no font size control either, so the large store name is baked into this
image together with the logo.

Run after changing RECEIPT_STORE_NAME:
    python3 assets/make-receipt-logo.py
"""
from PIL import Image, ImageDraw, ImageFont

FONT = "/System/Library/Fonts/Avenir Next.ttc"
BOLD, DEMI = 0, 2

STORE_NAME = "My Super Store"
LOGO_TEXT = "Adyen"
CANVAS_W = 360          # print head is 384 px; leave a margin either side
OUT = "assets/receipt-logo.png"


def fit(text, target_w, index):
    """Largest font size at which text still fits target_w."""
    size = 10
    while True:
        font = ImageFont.truetype(FONT, size + 2, index=index)
        if font.getbbox(text)[2] > target_w:
            return ImageFont.truetype(FONT, size, index=index)
        size += 2


def draw_centred(draw, y, text, font, fill):
    box = font.getbbox(text)
    draw.text(((CANVAS_W - box[2] - box[0]) / 2, y - box[1]), text, font=font, fill=fill)
    return box[3] - box[1]


canvas = Image.new("L", (CANVAS_W, 400), 255)
d = ImageDraw.Draw(canvas)
y = 4

# Store name, as large as the paper allows.
name_font = fit(STORE_NAME, CANVAS_W - 24, DEMI)
y += draw_centred(d, y, STORE_NAME, name_font, 0) + 22

# Logo badge: white wordmark knocked out of a black rounded rectangle, with an
# outer keyline. Both effects are pure black and white, which is all a thermal
# print head can reproduce.
logo_font = fit(LOGO_TEXT, CANVAS_W - 150, BOLD)
lb = logo_font.getbbox(LOGO_TEXT)
pad_x, pad_y = 26, 16
badge_w = lb[2] - lb[0] + pad_x * 2
badge_h = lb[3] - lb[1] + pad_y * 2
badge_x = (CANVAS_W - badge_w) / 2

keyline = 5
d.rounded_rectangle(
    [badge_x - keyline - 4, y - keyline - 4, badge_x + badge_w + keyline + 4, y + badge_h + keyline + 4],
    radius=badge_h / 2 + keyline, outline=0, width=3)
d.rounded_rectangle([badge_x, y, badge_x + badge_w, y + badge_h], radius=badge_h / 2, fill=0)
d.text((badge_x + pad_x - lb[0], y + pad_y - lb[1]), LOGO_TEXT, font=logo_font, fill=255)
y += badge_h + keyline + 8

canvas = canvas.crop((0, 0, CANVAS_W, int(y)))
canvas.point(lambda v: 0 if v < 150 else 255, mode="1").save(OUT, optimize=True)
print(f"wrote {OUT} {canvas.size}")
