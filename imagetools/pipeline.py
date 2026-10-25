"""
Product photo -> the shop's one look: the product centred on a pure white 1200x1200 square.

Everything here runs on this machine. Two small vision models do the heavy lifting, both
plain image-in / image-out networks (no language model anywhere):

  ISNet (DIS, Apache-2.0)            finds the product, for photos that are not on white
  Real-ESRGAN general x4v3 (BSD-3)   sharpens photos too small to fill the square

Modes, picked by `analyze` unless the caller insists:
  white   the photo is already on white: the near-white that touches the border becomes pure
          white, everything else stays exactly as shot (printed text, icons, frames survive)
  alpha   the file already has a transparent background: it is used as is
  cutout  anything else: ISNet cuts the product out
  pad     a designed banner or a scene where cutting out would ruin it: the picture is kept
          whole and centred on the white square
"""
import io
import os
import threading
import time

import numpy as np
from PIL import Image, ImageFilter, ImageOps
from scipy import ndimage

# A decompression bomb is refused before a single pixel is decoded.
Image.MAX_IMAGE_PIXELS = 50_000_000

CANVAS = 1200
FILL = {'white': 0.86, 'alpha': 0.86, 'cutout': 0.86, 'pad': 1.0}
WORK_MAX = 2200        # longest side anything is worked on at
SR_ABOVE = 1.5         # upscale with Real-ESRGAN when the product has to grow more than this ...
SR_MAX_IN = 400        # ... and its crop is no longer than this (3.4 s on two cores at 400 px)
THREADS = int(os.environ.get('IMAGETOOLS_THREADS', '2'))
IDLE_UNLOAD = int(os.environ.get('IMAGETOOLS_IDLE_UNLOAD', '600'))
MODELS = os.environ.get('IMAGETOOLS_MODELS', '/app/models')
ACCEPTED_FORMATS = {'JPEG', 'PNG', 'WEBP', 'GIF', 'BMP', 'MPO'}


class BadImage(ValueError):
    """The bytes are not a picture this service will read."""


# --------------------------------------------------------------------------- models

class _Model:
    """One ONNX session, loaded on first use and dropped after IDLE_UNLOAD seconds idle, so
    the container holds ~150 MB at rest instead of the ~1.3 GB a loaded ISNet needs."""

    def __init__(self, filename):
        self.path = os.path.join(MODELS, filename)
        self.session = None
        self.last_used = 0.0
        self.lock = threading.Lock()

    def get(self):
        import onnxruntime as ort
        # Nothing about our pictures or this machine leaves it, including runtime telemetry.
        if hasattr(ort, 'disable_telemetry_events'):
            ort.disable_telemetry_events()
        with self.lock:
            if self.session is None:
                so = ort.SessionOptions()
                so.intra_op_num_threads = THREADS
                so.inter_op_num_threads = 1
                # The arena keeps every peak allocation for the life of the process; without
                # it memory goes back to the system after each picture.
                so.enable_cpu_mem_arena = False
                so.enable_mem_pattern = False
                self.session = ort.InferenceSession(self.path, so, providers=['CPUExecutionProvider'])
            self.last_used = time.time()
            return self.session

    def unload_if_idle(self):
        with self.lock:
            if self.session is not None and time.time() - self.last_used > IDLE_UNLOAD:
                self.session = None
                return True
        return False

    @property
    def loaded(self):
        return self.session is not None


ISNET = _Model('isnet-general-use.onnx')
SR = _Model('realesr-general-x4v3-dn05.onnx')


def unload_idle_models():
    dropped = [m.unload_if_idle() for m in (ISNET, SR)]
    if any(dropped):
        import gc
        gc.collect()


# --------------------------------------------------------------------------- helpers

def _pil(x):
    return Image.fromarray((np.clip(x, 0, 1) * 255 + 0.5).astype(np.uint8))


def _arr(im):
    return np.asarray(im).astype(np.float32) / 255.0


def _on_white(rgb, a):
    return rgb * a[..., None] + (1.0 - a[..., None])


def load(data):
    """Bytes -> (rgb, alpha) as float32 0..1, upright, at most WORK_MAX on the long side."""
    try:
        im = Image.open(io.BytesIO(data))
        fmt = im.format
        if fmt not in ACCEPTED_FORMATS:
            raise BadImage(f'unsupported format {fmt}')
        im = ImageOps.exif_transpose(im)
        if getattr(im, 'n_frames', 1) > 1:
            im.seek(0)
        im.draft('RGB', (WORK_MAX, WORK_MAX))  # JPEG: decode straight at a smaller size
        if im.mode == 'CMYK':
            im = im.convert('RGB')
        if im.mode in ('I;16', 'I', 'F'):
            im = im.convert('L')
        rgba = im.convert('RGBA')
    except BadImage:
        raise
    except Exception as e:  # truncated, bomb, not an image at all
        raise BadImage(str(e)) from e
    w, h = rgba.size
    if min(w, h) < 16:
        raise BadImage('image is too small')
    if max(w, h) > WORK_MAX:
        f = WORK_MAX / max(w, h)
        rgba = rgba.resize((max(1, round(w * f)), max(1, round(h * f))), Image.LANCZOS)
    x = _arr(rgba)
    return x[..., :3].copy(), x[..., 3].copy(), (w, h), fmt


def white_alpha(rgb):
    """Near-white connected to the border is background; it fades to white over a short ramp
    so soft studio shadows do not end in a visible step."""
    lo, hi = 226 / 255, 244 / 255
    mn = rgb.min(2)
    spread = rgb.max(2) - mn
    cand = (mn >= lo) & (spread <= 24 / 255)
    lab, n = ndimage.label(cand)
    if n == 0:
        return np.ones(mn.shape, np.float32)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    edge = edge[edge > 0]
    region = np.isin(lab, edge)
    b = np.clip((mn - lo) / (hi - lo), 0, 1) * region
    return (1.0 - b).astype(np.float32)


def clean_mask(a):
    """Drop specks the model left far from the product (a stray box corner, a reflection)."""
    hard = a > 0.5
    lab, n = ndimage.label(hard)
    if n <= 1:
        return a
    areas = ndimage.sum(hard, lab, range(1, n + 1))
    keep = np.zeros(n + 1, bool)
    keep[1:] = areas >= max(areas.max() * 0.012, 0.0002 * a.size)
    kept = keep[lab]
    dropped = hard & ~kept
    if not dropped.any():
        return a
    dropped = ndimage.binary_dilation(dropped, iterations=3) & ~ndimage.binary_dilation(kept, iterations=2)
    return a * ~dropped


def bbox(a, thr):
    """The product's box: ignores dust, and the thin frame line or empty L some files carry
    along an edge (it stretched the box and pushed the product off centre)."""
    m = a > thr
    lab, n = ndimage.label(m)
    if n >= 1:
        H, W = m.shape
        areas = ndimage.sum(m, lab, range(1, n + 1))
        keep = np.zeros(n + 1, bool)
        keep[1:] = areas >= max(12, areas.max() * 0.002)
        for i, (sy, sx) in enumerate(ndimage.find_objects(lab), start=1):
            h, w = sy.stop - sy.start, sx.stop - sx.start
            thin = min(h, w) <= 6
            edge = sy.start == 0 or sx.start == 0 or sy.stop == H or sx.stop == W
            outline = max(h / H, w / W) > 0.6 and areas[i - 1] / float(h * w) < 0.03
            if n > 1 and ((thin and edge) or outline):
                keep[i] = False
        m = keep[lab]
    ys, xs = np.where(m)
    if len(ys) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def _box(x, r):
    size = 2 * r + 1
    if x.ndim == 3:
        return ndimage.uniform_filter(x, size=(size, size, 1), mode='nearest')
    return ndimage.uniform_filter(x, size=size, mode='nearest')


def _blur_fusion_step(img, F, B, a, r):
    a3 = a[..., None]
    ba = _box(a, r)[..., None]
    bF = _box(F * a3, r) / (ba + 1e-5)
    bB = _box(B * (1 - a3), r) / ((1 - ba) + 1e-5)
    F = np.clip(bF + a3 * (img - a3 * bF - (1 - a3) * bB), 0, 1)
    return F, bB


def estimate_foreground(img, a):
    """Blur-fusion foreground colours (Forte & Pitié 2020): takes the old background's colour
    out of the soft edge, or a dark warehouse leaves a grey rim around the part on white."""
    F, B = _blur_fusion_step(img, img, img, a, 90)
    F, _ = _blur_fusion_step(img, F, B, a, 6)
    return F.astype(np.float32)


def isnet_mask(rgb):
    session = ISNET.get()
    h, w = rgb.shape[:2]
    small = _pil(rgb).resize((1024, 1024), Image.LANCZOS)
    x = np.asarray(small).astype(np.float32)
    x = x / max(float(x.max()), 1e-6) - 0.5
    x = x.transpose(2, 0, 1)[None]
    pred = session.run(None, {session.get_inputs()[0].name: x})[0][0, 0]
    pred = (pred - pred.min()) / max(float(pred.max() - pred.min()), 1e-6)
    m = Image.fromarray((pred * 255).astype(np.uint8), 'L').resize((w, h), Image.LANCZOS)
    return _arr(m)


def upscale4(rgb):
    session = SR.get()
    x = np.ascontiguousarray(rgb.transpose(2, 0, 1))[None].astype(np.float32)
    y = session.run(None, {'input': x})[0][0]
    return np.clip(y, 0, 1).transpose(1, 2, 0)


def _resize(rgb, a, size):
    r = _pil(rgb).resize(size, Image.LANCZOS)
    m = Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8), 'L').resize(size, Image.LANCZOS)
    return _arr(r), _arr(m)


def _enhance(c, a, mode):
    """A light touch on the product only: lift a dull photo's levels a little and sharpen what
    resizing softened. Packaging colours must stay the vendor's colours."""
    if mode == 'pad':
        return c
    core = a > 0.9
    if mode == 'cutout' and core.sum() > 500:
        lum = c[..., 0] * 0.299 + c[..., 1] * 0.587 + c[..., 2] * 0.114
        lo, hi = np.percentile(lum[core], [0.5, 99.5])
        lo, hi = min(lo, 0.10), max(hi, 0.88)
        if hi - lo > 0.2:
            c = c * 0.5 + np.clip((c - lo) / (hi - lo), 0, 1) * 0.5
    return _arr(_pil(c).filter(ImageFilter.UnsharpMask(radius=1.0, percent=45, threshold=2)))


# --------------------------------------------------------------------------- analysis

def _measure(rgb, a):
    H, W = a.shape
    b = max(2, int(min(H, W) * 0.02))
    x = (rgb * 255).astype(np.int16)
    border = np.concatenate([x[:b].reshape(-1, 3), x[-b:].reshape(-1, 3), x[:, :b].reshape(-1, 3), x[:, -b:].reshape(-1, 3)])
    mn = border.min(1)
    border_white = float(((mn >= 235) & ((border.max(1) - mn) <= 14)).mean())
    transp = float((a < 250 / 255).mean())
    return border_white, transp


def analyze_arrays(rgb, a, size):
    """What is wrong with a photo, cheaply (no model): resolution, background, framing."""
    w, h = size
    border_white, transp = _measure(rgb, a)
    if transp > 0.02:
        mode = 'alpha'
        fg = a
    elif border_white >= 0.85:
        # 0.85, not 0.97: designed images on white (text, icons, frames) touch the border
        mode = 'white'
        fg = white_alpha(_on_white(rgb, a))
    else:
        mode = 'cutout'
        fg = None
    issues = []
    fill = None
    if fg is not None:
        bb = bbox(fg, 0.5)
        if bb:
            fill = max(bb[2] - bb[0], bb[3] - bb[1]) / float(max(fg.shape))
            sq = max(bb[2] - bb[0], bb[3] - bb[1]) / float(max(fg.shape[1], fg.shape[0]))
            if sq < 0.6:
                issues.append('product_small_in_frame')
    if mode == 'cutout':
        issues.append('background_not_white')
    if max(w, h) < 600:
        issues.append('low_resolution')
    if not 0.95 <= w / float(h) <= 1.05:
        issues.append('not_square')
    if mode == 'alpha':
        issues.append('transparent_background')
    score = 100
    score -= 40 if 'background_not_white' in issues else 0
    score -= 25 if 'low_resolution' in issues else 0
    score -= 15 if 'product_small_in_frame' in issues else 0
    score -= 10 if 'not_square' in issues else 0
    score -= 5 if 'transparent_background' in issues else 0
    return {
        'width': w, 'height': h,
        'border_white': round(border_white, 3), 'transparent': round(transp, 3),
        'fill': round(fill, 3) if fill is not None else None,
        'recommended_mode': mode, 'issues': issues, 'score': max(score, 0),
    }


def analyze(data):
    rgb, a, size, fmt = load(data)
    out = analyze_arrays(rgb, a, size)
    out['format'] = fmt
    return out


# --------------------------------------------------------------------------- enhance

def enhance(data, mode='auto'):
    """Bytes in -> (JPEG bytes of the 1200x1200 white square, info dict)."""
    t0 = time.time()
    rgb, file_a, size, fmt = load(data)
    report = analyze_arrays(rgb, file_a, size)
    if mode in (None, '', 'auto'):
        mode = report['recommended_mode']
    if mode not in FILL:
        raise ValueError(f'unknown mode {mode}')
    H, W = file_a.shape
    confidence = 'high'
    notes = []

    if mode == 'alpha':
        a = file_a
    elif mode == 'white':
        rgb = _on_white(rgb, file_a)
        a = white_alpha(rgb)
    elif mode == 'cutout':
        rgb = _on_white(rgb, file_a)
        a = clean_mask(isnet_mask(rgb))
        cover = float((a > 0.5).mean())
        soft = float(((a > 0.1) & (a < 0.9)).sum()) / max(float((a > 0.5).sum()), 1.0)
        if cover < 0.01 or cover > 0.97:
            # nothing found, or "everything is the product": a cut-out would be wrong, keep the
            # whole picture instead and say so
            notes.append('cutout_not_possible')
            mode = 'pad'
            a = np.ones((H, W), np.float32)
            confidence = 'low'
        elif soft > 0.35:
            notes.append('cutout_uncertain')
            confidence = 'medium'
    else:  # pad
        rgb = _on_white(rgb, file_a)
        a = np.ones((H, W), np.float32)

    bb = bbox(a, 0.5 if mode == 'white' else 0.35)
    if bb is None:
        raise BadImage('no product found in the image')
    x0, y0, x1, y1 = bb
    mg = int(round(max(x1 - x0, y1 - y0) * 0.02)) + 2
    x0, y0, x1, y1 = max(0, x0 - mg), max(0, y0 - mg), min(W, x1 + mg), min(H, y1 + mg)
    rgb, a = rgb[y0:y1, x0:x1], a[y0:y1, x0:x1]
    bx0, by0, bx1, by1 = bbox(a, 0.5 if mode == 'white' else 0.35)
    h, w = a.shape

    if mode == 'cutout':
        edge = (a > 0.02) & (a < 0.98)
        if edge.any():
            rgb = np.where(edge[..., None], estimate_foreground(rgb, a), rgb)
        a = np.clip((a - 0.06) / 0.88, 0, 1)

    c = _on_white(rgb, a)
    s = CANVAS * FILL[mode] / max(bx1 - bx0, by1 - by0)
    upscaled = False
    if s > SR_ABOVE and max(h, w) <= SR_MAX_IN:
        c = upscale4(c)
        a = _arr(Image.fromarray((a * 255 + 0.5).astype(np.uint8), 'L').resize((w * 4, h * 4), Image.BICUBIC))
        s, (bx0, by0, bx1, by1), upscaled = s / 4, [v * 4 for v in (bx0, by0, bx1, by1)], True
        h, w = a.shape
    nw, nh = max(1, round(w * s)), max(1, round(h * s))
    over = max(nw, nh) / CANVAS
    if over > 1:
        s /= over
        nw, nh = max(1, round(w * s)), max(1, round(h * s))
    c, a = _resize(c, a, (nw, nh))
    c = _enhance(c, a, mode)
    if mode != 'pad':
        c = _on_white(c, a)
    c[a < 0.02] = 1.0

    canvas = np.ones((CANVAS, CANVAS, 3), np.float32)
    cx, cy = (bx0 + bx1) / 2 * s, (by0 + by1) / 2 * s
    ox, oy = int(round(CANVAS / 2 - cx)), int(round(CANVAS / 2 - cy))
    ox, oy = min(max(ox, 0), CANVAS - nw), min(max(oy, 0), CANVAS - nh)
    canvas[oy:oy + nh, ox:ox + nw] = c

    buf = io.BytesIO()
    _pil(canvas).save(buf, 'JPEG', quality=90, subsampling=0, optimize=True, progressive=True)
    small_source = max(size) < 400 and not upscaled
    if small_source:
        notes.append('source_very_small')
    info = {
        'mode': mode, 'upscaled': upscaled, 'confidence': confidence, 'notes': notes,
        'source': report, 'width': CANVAS, 'height': CANVAS,
        'ms': int((time.time() - t0) * 1000),
    }
    return buf.getvalue(), info
