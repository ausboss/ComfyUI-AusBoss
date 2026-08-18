"""Registered reference attention for Krea 2.

Krea 2's single-stream DiT reads position from RoPE. A reference latent
appended as extra tokens therefore has to be given coordinates, or the model
has no idea where on the canvas it belongs. These helpers place the reference
grid at a normalized bbox on frame axis 1 (the target occupies axis 0), then
run the blocks once with the reference keys and values precomputed, so the
reference is attended to without being denoised.

Everything here reaches into comfy's flux layers, so it is version-sensitive
by nature - see the Krea 2 section of the README for the versions it is
tested against.
"""

from __future__ import annotations

import math
import torch
import torch.nn.functional as F
from einops import rearrange

import comfy.conds
import comfy.ldm.common_dit
import comfy.utils
from comfy.ldm.flux.layers import timestep_embedding
from comfy.ldm.flux.math import apply_rope
from comfy.ldm.modules.attention import optimized_attention_masked


def _target_grid(x: torch.Tensor, patch: int) -> tuple[int, int]:
    hs, ws = x.shape[-2], x.shape[-1]
    hp = ((hs + patch - 1) // patch) * patch
    wp = ((ws + patch - 1) // patch) * patch
    return hp // patch, wp // patch


def _pack_refs(
    dit,
    ref_latents,
    bs: int,
    device: torch.device,
    dtype: torch.dtype,
    target_hw: tuple[int, int] | None = None,
    bbox_norm: list[float] | None = None,
):
    patch = dit.patch
    ref_tokens = []
    ref_pos = []
    for i, ref in enumerate(ref_latents):
        if ref.ndim == 5:
            rb, rc, rt, rh5, rw5 = ref.shape
            ref = ref.reshape(rb * rt, rc, rh5, rw5)
        ref = comfy.ldm.common_dit.pad_to_patch_size(ref.to(device, dtype), (patch, patch))
        ref = comfy.utils.repeat_to_batch_size(ref, bs)
        rh, rw = ref.shape[-2] // patch, ref.shape[-1] // patch
        ref_tokens.append(
            rearrange(ref, "b c (h ph) (w pw) -> b (h w) (c ph pw)", ph=patch, pw=patch)
        )
        rid = torch.zeros(rh, rw, 3, device=device, dtype=torch.float32)
        rid[..., 0] = i + 1.0
        if bbox_norm is None:
            rid[..., 1] = torch.arange(rh, device=device, dtype=torch.float32)[:, None]
            rid[..., 2] = torch.arange(rw, device=device, dtype=torch.float32)[None, :]
        else:
            if target_hw is None:
                raise ValueError("target_hw is required for a registered reference.")
            th, tw = target_hw
            x0, y0, x1, y1 = (float(v) for v in bbox_norm)
            ys = y0 * th + (torch.arange(rh, device=device, dtype=torch.float32) + 0.5) * (
                (y1 - y0) * th / rh
            ) - 0.5
            xs = x0 * tw + (torch.arange(rw, device=device, dtype=torch.float32) + 0.5) * (
                (x1 - x0) * tw / rw
            ) - 0.5
            rid[..., 1] = ys[:, None]
            rid[..., 2] = xs[None, :]
        ref_pos.append(rid.reshape(1, rh * rw, 3).repeat(bs, 1, 1))
    return torch.cat(ref_tokens, dim=1), torch.cat(ref_pos, dim=1)


def _attn_kv(
    attn,
    x,
    freqs,
    mask=None,
    kv_capture=None,
    kv_cache=None,
    transformer_options={},
):
    q, k, v, gate = attn.wq(x), attn.wk(x), attn.wv(x), attn.gate(x)
    q = rearrange(q, "B L (H D) -> B H L D", H=attn.heads)
    k = rearrange(k, "B L (H D) -> B H L D", H=attn.kvheads)
    v = rearrange(v, "B L (H D) -> B H L D", H=attn.kvheads)
    q, k = attn.qknorm(q, k)
    if freqs is not None:
        q, k = apply_rope(q, k, freqs)
    if kv_capture is not None:
        kv_capture.append((k, v))
    if kv_cache is not None:
        k = torch.cat((k, kv_cache[0].to(k.dtype)), dim=2)
        v = torch.cat((v, kv_cache[1].to(v.dtype)), dim=2)
    if attn.kvheads != attn.heads:
        rep = attn.heads // attn.kvheads
        k = k.repeat_interleave(rep, dim=1)
        v = v.repeat_interleave(rep, dim=1)
    out = optimized_attention_masked(
        q,
        k,
        v,
        attn.heads,
        mask=mask,
        skip_reshape=True,
        transformer_options=transformer_options,
    )
    return attn.wo(out * F.sigmoid(gate))


def _block_kv_forward(
    block,
    x,
    vec,
    freqs,
    kv_capture=None,
    kv_cache=None,
    transformer_options={},
):
    prescale, preshift, pregate, postscale, postshift, postgate = block.mod(vec)
    x = x + pregate * _attn_kv(
        block.attn,
        (1 + prescale) * block.prenorm(x) + preshift,
        freqs,
        kv_capture=kv_capture,
        kv_cache=kv_cache,
        transformer_options=transformer_options,
    )
    x = x + postgate * block.mlp((1 + postscale) * block.postnorm(x) + postshift)
    return x


def _precompute_ref_kv(
    dit, x, timesteps, ref_latents, transformer_options, bbox_norm=None
):
    temporal = x.ndim == 5
    bs = x.shape[0] * (x.shape[2] if temporal else 1)
    th, tw = _target_grid(x, dit.patch)
    reftok, refpos = _pack_refs(
        dit, ref_latents, bs, x.device, x.dtype, target_hw=(th, tw), bbox_norm=bbox_norm
    )
    h = dit.first(reftok)
    t0 = dit.tmlp(
        timestep_embedding(torch.zeros_like(timesteps), dit.tdim).unsqueeze(1).to(h.dtype)
    )
    tvec0 = dit.tproj(t0)
    freqs = dit.pe_embedder(refpos)

    ref_kv = []
    for block in dit.blocks:
        cap = []
        h = _block_kv_forward(
            block,
            h,
            tvec0,
            freqs,
            kv_capture=cap,
            transformer_options=transformer_options,
        )
        ref_kv.append(cap[0])
    return ref_kv


def _forward_with_cached_refs(
    dit, x, timesteps, context, ref_kv, transformer_options
):
    temporal = x.ndim == 5
    if temporal:
        b5, c5, t5, h5, w5 = x.shape
        x = x.reshape(b5 * t5, c5, h5, w5)
    bs, c, H_orig, W_orig = x.shape
    patch = dit.patch
    x = comfy.ldm.common_dit.pad_to_patch_size(x, (patch, patch))
    H, W = x.shape[-2], x.shape[-1]
    h_, w_ = H // patch, W // patch
    device = x.device

    context = dit._unpack_context(context)
    img = dit.first(
        rearrange(x, "b c (h ph) (w pw) -> b (h w) (c ph pw)", ph=patch, pw=patch)
    )

    t = dit.tmlp(timestep_embedding(timesteps, dit.tdim).unsqueeze(1).to(img.dtype))
    tvec = dit.tproj(t)

    context = dit.txtfusion(context, mask=None, transformer_options=transformer_options)
    context = dit.txtmlp(context)

    txtlen, imglen = context.shape[1], img.shape[1]
    combined = torch.cat((context, img), dim=1)

    txtpos = torch.zeros(bs, txtlen, 3, device=device, dtype=torch.float32)
    imgids = torch.zeros(h_, w_, 3, device=device, dtype=torch.float32)
    imgids[..., 1] = torch.arange(h_, device=device, dtype=torch.float32)[:, None]
    imgids[..., 2] = torch.arange(w_, device=device, dtype=torch.float32)[None, :]
    imgpos = imgids.reshape(1, h_ * w_, 3).repeat(bs, 1, 1)
    pos = torch.cat((txtpos, imgpos), dim=1)

    freqs = dit.pe_embedder(pos)

    for block, kv in zip(dit.blocks, ref_kv):
        combined = _block_kv_forward(
            block,
            combined,
            tvec,
            freqs,
            kv_cache=kv,
            transformer_options=transformer_options,
        )

    final = dit.last(combined, t)
    out = final[:, txtlen : txtlen + imglen, :]
    out = rearrange(
        out,
        "b (h w) (c ph pw) -> b c (h ph) (w pw)",
        h=h_,
        w=w_,
        ph=patch,
        pw=patch,
        c=dit.channels,
    )
    out = out[:, :, :H_orig, :W_orig]
    if temporal:
        out = out.reshape(b5, t5, dit.channels, H_orig, W_orig).movedim(1, 2)
    return out


def _ref_fingerprint(ref_latents, bs: int, bbox_norm: list[float] | None):
    key = [bs, tuple(round(v, 6) for v in bbox_norm) if bbox_norm is not None else None]
    for r in ref_latents:
        rf = r.float()
        key.append((tuple(r.shape), float(rf.sum()), float(rf.square().sum())))
    return tuple(key)
