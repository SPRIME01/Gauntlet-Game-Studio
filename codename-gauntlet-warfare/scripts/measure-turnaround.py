#!/usr/bin/env python3
"""Measure canonical landmarks off the turnaround crops (front/left/back).

Method follows vendor/skills/img2threejs grimoire/character guidance: dark-subject
mask (verified free of cast shadow and labels by crop-turnaround.py), row-width and
column-extent scans, landmark rows read from profile minima/maxima. All values are
reported in pixels AND normalized by total figure height (and head unit where
applicable) so they can drive the model spec directly.

Usage: python3 scripts/measure-turnaround.py [--json]
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CROPS = ROOT / "references" / "derived" / "turnaround"
THRESHOLD = 120  # verified: darkest non-subject pixel below boots is 144


def mask_of(name: str) -> np.ndarray:
    gray = np.asarray(Image.open(CROPS / f"{name}.png").convert("L"))
    return gray < THRESHOLD


def row_profile(mask: np.ndarray) -> np.ndarray:
    return mask.sum(axis=1).astype(float)


def runs_below(profile: np.ndarray, lo: int, hi: int, frac: float, total: float) -> list:
    out, start = [], None
    for y in range(lo, min(hi, len(profile))):
        small = profile[y] < frac * total
        if small and start is None:
            start = y
        elif not small and start is not None:
            out.append((start, y - 1, float(profile[start:y].min())))
            start = None
    if start is not None:
        out.append((start, len(profile) - 1, float(profile[start:].min())))
    return out


def measure_front() -> dict:
    m = mask_of("front")
    prof = row_profile(m)
    h, w = m.shape
    crown = int(np.argmax(prof > 0))
    sole = h - 1 - int(np.argmax(prof[::-1] > 0))
    height_px = sole - crown
    # Head block: crown -> narrowest row in the head band. The layered collar flares
    # immediately at the chin (no neck pinch below it), and the antenna adds width at
    # every head row, so the search is bounded to the band where the head is the only
    # mass and the minimum is the chin/collar transition.
    band0, band1 = crown + 30, crown + 140
    head_end = band0 + int(np.argmin(prof[band0:band1]))
    head_px = head_end - crown
    # shoulder line: widest row in the 120 rows below the head block
    shoulder_zone = prof[head_end: head_end + 120]
    shoulder_y = head_end + int(np.argmax(shoulder_zone))
    shoulder_w = float(prof[shoulder_y])
    # hand tips: extreme columns below shoulder level (antenna lives above it)
    body = m[head_end + 40:, :]
    cols = np.where(body.any(axis=0))[0]
    left_tip, right_tip = int(cols.min()), int(cols.max())
    left_tip_y = head_end + 40 + int(np.argmax(body[:, left_tip]))
    right_tip_y = head_end + 40 + int(np.argmax(body[:, right_tip]))
    # crotch: first row below 48% height where the vertical midline goes background
    midcol = m[:, (left_tip + right_tip) // 2 - 2: (left_tip + right_tip) // 2 + 3].any(axis=1)
    crotch = None
    for y in range(crown + int(0.44 * height_px), crown + int(0.65 * height_px)):
        if not midcol[y]:
            crotch = y
            break
    # boot top / ankle pinch: narrowest leg rows in the lower 20%
    leg_zone = runs_below(prof, crown + int(0.80 * height_px), sole, 0.20, w)
    ankle = min(leg_zone, key=lambda r: r[2]) if leg_zone else None
    # widths at key rows
    def width_at(frac: float) -> float:
        return float(prof[crown + int(frac * height_px)])

    def span_at(frac: float) -> list:
        y = crown + int(frac * height_px)
        xs = np.where(m[y])[0]
        return [int(xs.min()), int(xs.max())] if len(xs) else []

    def midline_run(frac: float) -> int:
        # Contiguous dark run containing the row midline = torso width without the
        # A-pose arms (which separate from the torso by background gaps below the
        # deltoids).
        y = crown + int(frac * height_px)
        row = m[y]
        cx = w // 2
        if not row[cx]:
            return 0
        x0 = cx
        while x0 > 0 and row[x0 - 1]:
            x0 -= 1
        x1 = cx
        while x1 < w - 1 and row[x1 + 1]:
            x1 += 1
        return int(x1 - x0 + 1)

    # Goggle lens band: brighter pixels inside the head region locate the eye line
    # (~0.45-0.5 of anatomical head height from crown) to size the occluded head.
    head_zone = m[crown:crown + 100, :]
    zone_gray = np.asarray(Image.open(CROPS / "front.png").convert("L"))[crown:crown + 100, :]
    lens = ((zone_gray > 60) & (zone_gray < 110) & head_zone).sum(axis=1)
    goggle_y = crown + int(np.argmax(lens)) if lens.max() > 3 else None

    # A-pose angle: shoulder joint estimated at torso-edge/deltoid height, hand tip measured.
    shoulder_joint_y = crown + int(0.21 * height_px)
    sj_torso = midline_run((shoulder_joint_y - crown) / height_px)
    cx_est = w // 2
    arm_angle_l = arm_angle_r = None
    if sj_torso:
        sx = cx_est - sj_torso / 2
        dx, dy = left_tip - sx, left_tip_y - shoulder_joint_y
        arm_angle_l = round(float(np.degrees(np.arctan2(abs(dx), dy))), 1)
        sx2 = cx_est + sj_torso / 2
        dx2, _ = right_tip - sx2, right_tip_y - shoulder_joint_y
        arm_angle_r = round(float(np.degrees(np.arctan2(abs(dx2), dy))), 1)

    return {
        "view": "front",
        "image_wh": [w, h],
        "crown_y": crown,
        "sole_y": sole,
        "height_px": height_px,
        "head_block_end_y": head_end,
        "head_block_px": head_px,
        "head_units_visible_block": round(height_px / head_px, 3),
        "goggle_line_y": goggle_y,
        "head_height_inferred": {
            "method": "goggle-line eye-line at ~0.47 anatomical head height (chin occluded by mask/wrap)",
            "head_px": round((goggle_y - crown) / 0.47, 1) if goggle_y else None,
            "head_units": round(height_px / ((goggle_y - crown) / 0.47), 2) if goggle_y else None,
        },
        "shoulder": {"y": shoulder_y, "width_px": shoulder_w, "frac_height": round(shoulder_w / height_px, 4)},
        "torso_midline_run_frac_height": {
            "deltoid_0.22": round(midline_run(0.22) / height_px, 4),
            "chest_0.30": round(midline_run(0.30) / height_px, 4),
            "waist_0.42": round(midline_run(0.42) / height_px, 4),
            "hip_0.50": round(midline_run(0.50) / height_px, 4),
        },
        "a_pose_arm_deg_from_vertical": {"left": arm_angle_l, "right": arm_angle_r},
        "hand_tips": {"left": [left_tip, left_tip_y], "right": [right_tip, right_tip_y]},
        "crotch_y": crotch,
        "ankle_pinch": {"y": ankle[0], "min_row_px": ankle[2]} if ankle else None,
        "width_frac_height": {
            "head_block_0.06": width_at(0.06),
            "chest_0.30": width_at(0.30) / height_px,
            "waist_0.42": width_at(0.42) / height_px,
            "hips_0.50": width_at(0.50) / height_px,
            "knees_0.72": width_at(0.72) / height_px,
            "calves_0.85": width_at(0.85) / height_px,
            "ankles_0.95": width_at(0.95) / height_px,
        },
        "spans_frac_height": {
            "0.30": span_at(0.30),
            "0.42": span_at(0.42),
            "0.50": span_at(0.50),
        },
    }


def measure_side(name: str) -> dict:
    m = mask_of(name)
    prof = row_profile(m)
    h, w = m.shape
    crown = int(np.argmax(prof > 0))
    sole = h - 1 - int(np.argmax(prof[::-1] > 0))
    height_px = sole - crown
    cols = np.where(m.any(axis=0))[0]
    front, back = int(cols.min()), int(cols.max())
    depth_px = back - front

    def depth_at(frac: float) -> float:
        xs = np.where(m[crown + int(frac * height_px)])[0]
        return float(xs.max() - xs.min()) if len(xs) else 0.0

    return {
        "view": name,
        "image_wh": [w, h],
        "crown_y": crown,
        "sole_y": sole,
        "height_px": height_px,
        "front_x": front,
        "back_x": back,
        "depth_px": depth_px,
        "depth_frac_height": {
            "helmet_0.05": depth_at(0.05) / height_px,
            "shoulders_0.25": depth_at(0.25) / height_px,
            "chest_0.32": depth_at(0.32) / height_px,
            "waist_0.44": depth_at(0.44) / height_px,
            "hips_0.52": depth_at(0.52) / height_px,
            "thigh_0.62": depth_at(0.62) / height_px,
            "knee_0.72": depth_at(0.72) / height_px,
            "calf_0.82": depth_at(0.82) / height_px,
            "boot_0.95": depth_at(0.95) / height_px,
        },
    }


def main() -> None:
    out = {
        "threshold": THRESHOLD,
        "front": measure_front(),
        "left": measure_side("left"),
        "back": measure_side("back"),
        "note": "depth_frac_height rows are row-widths of the side silhouette = body depth at that height fraction",
    }
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
