#!/usr/bin/env python3
"""Deterministic silhouette-similarity diagnostic: height-normalized IoU.

Compares a dark-subject-on-light-background reference image against a rendered
silhouette captured at reference framing. Both masks are bbox-cropped, scaled to
a common height, center-aligned, and compared by IoU. This is the manual-route
diagnostic for the game-local 0.70 minimum; it is distinct from the stopped
provider's 0.85 gate and is evidence, not acceptance by itself.

Usage: python3 scripts/measure-silhouette.py <reference.png> <render.png>
"""
import argparse
import json

import numpy as np
from PIL import Image


def subject_mask(path: str, threshold: int) -> np.ndarray:
    gray = np.asarray(Image.open(path).convert("L"), dtype=np.uint8)
    mask = gray < threshold
    if not mask.any():
        raise SystemExit(f"no subject pixels found in {path}")
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    y0, y1 = int(np.argmax(rows)), int(len(rows) - np.argmax(rows[::-1]))
    x0, x1 = int(np.argmax(cols)), int(len(cols) - np.argmax(cols[::-1]))
    return mask[y0:y1, x0:x1]


def normalize(mask: np.ndarray, height: int) -> np.ndarray:
    width = max(1, round(mask.shape[1] * height / mask.shape[0]))
    scaled = Image.fromarray(mask.astype(np.uint8) * 255).resize((width, height), Image.NEAREST)
    return np.asarray(scaled) > 127


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("reference")
    parser.add_argument("render")
    parser.add_argument("--threshold", type=int, default=128)
    parser.add_argument("--height", type=int, default=400)
    args = parser.parse_args()

    ref = subject_mask(args.reference, args.threshold)
    ren = subject_mask(args.render, args.threshold)
    a, b = normalize(ref, args.height), normalize(ren, args.height)

    width = max(a.shape[1], b.shape[1])
    padded: list[np.ndarray] = []
    for m in (a, b):
        canvas = np.zeros((args.height, width), dtype=bool)
        offset = (width - m.shape[1]) // 2
        canvas[:, offset:offset + m.shape[1]] = m
        padded.append(canvas)
    intersection = int(np.logical_and(*padded).sum())
    union = int(np.logical_or(*padded).sum())
    ref_aspect = ref.shape[1] / ref.shape[0]
    ren_aspect = ren.shape[1] / ren.shape[0]
    print(json.dumps({
        "iou": round(intersection / union, 4),
        "reference_aspect": round(ref_aspect, 4),
        "render_aspect": round(ren_aspect, 4),
        "aspect_delta": round(abs(ref_aspect - ren_aspect), 4),
        "method": f"bbox-crop, height-normalized {args.height}px, center-aligned IoU, dark-subject threshold {args.threshold}",
    }, indent=2))


if __name__ == "__main__":
    main()
