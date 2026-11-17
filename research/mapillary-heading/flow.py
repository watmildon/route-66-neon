"""Find which way a 360° camera faced, from two consecutive panoramas.

When a car drives forward, everything in an equirectangular panorama streams
away from the forward direction (the focus of expansion) and toward the rear.
Columns to the right of "forward" move right, columns to the left move left,
so the horizontal image motion around the horizon is roughly

    u(θ) = k · sin(θ − θ_f) + c          (k > 0)

where θ is a column's angle from the image centre (degrees, clockwise) and
θ_f is the column that faces forward. c absorbs any yaw (the car turning)
between the two frames. Fitting that curve to measured motion gives θ_f, and
the photo's image-centre heading is then  travel_bearing − θ_f.

Needs only numpy and Pillow. Frame A must be the earlier photo.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from PIL import Image

W, H = 360, 180  # working size: 1° per pixel
BAND = (0.30, 0.56)  # rows used: ~36° above to ~10° below the horizon (skips sky and the car roof)
STRIP = 20  # strip width in px (20°)
STEP = 10  # strip spacing (50% overlap)
MAX_DX, MAX_DY = 60, 6  # search range in px (±60° sideways: close buildings move a lot)


@dataclass
class FlowResult:
    forward_deg: float  # θ_f: column facing forward, degrees clockwise from the image centre
    amplitude: float  # k in px: how strongly the scene streamed (0 → car didn't move)
    yaw_px: float  # c: uniform shift (car turning)
    agree: float  # share of good strips whose motion sign matches the fit
    n: int  # strips used
    resid: float  # RMS residual, px
    samples: list  # [(θ, u, quality)] for plotting/debugging

    @property
    def side(self) -> str:
        """Nearest of forward/right/back/left for the image centre's view, relative to travel."""
        # Image centre heading = travel − θ_f, so the centre faces −θ_f relative to travel.
        rel = (-self.forward_deg) % 360
        return ["forward", "right", "back", "left"][int(((rel + 45) % 360) // 90)]


def load(path_or_img) -> np.ndarray:
    im = path_or_img if isinstance(path_or_img, Image.Image) else Image.open(path_or_img)
    g = np.asarray(im.convert("L").resize((W, H), Image.BILINEAR), dtype=np.float32)
    # Horizontal + vertical gradient magnitude: robust to exposure changes between frames.
    gx = np.abs(np.roll(g, -1, 1) - np.roll(g, 1, 1))
    gy = np.abs(np.roll(g, -1, 0) - np.roll(g, 1, 0))
    return gx + gy


def strip_motion(a: np.ndarray, b: np.ndarray):
    """Best (dx, dy, zncc) per strip, matching A's strip inside B (wrapping horizontally)."""
    r0, r1 = int(BAND[0] * H), int(BAND[1] * H)
    starts = list(range(0, W, STEP))
    ablocks = np.stack([np.roll(a, -s, 1)[r0:r1, :STRIP] for s in starts])  # (S, h, w)
    am = ablocks - ablocks.mean(axis=(1, 2), keepdims=True)
    an = np.sqrt((am**2).sum(axis=(1, 2))) + 1e-6
    best = np.full(len(starts), -2.0)
    bdx = np.zeros(len(starts))
    bdy = np.zeros(len(starts))
    scores = {}
    for dy in range(-MAX_DY, MAX_DY + 1, 2):  # vertical motion is small; coarse steps
        rows = b[r0 + dy : r1 + dy]
        for dx in range(-MAX_DX, MAX_DX + 1):
            bb = np.stack([np.roll(rows, -(s + dx), 1)[:, :STRIP] for s in starts])
            bm = bb - bb.mean(axis=(1, 2), keepdims=True)
            z = (am * bm).sum(axis=(1, 2)) / (an * (np.sqrt((bm**2).sum(axis=(1, 2))) + 1e-6))
            scores[(dx, dy)] = z
            m = z > best
            best[m], bdx[m], bdy[m] = z[m], dx, dy
    # Sub-pixel dx by a parabola through the neighbours at the best dy.
    sub = bdx.copy()
    for i in range(len(starts)):
        dx, dy = int(bdx[i]), int(bdy[i])
        if -MAX_DX < dx < MAX_DX:
            l, c, r = scores[(dx - 1, dy)][i], scores[(dx, dy)][i], scores[(dx + 1, dy)][i]
            den = l - 2 * c + r
            if den < 0:
                sub[i] = dx + 0.5 * (l - r) / den
    centres = [((s + STRIP / 2) / W - 0.5) * 360 for s in starts]
    texture = an / math.sqrt(STRIP * (r1 - r0))
    return np.array(centres), sub, best, texture


def fit(theta_deg, u, w):
    """Weighted robust fit of u = a·sinθ + b·cosθ + c. Returns (θ_f, k, c, mask, rms)."""
    th = np.radians(theta_deg)
    A = np.stack([np.sin(th), np.cos(th), np.ones_like(th)], 1)
    mask = w > 0
    for _ in range(4):
        sw = np.sqrt(w[mask])
        coef, *_ = np.linalg.lstsq(A[mask] * sw[:, None], u[mask] * sw, rcond=None)
        res = u - A @ coef
        mad = np.median(np.abs(res[mask])) + 0.5
        new = (w > 0) & (np.abs(res) < 3.5 * mad)
        if new.sum() < 6 or (new == mask).all():
            break
        mask = new
    a, b, c = coef
    theta_f = math.degrees(math.atan2(-b, a))
    k = math.hypot(a, b)
    rms = float(np.sqrt(np.mean(res[mask] ** 2)))
    return theta_f, k, c, mask, rms


def forward_direction(img_a, img_b) -> FlowResult:
    a, b = load(img_a), load(img_b)
    theta, u, z, tex = strip_motion(a, b)
    # Trust strips that matched well and have texture; a strip pinned at the
    # search limit probably moved further than we looked.
    w = np.clip(z - 0.3, 0, None) * np.clip(tex / 4, 0, 1)
    w[np.abs(u) >= MAX_DX - 0.5] = 0
    theta_f, k, c, mask, rms = fit(theta, u, w)
    pred = k * np.sin(np.radians(theta - theta_f))
    sig = np.abs(pred) > 1  # only strips the model says should visibly move
    good = mask & sig
    agree = float(np.mean(np.sign(u[good] - c) == np.sign(pred[good]))) if good.any() else 0.0
    return FlowResult(
        forward_deg=round(theta_f, 1),
        amplitude=round(k, 2),
        yaw_px=round(float(c), 2),
        agree=round(agree, 2),
        n=int(mask.sum()),
        resid=round(rms, 2),
        samples=[(round(float(t), 1), round(float(x), 2), round(float(q), 2)) for t, x, q in zip(theta, u, w)],
    )


if __name__ == "__main__":
    import sys

    r = forward_direction(sys.argv[1], sys.argv[2])
    print({k: v for k, v in r.__dict__.items() if k != "samples"}, "centre faces:", r.side)


def passes(r: FlowResult) -> bool:
    """Quality gate for one pair: enough textured strips, clear motion, and a clean fit."""
    return r.n >= 10 and r.amplitude >= 1.5 and r.agree >= 0.8 and r.resid <= 0.5 * r.amplitude + 1


def vote(results: list) -> dict:
    """Combine several pairs from one sequence (a fixed camera): circular mean of passing pairs."""
    ok = [r for r in results if r and passes(r)]
    if not ok:
        return {"forward_deg": None, "used": 0, "of": len(results), "consistency": 0.0}
    ang = np.radians([r.forward_deg for r in ok])
    wts = np.array([r.agree * min(r.amplitude, 20) for r in ok])
    mean = math.degrees(math.atan2((wts * np.sin(ang)).sum(), (wts * np.cos(ang)).sum()))
    near = [abs((r.forward_deg - mean + 180) % 360 - 180) <= 30 for r in ok]
    return {"forward_deg": round(mean, 1), "used": len(ok), "of": len(results), "consistency": round(sum(near) / len(ok), 2)}
