"""Layered PSD files, written from plain arrays.

One small writer for the one shape the pack needs: 8-bit RGB layers that are
all the size of the picture, each with optional see-through parts and an
optional layer mask, plus the flat picture every PSD carries for programs
that do not read layers. The layout
is the plain one an editor writes itself, so Photoshop, GIMP and other
editors that read PSD files open the result with its layers and masks.

The file is written straight from the format's layout, uncompressed:

    header | colour mode data | image resources | layers and masks | flat picture

Uncompressed keeps the writer short and exact. A photo barely packs with the
format's run-length scheme anyway, so the file is about as large as one saved
by an editor: 12 bytes a pixel for two layers and one mask.
"""

from __future__ import annotations

import struct
from pathlib import Path

import numpy as np

# The format's own limits for a .psd (a .psb goes further; it is not written here).
PSD_MAX_SIDE = 30000
PSD_MAX_LAYERS = 64
# A layer's lengths are 32-bit, and the whole layer block has to fit in one.
PSD_MAX_BYTES = 2**31 - 1

RAW = b"\x00\x00"  # compression 0: the bytes as they are
# A channel that takes part at every level: source and destination, 0 to 255.
_BLEND_RANGE = b"\x00\x00\xff\xff\x00\x00\xff\xff"


def _plane(array, height: int, width: int, source: str) -> np.ndarray:
    plane = np.ascontiguousarray(array, dtype=np.uint8)
    if plane.shape != (height, width):
        raise ValueError(f"{source} must be {width}x{height}, got {plane.shape[1]}x{plane.shape[0]}.")
    return plane


def _rgb(array, source: str) -> np.ndarray:
    rgb = np.ascontiguousarray(array, dtype=np.uint8)
    if rgb.ndim != 3 or rgb.shape[2] != 3:
        raise ValueError(f"{source} must be an HxWx3 picture.")
    return rgb


def _name(name: str) -> bytes:
    """A layer name as the format stores it: a length byte, the text, padded to four."""
    text = str(name or "Layer").encode("ascii", "replace")[:255]
    body = bytes([len(text)]) + text
    return body + b"\x00" * (-len(body) % 4)


def _record(name: str, height: int, width: int, has_mask: bool) -> bytes:
    """One layer's entry in the list: where it sits, its channels, how it blends."""
    plane_bytes = len(RAW) + height * width
    # Transparency first, then red, green and blue, then the layer mask.
    channels = [-1, 0, 1, 2] + ([-2] if has_mask else [])
    record = struct.pack(">4iH", 0, 0, height, width, len(channels))
    for channel in channels:
        record += struct.pack(">hI", channel, plane_bytes)
    # Normal blending, fully opaque, no clipping. Flags 8: the layer is
    # shown, and its pixels count.
    record += b"8BIM" + b"norm" + bytes([255, 0, 8, 0])
    if has_mask:
        # The mask covers the whole picture; 255 is what lies outside it.
        mask = struct.pack(">I4iBBH", 20, 0, 0, height, width, 255, 0, 0)
    else:
        mask = struct.pack(">I", 0)
    ranges = _BLEND_RANGE * 5  # the whole picture, then one for each of four channels
    extra = mask + struct.pack(">I", len(ranges)) + ranges + _name(name)
    return record + struct.pack(">I", len(extra)) + extra


def write_psd(path, layers, composite, alpha=None) -> Path:
    """Write ``layers`` (bottom one first) and the flat ``composite`` to ``path``.

    A layer is ``{"name": str, "rgb": HxWx3 uint8, "alpha": HxW uint8 or
    None, "mask": HxW uint8 or None}``. ``alpha`` is how solid each pixel is,
    255 where it is fully there; without one the layer is solid. A mask
    shows its layer where it is white and hides it where it is black, as in
    every editor. ``alpha`` beside the composite is the flat picture's own.
    All pictures must share one size.
    """
    flat = _rgb(composite, "The flat picture")
    height, width = flat.shape[:2]
    if not (0 < height <= PSD_MAX_SIDE and 0 < width <= PSD_MAX_SIDE):
        raise ValueError(f"A PSD holds pictures up to {PSD_MAX_SIDE} px a side.")
    layers = list(layers)
    if not 0 < len(layers) <= PSD_MAX_LAYERS:
        raise ValueError(f"A PSD here holds 1 to {PSD_MAX_LAYERS} layers.")

    records = []
    planes = []
    opaque = np.full((height, width), 255, dtype=np.uint8)
    for index, layer in enumerate(layers):
        source = f"Layer {index + 1}"
        rgb = _rgb(layer.get("rgb"), source)
        if rgb.shape[:2] != (height, width):
            raise ValueError(f"{source} must be {width}x{height}, the size of the flat picture.")
        mask = layer.get("mask")
        solid = layer.get("alpha")
        records.append(_record(layer.get("name", ""), height, width, mask is not None))
        planes.append(opaque if solid is None else _plane(solid, height, width, f"{source}'s alpha"))
        planes.extend(rgb[:, :, channel] for channel in range(3))
        if mask is not None:
            planes.append(_plane(mask, height, width, f"{source}'s mask"))

    if alpha is not None:
        solid = _plane(alpha, height, width, "The flat picture's alpha")
        # Photoshop keeps a see-through flat picture laid over white, and
        # readers take the white back out with its alpha.
        weight = solid[:, :, None].astype(np.float32) / 255.0
        flat = np.round(flat * weight + 255.0 * (1.0 - weight)).astype(np.uint8)
    flat_planes = [flat[:, :, channel] for channel in range(3)]
    if alpha is not None:
        flat_planes.append(solid)

    plane_bytes = len(RAW) + height * width
    layer_info = 2 + sum(len(record) for record in records) + plane_bytes * len(planes)
    padding = layer_info % 2  # the list of layers ends on an even byte
    layer_info += padding
    if layer_info > PSD_MAX_BYTES:
        raise ValueError("These layers are too large for a PSD file.")

    target = Path(path)
    with open(target, "wb") as file:
        # Version 1, three channels (four with the flat picture's alpha), 8
        # bits each, RGB.
        file.write(b"8BPS" + struct.pack(">H6xHIIHH", 1, len(flat_planes), height, width, 8, 3))
        file.write(struct.pack(">I", 0))  # no colour table
        file.write(struct.pack(">I", 0))  # no image resources
        # The layer block: its length, the list of layers, then an empty
        # block for the document-wide mask settings. A negative count says
        # the flat picture's fourth channel is its alpha.
        file.write(struct.pack(">I", 4 + layer_info + 4))
        file.write(struct.pack(">Ih", layer_info, -len(records) if alpha is not None else len(records)))
        for record in records:
            file.write(record)
        for plane in planes:
            file.write(RAW)
            file.write(plane.tobytes())
        file.write(b"\x00" * padding)
        file.write(struct.pack(">I", 0))
        # The flat picture: one compression mark, then red, green and blue
        # (and its alpha).
        file.write(RAW)
        for plane in flat_planes:
            file.write(np.ascontiguousarray(plane).tobytes())
    return target


__all__ = ["PSD_MAX_BYTES", "PSD_MAX_LAYERS", "PSD_MAX_SIDE", "write_psd"]
