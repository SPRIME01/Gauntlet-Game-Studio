#!/usr/bin/env python3
"""Compare rendered operator silhouettes against the turnaround reference crops.

Extracts the same signature vectors from both (full-span and midline-run width
profiles at 28 height fractions, side-view depth profile) and reports per-band
deltas ranked by magnitude. This is the numeric discrepancy ranker for the
correction loop: fix the largest signed deltas first, in the operator's priority
order (front > side > back > 3/4).

Usage: python3 scripts/compare-profiles.py <render_dir> [--json]
  <render_dir> holds front.png / left.png / back.png / right.png renders
  (npc-scene output) and defaults reference crops to references/derived/turnaround.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
REF = ROOT / "references" / "derived" / "turnaround"
N = 28
THRESHOLD = 120


def profile(path: Path) -> dict:
    im = np.asarray(Image.open(path).convert("L"))
    m = im < THRESHOLD
    prof = m.sum(axis=1)
    h, w = m.shape
    substantial = np.where(prof >= 24)[0]  # skip thin radio antennas at the crown
    crown, sole = int(substantial.min()), int(substantial.max())
    H = sole - crown
    cx = w // 2
    full, mid = [], []
    for i in range(N + 1):
        y = crown + int(i / N * H)
        row = m[y]
        full.append(int(row.sum()) / H)
        xs = np.where(row)[0]
        if len(xs) == 0 or not row[cx]:
            mid.append(0.0)
            continue
        x0 = cx
        while x0 > 0 and row[x0 - 1]:
            x0 -= 1
        x1 = cx
        while x1 < w - 1 and row[x1 + 1]:
            x1 += 1
        mid.append((x1 - x0 + 1) / H)
    aspect = (xs.max() - xs.min()) / H if len(xs) else 0
    return {"crown": crown, "sole": sole, "H": H, "full": full, "mid": mid, "aspect": float(aspect)}


def band_notes() -> dict:
    # Anatomical band labels keyed by profile index (i/N of height below crown).
    labels = {}
    for i in range(N + 1):
        f = i / N
        if f < 0.11:
            labels[i] = "head"
        elif f < 0.17:
            labels[i] = "neck/collar"
        elif f < 0.24:
            labels[i] = "shoulders"
        elif f < 0.38:
            labels[i] = "chest+upper-arms"
        elif f < 0.46:
            labels[i] = "waist"
        elif f < 0.55:
            labels[i] = "hips+hands"
        elif f < 0.64:
            labels[i] = "thigh-top"
        elif f < 0.74:
            labels[i] = "thigh"
        elif f < 0.84:
            labels[i] = "knee"
        elif f < 0.90:
            labels[i] = "calf"
        elif f < 0.95:
            labels[i] = "ankle"
        else:
            labels[i] = "boot"
    return labels


def compare(view: str, render_dir: Path) -> dict:
    ref = profile(REF / f"{view}.png")
    render_name = {"back": "rear"}.get(view, view)
    ren = profile(render_dir / f"{render_name}.png")
    bands = band_notes()
    deltas = []
    for i in range(N + 1):
        d = ren["full"][i] - ref["full"][i]
        deltas.append({
            "i": i,
            "frac": round(i / N, 3),
            "band": bands[i],
            "ref": round(ref["full"][i], 4),
            "render": round(ren["full"][i], 4),
            "delta": round(d, 4),
        })
    ranked = sorted(deltas, key=lambda d: abs(d["delta"]), reverse=True)[:8]
    iou_full = sum(min(ref["full"][i], ren["full"][i]) for i in range(N + 1)) / sum(
        max(ref["full"][i], ren["full"][i]) for i in range(N + 1)
    )
    return {
        "view": view,
        "aspect_ref": round(ref["aspect"], 4),
        "aspect_render": round(ren["aspect"], 4),
        "profile_agreement": round(iou_full, 4),
        "top_discrepancies": ranked,
        "ref_profile": [round(v, 4) for v in ref["full"]],
        "render_profile": [round(v, 4) for v in ren["full"]],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("render_dir")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    rd = Path(args.render_dir)
    out = [compare(v, rd) for v in ("front", "left", "back")]
    if not args.json:
        for view in out:
            print(f"== {view['view']}: profile_agreement={view['profile_agreement']} "
                  f"aspect ref={view['aspect_ref']} render={view['aspect_render']}")
            for d in view["top_discrepancies"]:
                sign = "+" if d["delta"] > 0 else "-"
                print(f"   {d['frac']:>5} {d['band']:<18} ref={d['ref']:.3f} "
                      f"render={d['render']:.3f} delta={sign}{abs(d['delta']):.3f}")
    else:
        print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
