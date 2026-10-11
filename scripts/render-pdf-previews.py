"""Rasterises sample PDFs: full previews (130 dpi, every page) and gallery thumbnails (first page, 540px wide WebP).
Usage: python scripts/render-pdf-previews.py <png_dir> <thumb_dir> <pdf>..."""
import os
import sys

import pymupdf
from PIL import Image

png_dir, thumb_dir, *pdfs = sys.argv[1:]
for path in pdfs:
    doc = pymupdf.open(path)
    stem = os.path.splitext(os.path.basename(path))[0]
    template_id = stem.split("-", 1)[1] if stem[:2].isdigit() else stem
    for number, page in enumerate(doc):
        suffix = "" if number == 0 else f"-p{number + 1}"
        page.get_pixmap(dpi=130).save(os.path.join(png_dir, f"{stem}{suffix}.png"))
    first = doc[0]
    zoom = 360 / first.rect.width
    if doc.page_count > 1:
        # cards: front and back side by side
        width = first.rect.width * 2 + 12
        canvas = pymupdf.open()
        sheet = canvas.new_page(width=width, height=first.rect.height)
        sheet.show_pdf_page(pymupdf.Rect(0, 0, first.rect.width, first.rect.height), doc, 0)
        sheet.show_pdf_page(pymupdf.Rect(first.rect.width + 12, 0, width, first.rect.height), doc, 1)
        first = sheet
        zoom = 360 / width
    pix = first.get_pixmap(matrix=pymupdf.Matrix(zoom * 1.5, zoom * 1.5))
    image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    image.save(os.path.join(thumb_dir, f"{template_id}.webp"), "WEBP", quality=72, method=6)
    print("png", stem)
