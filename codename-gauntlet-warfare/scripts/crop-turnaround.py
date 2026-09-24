#!/usr/bin/env python3
"""Derive clean per-view working crops from the operator turnaround sheet.

Inputs:  references/operator-turnaround-sheet.png (operator-supplied art direction)
Outputs: references/derived/turnaround/<name>.png  (six canonical views, no labels,
         no borders, no neighbouring views, no sheet furniture)
         references/derived/turnaround/detail-<name>.png (supporting detail panels)

The top-row views sit on a continuous mid-gray background without drawn separators,
so the six figures are segmented by connected components after a horizontal erosion
that removes the thin radio antennas (they would otherwise bridge neighbouring
windows). Windows are then cut at midpoints between adjacent figure bboxes so no
neighbour content can leak into a crop.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SHEET = ROOT / "references" / "operator-turnaround-sheet.png"
OUT = ROOT / "references" / "derived" / "turnaround"

TOP_BAND = (30, 566)      # figure rows; label text starts ~y=570
DETAIL_BAND = (598, 796)  # detail panel rows
VIEW_NAMES = ["front", "left", "back", "right", "34front", "34back"]
DETAIL_RUNS = [
    ("head-front", 36, 188),
    ("head-side", 240, 394),
    ("head-back", 449, 609),
    ("torso", 643, 896),
    ("leg", 925, 1055),
    ("glove", 1083, 1250),
    ("boot", 1260, 1436),
]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    sheet = np.asarray(Image.open(SHEET).convert("RGB"))
    gray = sheet.mean(axis=2)

    band = gray[TOP_BAND[0]:TOP_BAND[1], :]
    dark = band < 120

    # Erode horizontally to drop thin antennas before labelling figures.
    eroded = ndimage.binary_erosion(dark, structure=np.ones((1, 7)))
    labels, n = ndimage.label(eroded)
    sizes = ndimage.sum(eroded, labels, range(1, n + 1))
    order = np.argsort(sizes)[::-1][:6]
    boxes = ndimage.find_objects(labels)
    figures = []
    for i in order:
        sl = boxes[i]
        y0, y1 = sl[0].start, sl[0].stop
        x0, x1 = sl[1].start, sl[1].stop
        figures.append((x0, x1, y0, y1, int(sizes[i])))
    figures.sort(key=lambda f: f[0])
    assert len(figures) == 6, f"expected 6 figures, found {len(figures)}: {figures}"

    manifest = {"sheet": "references/operator-turnaround-sheet.png", "views": {}, "details": {}}
    for idx, (fx0, fx1, fy0, fy1, px) in enumerate(figures):
        # Window bounds: midpoints to the left/right neighbour figure (never the raw
        # bbox, so an antenna of the neighbour cannot enter this crop).
        left = 0 if idx == 0 else (figures[idx - 1][1] + fx0) // 2 + 1
        right = sheet.shape[1] if idx == len(figures) - 1 else (fx1 + figures[idx + 1][0]) // 2
        # Exact subject bbox inside the window, including the thin antenna: use the
        # raw dark mask restricted to the window and to figure rows.
        win = dark[:, left:right]
        ys, xs = np.where(win)
        assert len(ys) > 0
        cy0, cy1 = int(ys.min()), int(ys.max())
        cx0, cx1 = int(xs.min()), int(xs.max())
        # Ground shadow guard: report the darkest pixel in the 6 rows below the boots
        # inside the window so the silhouette threshold choice is evidence-based.
        below = gray[TOP_BAND[0] + cy1 + 2: TOP_BAND[0] + cy1 + 8, left + cx0:left + cx1 + 1]
        shadow_min = float(below.min()) if below.size else None
        pad = 4
        y0 = max(0, TOP_BAND[0] + cy0 - pad)
        y1 = min(sheet.shape[0], TOP_BAND[0] + cy1 + 1 + pad)
        x0 = max(0, left + cx0 - pad)
        x1 = min(sheet.shape[1], left + cx1 + 1 + pad)
        crop = sheet[y0:y1, x0:x1]
        name = VIEW_NAMES[idx]
        Image.fromarray(crop).save(OUT / f"{name}.png")
        manifest["views"][name] = {
            "file": f"references/derived/turnaround/{name}.png",
            "sheet_bbox": [int(x0), int(y0), int(x1), int(y1)],
            "subject_px": int(px),
            "rows_below_boots_min_gray": shadow_min,
        }

    dy0, dy1 = DETAIL_BAND
    for name, x0, x1 in DETAIL_RUNS:
        crop = sheet[dy0:dy1, x0:x1]
        Image.fromarray(crop).save(OUT / f"detail-{name}.png")
        manifest["details"][name] = {
            "file": f"references/derived/turnaround/detail-{name}.png",
            "sheet_bbox": [int(x0), int(dy0), int(x1), int(dy1)],
        }

    (OUT / "crops-manifest.json").write_text(json.dumps(manifest, indent=2))
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
