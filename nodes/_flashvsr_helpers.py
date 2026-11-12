"""FlashVSR video upscaling: the model's parts and the loop that runs a clip.

FlashVSR (OpenImagingLab, Apache-2.0) sharpens a clip in one model step.
It is a Wan 2.1 1.3B transformer that is also shown the low-quality frames,
a small projector that turns those frames into tokens, and a small decoder
that reads the frames again while it draws the result.

Everything here is plain PyTorch. The model looks at a clip a few frames at
a time and keeps a short memory of the frames before, so a long clip costs
no more graphics memory than a short one. Module and parameter names follow
the names in the published weights, which is what lets them load.

Shapes used below: a token is 16x16 output pixels of one latent frame, a
latent frame is 4 video frames, and an attention block is 2 latent frames
by 8x8 tokens (128 tokens, 128x128 pixels over 8 frames).
"""

from __future__ import annotations

import math
import os

import torch
import torch.nn as nn
import torch.nn.functional as F

PIXEL_STEP = 128  # the working size is a multiple of this in both directions
BLOCK_TOKENS = 128
KEPT_GROUPS = 3  # earlier 2-frame groups each layer remembers
LOCAL_REACH = 11  # a block looks at blocks inside an 11x11 neighbourhood
SPARSE_RATIO = 2.0
SPARSE_REFERENCE_AREA = 768 * 1280
FIRST_PASS_LATENTS = 6
PASS_LATENTS = 2
MIN_GROUPS = 3  # the first pass alone needs 25 frames
TIMESTEP = 1000.0
DEFAULT_SLOT_BUDGET = 12000


def _cast(parameter: torch.Tensor, like: torch.Tensor) -> torch.Tensor:
    return parameter.to(device=like.device, dtype=like.dtype)


# --------------------------------------------------------------------------
# Sizes and frame counts
# --------------------------------------------------------------------------


def _even(value: float) -> int:
    return max(2, int(round(value / 2.0)) * 2)


def plan_sizes(height: int, width: int, scale: float) -> tuple[int, int, int, int]:
    """Output size (even numbers) and the padded size the model works at."""
    out_h, out_w = _even(height * scale), _even(width * scale)
    work_h = math.ceil(out_h / PIXEL_STEP) * PIXEL_STEP
    work_w = math.ceil(out_w / PIXEL_STEP) * PIXEL_STEP
    return out_h, out_w, work_h, work_w


def plan_groups(frame_count: int) -> int:
    """How many 8-frame groups the padded clip has.

    The model reads 8n+1 frames and returns 8n-3, so the clip is padded by
    repeating its last frame until 8n-3 covers every frame it has.
    """
    return max(MIN_GROUPS, math.ceil((int(frame_count) + 3) / 8))


# --------------------------------------------------------------------------
# Position encoding and attention blocks
# --------------------------------------------------------------------------


def _axis_angles(dim: int, positions: torch.Tensor) -> torch.Tensor:
    steps = torch.arange(0, dim, 2, dtype=torch.float64)[: dim // 2] / dim
    return torch.outer(positions.double(), 1.0 / (10000.0**steps))


def rope_table(head_dim: int, first_frame: int, frames: int, rows: int, cols: int, device):
    """Rotation angles for every token, as (cos, sin) of shape [tokens, 1, head_dim / 2]."""
    side = head_dim // 3
    t = _axis_angles(head_dim - 2 * side, torch.arange(first_frame, first_frame + frames))
    r = _axis_angles(side, torch.arange(rows))
    c = _axis_angles(side, torch.arange(cols))
    angles = torch.cat(
        [
            t[:, None, None, :].expand(frames, rows, cols, -1),
            r[None, :, None, :].expand(frames, rows, cols, -1),
            c[None, None, :, :].expand(frames, rows, cols, -1),
        ],
        dim=-1,
    ).reshape(frames * rows * cols, 1, head_dim // 2)
    return angles.cos().float().to(device), angles.sin().float().to(device)


def apply_rope(x: torch.Tensor, cos: torch.Tensor, sin: torch.Tensor, heads: int) -> torch.Tensor:
    """Rotate each pair of channels of x [tokens, dim] by its token's angle."""
    tokens, dim = x.shape
    a, b = x.float().view(tokens, heads, dim // heads // 2, 2).unbind(-1)
    return torch.stack((a * cos - b * sin, a * sin + b * cos), dim=-1).view(tokens, dim).to(x.dtype)


def to_blocks(x: torch.Tensor, frames: int, rows: int, cols: int) -> torch.Tensor:
    """[tokens, dim] in (frame, row, column) order -> [blocks, 128, dim]."""
    dim = x.shape[-1]
    x = x.view(frames // 2, 2, rows // 8, 8, cols // 8, 8, dim).permute(0, 2, 4, 1, 3, 5, 6)
    return x.reshape(-1, BLOCK_TOKENS, dim)


def from_blocks(blocks: torch.Tensor, frames: int, rows: int, cols: int) -> torch.Tensor:
    dim = blocks.shape[-1]
    x = blocks.view(frames // 2, rows // 8, cols // 8, 2, 8, 8, dim).permute(0, 3, 1, 4, 2, 5, 6)
    return x.reshape(frames * rows * cols, dim)


def local_block_mask(block_rows: int, block_cols: int, reach: int, device) -> torch.Tensor:
    """[blocks, blocks] True where a key block is inside a query block's neighbourhood."""
    r = torch.arange(block_rows, device=device).repeat_interleave(block_cols)
    c = torch.arange(block_cols, device=device).repeat(block_rows)
    dr, dc = r[None, :] - r[:, None], c[None, :] - c[:, None]
    low, high = -(reach // 2), reach - 1 - reach // 2
    return (dr >= low) & (dr <= high) & (dc >= low) & (dc <= high)


def choose_key_blocks(
    q_blocks: torch.Tensor,
    k_blocks: torch.Tensor,
    heads: int,
    local: torch.Tensor,
    query_groups: int,
    keep: int,
) -> torch.Tensor:
    """Pick, for every head, which key blocks each query block reads.

    A block's mean query is scored against every block's mean key. Blocks
    outside the neighbourhood are ruled out, the scores of a query block are
    turned into shares that sum to one, and for each head and each 2-frame
    group of queries the `keep` largest shares win. Returns two
    [heads, query blocks, key blocks] tensors: True where a pair is kept,
    and the shares themselves (0 outside the neighbourhood).
    """
    nq, _, dim = q_blocks.shape
    nk = k_blocks.shape[0]
    head_dim = dim // heads
    q_mean = q_blocks.float().mean(1).view(nq, heads, head_dim).transpose(0, 1)
    k_mean = k_blocks.float().mean(1).view(nk, heads, head_dim).transpose(0, 1)
    scores = q_mean @ k_mean.transpose(1, 2) / math.sqrt(head_dim)
    per_group = local.shape[0]
    allowed = local.repeat(nq // per_group, nk // per_group)
    shares = scores.masked_fill(~allowed, float("-inf")).softmax(dim=-1)
    flat = shares.view(heads, query_groups, per_group * nk)
    keep = min(flat.shape[-1] - 1, int(keep))
    threshold = flat.topk(keep + 1, dim=-1).values[..., -1:]
    return (flat > threshold).view(heads, nq, nk), shares


def sparse_block_attention(
    q: torch.Tensor,
    k: torch.Tensor,
    v: torch.Tensor,
    chosen: torch.Tensor,
    shares: torch.Tensor | None = None,
    slot_budget: int = DEFAULT_SLOT_BUDGET,
) -> torch.Tensor:
    """Attention where each query block only reads its chosen key blocks.

    q is [heads, query blocks, 128, head_dim], k and v are
    [heads, key blocks, 128, head_dim] and chosen is
    [heads, query blocks, key blocks]. Each (head, query block) is a row
    that gathers the keys it chose. Rows with a similar number of chosen
    blocks run together, all at the width of the row that chose most. A
    row that chose nothing returns zeros. `slot_budget` caps
    (rows x chosen blocks) per call, which caps memory.

    With `shares` (from choose_key_blocks) a narrower row is filled up
    with its next-best blocks from its neighbourhood, so a call needs no
    padding mask, which is what makes it fast: a row then reads a few
    blocks more than it chose, never fewer. Without `shares` the padding
    is masked and every row reads exactly what it chose.
    """
    heads, nq, tokens, head_dim = q.shape
    nk = k.shape[1]
    rows = chosen.reshape(heads * nq, nk)
    counts = rows.sum(dim=1)
    if shares is None:
        rank, usable = rows.float(), counts
    else:
        flat_shares = shares.reshape(heads * nq, nk).float()
        rank, usable = rows.float() * 2 + flat_shares, (flat_shares > 0).sum(dim=1)
    order = torch.argsort(counts)
    picks = torch.argsort(rank, dim=1, descending=True, stable=True)
    picks = picks + (torch.arange(heads, device=q.device).repeat_interleave(nq) * nk)[:, None]
    q_rows = q.reshape(heads * nq, tokens, head_dim)
    k_rows = k.reshape(heads * nk, tokens, head_dim)
    v_rows = v.reshape(heads * nk, tokens, head_dim)
    out = torch.zeros_like(q_rows)
    sorted_counts = counts[order].tolist()
    total = len(sorted_counts)
    start = 0
    while start < total and sorted_counts[start] == 0:
        start += 1
    while start < total:
        end = start + 1
        while end < total and (end - start + 1) * sorted_counts[end] <= slot_budget:
            end += 1
        rows_here = order[start:end]
        widest = sorted_counts[end - 1]
        index = picks[rows_here, :widest]
        keys = k_rows[index].view(end - start, widest * tokens, head_dim)
        values = v_rows[index].view(end - start, widest * tokens, head_dim)
        mask = None
        real = torch.arange(widest, device=q.device)[None, :] < usable[rows_here][:, None]
        if not bool(real.all()):
            mask = real.repeat_interleave(tokens, dim=1)[:, None, :]
        out[rows_here] = F.scaled_dot_product_attention(q_rows[rows_here], keys, values, attn_mask=mask)
        start = end
    return out.view(heads, nq, tokens, head_dim)


class AttentionPlan:
    """What stays the same for every layer and pass at one working size."""

    def __init__(self, rows: int, cols: int, device, slot_budget: int = DEFAULT_SLOT_BUDGET):
        self.rows, self.cols = rows, cols
        self.per_group = (rows // 8) * (cols // 8)
        self.local = local_block_mask(rows // 8, cols // 8, LOCAL_REACH, device)
        ratio = SPARSE_RATIO * SPARSE_REFERENCE_AREA / (rows * 16 * cols * 16)
        self.keep = int(self.per_group * self.per_group * ratio) - 1
        self.slot_budget = slot_budget


# --------------------------------------------------------------------------
# The transformer
# --------------------------------------------------------------------------


class _RMSNorm(nn.Module):
    def __init__(self, dim: int, eps: float, device=None, dtype=None):
        super().__init__()
        self.eps = eps
        self.weight = nn.Parameter(torch.ones(dim, device=device, dtype=dtype))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        y = x.float()
        y = y * torch.rsqrt(y.pow(2).mean(dim=-1, keepdim=True) + self.eps)
        return y.to(x.dtype) * _cast(self.weight, x)


def _heads_first(blocks: torch.Tensor, heads: int) -> torch.Tensor:
    count, tokens, dim = blocks.shape
    return blocks.view(count, tokens, heads, dim // heads).permute(2, 0, 1, 3).contiguous()


class _SelfAttention(nn.Module):
    def __init__(self, dim, heads, eps, operations, device=None, dtype=None):
        super().__init__()
        self.heads = heads
        kw = {"device": device, "dtype": dtype}
        self.q = operations.Linear(dim, dim, **kw)
        self.k = operations.Linear(dim, dim, **kw)
        self.v = operations.Linear(dim, dim, **kw)
        self.o = operations.Linear(dim, dim, **kw)
        self.norm_q = _RMSNorm(dim, eps, **kw)
        self.norm_k = _RMSNorm(dim, eps, **kw)

    def forward(self, x, rope, grid, memory: dict, plan: AttentionPlan):
        frames, rows, cols = grid
        cos, sin = rope
        q = to_blocks(apply_rope(self.norm_q(self.q(x))[0], cos, sin, self.heads), *grid)
        k = to_blocks(apply_rope(self.norm_k(self.k(x))[0], cos, sin, self.heads), *grid)
        v = to_blocks(self.v(x)[0], *grid)
        if memory.get("k") is not None:
            k = torch.cat([memory["k"], k], dim=0)
            v = torch.cat([memory["v"], v], dim=0)
        chosen, shares = choose_key_blocks(q, k, self.heads, plan.local, frames // 2, plan.keep)
        out = sparse_block_attention(
            _heads_first(q, self.heads),
            _heads_first(k, self.heads),
            _heads_first(v, self.heads),
            chosen,
            shares,
            plan.slot_budget,
        )
        if k.shape[0] // plan.per_group > KEPT_GROUPS:
            k, v = k[plan.per_group :], v[plan.per_group :]
        memory["k"], memory["v"] = k, v
        out = out.permute(1, 2, 0, 3).reshape(-1, BLOCK_TOKENS, x.shape[-1])
        return self.o(from_blocks(out, *grid)[None])


class _CrossAttention(nn.Module):
    def __init__(self, dim, heads, eps, operations, device=None, dtype=None):
        super().__init__()
        self.heads = heads
        kw = {"device": device, "dtype": dtype}
        self.q = operations.Linear(dim, dim, **kw)
        self.k = operations.Linear(dim, dim, **kw)
        self.v = operations.Linear(dim, dim, **kw)
        self.o = operations.Linear(dim, dim, **kw)
        self.norm_q = _RMSNorm(dim, eps, **kw)
        self.norm_k = _RMSNorm(dim, eps, **kw)

    def _split(self, x: torch.Tensor) -> torch.Tensor:
        batch, tokens, dim = x.shape
        return x.view(batch, tokens, self.heads, dim // self.heads).transpose(1, 2)

    def forward(self, x, context, memory: dict):
        if memory.get("k") is None:  # the prompt never changes during a run
            memory["k"] = self._split(self.norm_k(self.k(context)))
            memory["v"] = self._split(self.v(context))
        out = F.scaled_dot_product_attention(self._split(self.norm_q(self.q(x))), memory["k"], memory["v"])
        return self.o(out.transpose(1, 2).reshape(x.shape))


class _Block(nn.Module):
    def __init__(self, dim, heads, ffn_dim, eps, operations, device=None, dtype=None):
        super().__init__()
        self.dim, self.eps = dim, eps
        kw = {"device": device, "dtype": dtype}
        self.self_attn = _SelfAttention(dim, heads, eps, operations, **kw)
        self.cross_attn = _CrossAttention(dim, heads, eps, operations, **kw)
        self.norm3 = operations.LayerNorm(dim, eps=eps, elementwise_affine=True, **kw)
        self.ffn = nn.Sequential(
            operations.Linear(dim, ffn_dim, **kw), nn.GELU(approximate="tanh"), operations.Linear(ffn_dim, dim, **kw)
        )
        self.modulation = nn.Parameter(torch.zeros(1, 6, dim, **kw))

    def _plain_norm(self, x: torch.Tensor) -> torch.Tensor:
        return F.layer_norm(x, (self.dim,), eps=self.eps)

    def forward(self, x, context, time_mod, rope, grid, memory: dict, plan: AttentionPlan):
        shift_a, scale_a, gate_a, shift_m, scale_m, gate_m = (_cast(self.modulation, x) + time_mod).chunk(6, dim=1)
        x = x + gate_a * self.self_attn(self._plain_norm(x) * (1 + scale_a) + shift_a, rope, grid, memory["self"], plan)
        x = x + self.cross_attn(self.norm3(x), context, memory["cross"])
        return x + gate_m * self.ffn(self._plain_norm(x) * (1 + scale_m) + shift_m)


class _Head(nn.Module):
    def __init__(self, dim, out_dim, eps, operations, device=None, dtype=None):
        super().__init__()
        self.dim, self.eps = dim, eps
        self.head = operations.Linear(dim, out_dim * 4, device=device, dtype=dtype)
        self.modulation = nn.Parameter(torch.zeros(1, 2, dim, device=device, dtype=dtype))

    def forward(self, x, time_embed):
        shift, scale = (_cast(self.modulation, x) + time_embed).chunk(2, dim=1)
        return self.head(F.layer_norm(x, (self.dim,), eps=self.eps) * (1 + scale) + shift)


# --------------------------------------------------------------------------
# The low-quality projector
# --------------------------------------------------------------------------


class _ChannelNorm(nn.Module):
    def __init__(self, dim: int, device=None, dtype=None):
        super().__init__()
        self.scale = dim**0.5
        self.gamma = nn.Parameter(torch.ones(dim, 1, 1, 1, device=device, dtype=dtype))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return F.normalize(x.float(), dim=1).to(x.dtype) * self.scale * _cast(self.gamma, x)


class LowQualityProjector(nn.Module):
    """Turns enlarged low-quality frames into one set of tokens per 4 frames.

    Two convolutions that only look backwards in time, each halving the
    frame rate, then one linear layer. `push` is fed the first frame alone,
    then 4 frames at a time, and remembers what the next call needs.
    """

    def __init__(self, out_dim=1536, hidden=(2048, 3072), patch=16, operations=nn, device=None, dtype=None):
        super().__init__()
        self.patch = patch
        kw = {"device": device, "dtype": dtype}
        self.conv1 = operations.Conv3d(3 * patch * patch, hidden[0], (4, 3, 3), stride=(2, 1, 1), **kw)
        self.norm1 = _ChannelNorm(hidden[0], **kw)
        self.conv2 = operations.Conv3d(hidden[0], hidden[1], (4, 3, 3), stride=(2, 1, 1), **kw)
        self.norm2 = _ChannelNorm(hidden[1], **kw)
        self.linear_layers = nn.ModuleList([operations.Linear(hidden[1], out_dim, **kw)])

    def _fold(self, clip: torch.Tensor) -> torch.Tensor:
        batch, channels, frames, height, width = clip.shape
        p = self.patch
        x = clip.view(batch, channels, frames, height // p, p, width // p, p).permute(0, 1, 4, 6, 2, 3, 5)
        return x.reshape(batch, channels * p * p, frames, height // p, width // p)

    @staticmethod
    def _causal(conv, x: torch.Tensor, earlier) -> torch.Tensor:
        front = 2
        if earlier is not None:
            x = torch.cat([earlier, x], dim=2)
            front -= earlier.shape[2]
        return conv(F.pad(x, (1, 1, 1, 1, front, 0), mode="replicate"))

    def push(self, memory: dict, clip: torch.Tensor):
        """clip is [1, 3, frames, height, width] in -1..1. Returns tokens, or None for the first frame."""
        first = not memory
        if first:
            clip = torch.cat([clip[:, :, :1].repeat(1, 1, 3, 1, 1), clip], dim=2)
        x = self._fold(clip)
        tail = x[:, :, -2:].clone()
        x = F.silu(self.norm1(self._causal(self.conv1, x, memory.get("conv1"))))
        memory["conv1"] = tail
        tail = x[:, :, -2:].clone()
        if first:
            memory["conv2"] = tail
            return None
        x = F.silu(self.norm2(self._causal(self.conv2, x, memory["conv2"])))
        memory["conv2"] = tail
        return self.linear_layers[0](x.flatten(2).transpose(1, 2))


# --------------------------------------------------------------------------
# The fast decoder
# --------------------------------------------------------------------------


class _SoftClamp(nn.Module):
    def forward(self, x):
        return torch.tanh(x / 3) * 3


class _MemoryBlock(nn.Module):
    """A residual block that also sees the frame before."""

    def __init__(self, width: int, operations, device=None, dtype=None):
        super().__init__()
        kw = {"device": device, "dtype": dtype}
        self.conv = nn.Sequential(
            operations.Conv2d(width * 2, width, 3, padding=1, **kw),
            nn.ReLU(),
            operations.Conv2d(width, width, 3, padding=1, **kw),
            nn.ReLU(),
            operations.Conv2d(width, width, 3, padding=1, **kw),
        )

    def forward(self, x, past):
        return F.relu(self.conv(torch.cat([x, past], dim=1)) + x)


class _TimeGrow(nn.Module):
    """Makes `stride` frames out of each frame."""

    def __init__(self, width: int, stride: int, operations, device=None, dtype=None):
        super().__init__()
        self.conv = operations.Conv2d(width, width * stride, 1, bias=False, device=device, dtype=dtype)

    def forward(self, x):
        _, channels, height, width = x.shape
        return self.conv(x).reshape(-1, channels, height, width)


class _Upsample(nn.Module):
    def forward(self, x):
        return F.interpolate(x, scale_factor=2, mode="nearest")


class ConditionedDecoder(nn.Module):
    """Latent frames plus the low-quality frames in, 4 video frames per latent frame out."""

    def __init__(self, latent_channels=16, widths=(512, 256, 128, 128), operations=nn, device=None, dtype=None):
        super().__init__()
        kw = {"device": device, "dtype": dtype}
        a, b, c, d = widths

        def conv(n_in, n_out, bias=True):
            return operations.Conv2d(n_in, n_out, 3, padding=1, bias=bias, **kw)

        def memory_blocks(width):
            return [_MemoryBlock(width, operations, **kw) for _ in range(3)]

        self.latent_channels = latent_channels
        self.decoder = nn.Sequential(
            _SoftClamp(),
            conv(latent_channels + 3 * 4 * 8 * 8, a),
            nn.ReLU(),
            conv(a, a, bias=False),
            nn.ReLU(),
            *memory_blocks(a),
            _Upsample(),
            _TimeGrow(a, 1, operations, **kw),
            conv(a, b, bias=False),
            *memory_blocks(b),
            _Upsample(),
            _TimeGrow(b, 2, operations, **kw),
            conv(b, c, bias=False),
            *memory_blocks(c),
            _Upsample(),
            _TimeGrow(c, 2, operations, **kw),
            conv(c, d, bias=False),
            nn.ReLU(),
            conv(d, d, bias=False),
            nn.ReLU(),
            conv(d, 3),
        )

    @staticmethod
    def fold_frames(clip: torch.Tensor) -> torch.Tensor:
        """[3, 4, height, width] -> [768, height / 8, width / 8]."""
        channels, frames, height, width = clip.shape
        x = clip.view(channels, frames, height // 8, 8, width // 8, 8).permute(0, 1, 3, 5, 2, 4)
        return x.reshape(channels * frames * 64, height // 8, width // 8)

    def decode(self, memory: dict, x: torch.Tensor) -> torch.Tensor:
        """x is [latent frames, 768 + latent channels, h, w]. Returns [4 x latent frames, 3, 8h, 8w] in 0..1.

        The first 3 frames of the first call are lead-in and are dropped.
        """
        first = not memory
        memory["started"] = True
        for index, layer in enumerate(self.decoder):
            if isinstance(layer, _MemoryBlock):
                before = memory.get(index)
                if before is None:
                    before = torch.zeros_like(x[:1])
                memory[index] = x[-1:].clone()
                x = layer(x, torch.cat([before, x[:-1]], dim=0))
            else:
                x = layer(x)
        return x[3:] if first else x


# --------------------------------------------------------------------------
# The whole model
# --------------------------------------------------------------------------


class FlashVSRModel(nn.Module):
    def __init__(
        self,
        dim=1536,
        heads=12,
        ffn_dim=8960,
        layers=30,
        latent_channels=16,
        text_dim=4096,
        text_len=512,
        freq_dim=256,
        eps=1e-6,
        projector_hidden=(2048, 3072),
        decoder_widths=(512, 256, 128, 128),
        operations=nn,
        device=None,
        dtype=None,
    ):
        super().__init__()
        self.dim, self.heads, self.freq_dim, self.latent_channels = dim, heads, freq_dim, latent_channels
        kw = {"device": device, "dtype": dtype}
        self.patch_embedding = operations.Conv3d(latent_channels, dim, (1, 2, 2), stride=(1, 2, 2), **kw)
        self.text_embedding = nn.Sequential(
            operations.Linear(text_dim, dim, **kw), nn.GELU(approximate="tanh"), operations.Linear(dim, dim, **kw)
        )
        self.time_embedding = nn.Sequential(
            operations.Linear(freq_dim, dim, **kw), nn.SiLU(), operations.Linear(dim, dim, **kw)
        )
        self.time_projection = nn.Sequential(nn.SiLU(), operations.Linear(dim, dim * 6, **kw))
        self.blocks = nn.ModuleList([_Block(dim, heads, ffn_dim, eps, operations, **kw) for _ in range(layers)])
        self.head = _Head(dim, latent_channels, eps, operations, **kw)
        self.lq_proj_in = LowQualityProjector(dim, projector_hidden, operations=operations, **kw)
        self.tc_decoder = ConditionedDecoder(latent_channels, decoder_widths, operations=operations, **kw)
        self.register_buffer("positive_conditioning", torch.zeros(text_len, text_dim, **kw))

    def start(self, like: torch.Tensor) -> dict:
        """The values that never change during one clip."""
        half = self.freq_dim // 2
        steps = torch.pow(10000.0, -torch.arange(half, dtype=torch.float64) / half) * TIMESTEP
        wave = torch.cat([torch.cos(steps), torch.sin(steps)])[None].to(device=like.device, dtype=like.dtype)
        time_embed = self.time_embedding(wave)
        return {
            "time_embed": time_embed[:, None],
            "time_mod": self.time_projection(time_embed).unflatten(1, (6, self.dim)),
            "context": self.text_embedding(_cast(self.positive_conditioning, like)[None]),
            "layers": [{"self": {}, "cross": {}} for _ in self.blocks],
            "projector": {},
            "decoder": {},
        }

    def denoise(self, state: dict, noise: torch.Tensor, lq_tokens: torch.Tensor, first_frame: int, plan: AttentionPlan):
        """One pass over a few latent frames. Returns the clean latent frames."""
        x = self.patch_embedding(noise)
        frames, rows, cols = x.shape[2:]
        grid = (frames, rows, cols)
        x = x.flatten(2).transpose(1, 2) + lq_tokens
        rope = rope_table(self.dim // self.heads, first_frame, frames, rows, cols, x.device)
        for block, memory in zip(self.blocks, state["layers"]):
            x = block(x, state["context"], state["time_mod"], rope, grid, memory, plan)
        x = self.head(x, state["time_embed"])
        x = x.view(1, frames, rows, cols, 2, 2, self.latent_channels).permute(0, 6, 1, 2, 4, 3, 5)
        return noise - x.reshape(1, self.latent_channels, frames, rows * 2, cols * 2)


def pass_layout(groups: int):
    """(first latent frame, latent frames) of each pass over a clip of `groups` 8-frame groups."""
    yield 0, FIRST_PASS_LATENTS
    for index in range(1, groups - 2):
        yield 4 + 2 * index, PASS_LATENTS


def match_colors(frames: torch.Tensor, source: torch.Tensor) -> torch.Tensor:
    """Give each frame its source frame's mean and spread, per colour channel. Both [n, 3, h, w]."""
    f, s = frames.float(), source.float()
    f_mean, s_mean = f.mean(dim=(2, 3), keepdim=True), s.mean(dim=(2, 3), keepdim=True)
    f_std, s_std = f.std(dim=(2, 3), keepdim=True) + 1e-5, s.std(dim=(2, 3), keepdim=True) + 1e-5
    return (f - f_mean) / f_std * s_std + s_mean


TILE_OVERLAP = 128


def plan_tiles(work_h: int, work_w: int, max_pixels: int | None) -> list[tuple[int, int, int, int]]:
    """Cut the working size into as few overlapping tiles as fit `max_pixels` each.

    Returns (top, left, height, width) boxes. Tile sides are multiples of
    128 and corners sit on the 16-pixel token grid. One box, the whole
    picture, when it fits or when no limit is given.
    """
    if not max_pixels or work_h * work_w <= max_pixels:
        return [(0, 0, work_h, work_w)]

    def side(total: int, parts: int) -> int:
        if parts == 1:
            return total
        return min(total, math.ceil((total + (parts - 1) * TILE_OVERLAP) / parts / PIXEL_STEP) * PIXEL_STEP)

    best = None
    for rows in range(1, work_h // PIXEL_STEP + 1):
        for cols in range(1, work_w // PIXEL_STEP + 1):
            tile_h, tile_w = side(work_h, rows), side(work_w, cols)
            if tile_h * tile_w <= max_pixels and (best is None or rows * cols < best[0] * best[1]):
                best = (rows, cols, tile_h, tile_w)
    if best is None:  # even one 128x128 tile is over the limit: use the smallest tiles there are
        best = (work_h // PIXEL_STEP, work_w // PIXEL_STEP, PIXEL_STEP, PIXEL_STEP)
    rows, cols, tile_h, tile_w = best

    def starts(total: int, tile: int, parts: int) -> list[int]:
        if parts == 1:
            return [0]
        return [round(i * (total - tile) / (parts - 1) / 16) * 16 for i in range(parts)]

    return [(top, left, tile_h, tile_w) for top in starts(work_h, tile_h, rows) for left in starts(work_w, tile_w, cols)]


def tile_weight(box: tuple[int, int, int, int], work_h: int, work_w: int) -> torch.Tensor:
    """[height, width] blend weights for a tile: 1 inside, fading over the overlap on edges that meet another tile."""
    top, left, height, width = box

    def ramp(length: int, fade_start: bool, fade_end: bool) -> torch.Tensor:
        w = torch.ones(length)
        fade = (torch.arange(TILE_OVERLAP) + 0.5) / TILE_OVERLAP
        if fade_start:
            w[:TILE_OVERLAP] = fade
        if fade_end:
            w[-TILE_OVERLAP:] = torch.minimum(w[-TILE_OVERLAP:], fade.flip(0))
        return w

    rows = ramp(height, top > 0, top + height < work_h)
    cols = ramp(width, left > 0, left + width < work_w)
    return rows[:, None] * cols[None, :]


@torch.no_grad()
def upscale_frames(
    model: FlashVSRModel,
    frames: torch.Tensor,
    scale: float,
    *,
    device,
    dtype,
    color_match: bool = True,
    seed: int = 0,
    slot_budget: int = DEFAULT_SLOT_BUDGET,
    max_tile_pixels: int | None = None,
    decode_latents=None,
    on_pass=None,
) -> torch.Tensor:
    """Upscale a clip. `frames` is [count, height, width, 3] in 0..1; so is the result, at the new size.

    A picture larger than `max_tile_pixels` is done in overlapping tiles,
    one after the other, and blended; that is what bounds graphics memory.
    `decode_latents`, when given, takes the clean latent frames of a tile
    ([1, 16, frames, h, w]) and returns [frames, height, width, 3]; it is how
    another decoder (the Wan 2.1 VAE) is used in place of the fast one.
    `on_pass(done, total)` is called after each pass.
    """
    count, height, width, _ = frames.shape
    out_h, out_w, work_h, work_w = plan_sizes(height, width, scale)
    groups = plan_groups(count)
    layout = list(pass_layout(groups))
    tiles = plan_tiles(work_h, work_w, max_tile_pixels)

    def enlarged(start: int, stop: int) -> torch.Tensor:
        """Frames start..stop-1 of the padded clip at the working size: [n, 3, work_h, work_w] in 0..1."""
        index = torch.arange(start, stop).clamp(max=count - 1)
        x = frames[index][..., :3].to(device).movedim(-1, 1).float()
        if (height, width) != (out_h, out_w):
            x = F.interpolate(x, size=(out_h, out_w), mode="bicubic", align_corners=False).clamp(0, 1)
        return F.pad(x, (0, work_w - out_w, 0, work_h - out_h), mode="replicate")

    noise = torch.randn(
        (1, model.latent_channels, 2 * groups, work_h // 8, work_w // 8), generator=torch.Generator().manual_seed(seed)
    )
    result = torch.zeros((count, out_h, out_w, 3), dtype=torch.float32)
    total_weight = torch.zeros((work_h, work_w), dtype=torch.float32)
    like = torch.zeros(1, device=device, dtype=dtype)
    done = 0
    for box in tiles:
        top, left, tile_h, tile_w = box
        weight = tile_weight(box, work_h, work_w)
        total_weight[top : top + tile_h, left : left + tile_w] += weight
        weight = weight.to(device)

        def crop(start: int, stop: int) -> torch.Tensor:
            return enlarged(start, stop)[..., top : top + tile_h, left : left + tile_w]

        def signed_clip(start: int, stop: int) -> torch.Tensor:
            return (crop(start, stop) * 2 - 1).movedim(0, 1)[None].to(dtype)

        def store(decoded: torch.Tensor, written: int) -> int:
            """Add decoded frames [n, 3, tile_h, tile_w] to the result; returns how many frames the tile has given."""
            decoded = decoded[: count - written].float()
            if decoded.shape[0] == 0:
                return written
            stop = written + decoded.shape[0]
            if color_match:
                decoded = match_colors(decoded, crop(written, stop))
            bottom, right = min(top + tile_h, out_h), min(left + tile_w, out_w)
            if bottom > top and right > left:
                piece = (decoded.clamp(0, 1) * weight)[..., : bottom - top, : right - left]
                result[written:stop, top:bottom, left:right] += piece.movedim(1, -1).cpu()
            return stop

        state = model.start(like)
        plan = AttentionPlan(tile_h // 16, tile_w // 16, device, slot_budget)
        tile_noise = noise[..., top // 8 : (top + tile_h) // 8, left // 8 : (left + tile_w) // 8]
        kept_latents = []
        written = 0
        model.lq_proj_in.push(state["projector"], signed_clip(0, 1))
        for first, latent_count in layout:
            tokens = torch.cat(
                [
                    model.lq_proj_in.push(state["projector"], signed_clip(4 * i + 1, 4 * i + 5))
                    for i in range(first, first + latent_count)
                ],
                dim=1,
            )
            chunk = tile_noise[:, :, first : first + latent_count].to(device=device, dtype=dtype)
            latents = model.denoise(state, chunk, tokens, first, plan)
            if decode_latents is not None:
                kept_latents.append(latents.float().cpu())
            else:
                for i in range(first, first + latent_count):
                    if written >= count:
                        break
                    source = signed_clip(0, 1)[0].repeat(1, 4, 1, 1) if i == 0 else signed_clip(4 * i - 3, 4 * i + 1)[0]
                    both = torch.cat([ConditionedDecoder.fold_frames(source), latents[0, :, i - first]], dim=0)
                    written = store(model.tc_decoder.decode(state["decoder"], both[None]), written)
            done += 1
            if on_pass is not None:
                on_pass(done, len(layout) * len(tiles))
        state.clear()  # the layers' memory is no longer needed; the next tile or another decoder wants the room
        if decode_latents is not None:
            decoded = decode_latents(torch.cat(kept_latents, dim=2)).movedim(-1, 1)
            for start in range(0, min(count, decoded.shape[0]), 8):
                written = store(decoded[start : start + 8].to(device), written)
    if len(tiles) > 1:
        result /= total_weight[:out_h, :out_w, None]
    return result


# --------------------------------------------------------------------------
# ComfyUI side: loading the file and running a clip. ComfyUI is imported
# inside the functions so the code above runs without it.
# --------------------------------------------------------------------------

MODEL_PARTS = {
    "blocks.0.self_attn.q.weight": "the transformer",
    "lq_proj_in.conv1.weight": "the low-quality projector",
    "tc_decoder.decoder.1.weight": "the fast decoder",
    "positive_conditioning": "the stored prompt",
}
NOT_A_FLASHVSR_FILE = (
    "This is not a FlashVSR model file for this node: it has no {missing}. "
    "Pick the FlashVSR file named in the node's help page."
)

_loaded: dict = {}


# Measured on one clip (640x1024, bf16): about 9.6 KB of graphics memory per working pixel on top of
# the weights. Most of it is the keys and values every layer keeps of the last few frames.
WORKING_BYTES_PER_PIXEL = 12_000
MEMORY_TO_ASK_FOR = 16 * 1024**3
MEMORY_HEADROOM = 1024**3


def working_memory(pixels: int, bytes_per_value: int = 2) -> int:
    """A rough count of the graphics memory a picture of `pixels` needs besides the weights, in bytes."""
    return int(pixels * WORKING_BYTES_PER_PIXEL * bytes_per_value / 2)


def tile_pixels_that_fit(free_bytes: int, bytes_per_value: int = 2) -> int:
    """The largest tile, in pixels, that `free_bytes` of graphics memory can hold."""
    return max(PIXEL_STEP * PIXEL_STEP, int((free_bytes - MEMORY_HEADROOM) / working_memory(1_000_000, bytes_per_value) * 1_000_000))


def load_flashvsr(path: str, dtype: torch.dtype | None = None):
    """The model behind ComfyUI's memory manager, and the number type it runs in. Kept between runs."""
    import comfy.model_management as mm
    import comfy.model_patcher
    import comfy.ops
    import comfy.utils

    stamp = (path, os.path.getmtime(path), dtype)
    if _loaded.get("stamp") == stamp:
        return _loaded["patcher"], _loaded["dtype"]
    _loaded.clear()
    weights = comfy.utils.load_torch_file(path, safe_load=True)
    missing = [what for key, what in MODEL_PARTS.items() if key not in weights]
    if missing:
        raise ValueError(NOT_A_FLASHVSR_FILE.format(missing=" or ".join(missing)))
    device, offload = mm.get_torch_device(), mm.unet_offload_device()
    if dtype is None:
        # The file is 16-bit, so that is the first choice: no weight has to be converted.
        if mm.should_use_fp16(device):
            dtype = torch.float16
        elif mm.should_use_bf16(device):
            dtype = torch.bfloat16
        else:
            dtype = torch.float32
    # manual_cast: every layer brings its weights to the device and number type of what it is given,
    # so a model ComfyUI keeps partly, or wholly, outside graphics memory still runs.
    model = FlashVSRModel(operations=comfy.ops.manual_cast, device=offload, dtype=dtype)
    model.eval()
    # ComfyUI's own wrapper for a model: the one that loads weights as they are needed, where it has one.
    wrapper = getattr(comfy.model_patcher, "CoreModelPatcher", comfy.model_patcher.ModelPatcher)
    patcher = wrapper(model, load_device=device, offload_device=offload)
    assign = bool(getattr(patcher, "is_dynamic", lambda: False)())
    model.load_state_dict(weights, strict=True, assign=assign)
    model.requires_grad_(False)
    _loaded.update(stamp=stamp, patcher=patcher, dtype=dtype)
    return patcher, dtype


def _memory_for_work(patcher, device) -> int:
    """Graphics memory left for the picture once all of the model's weights are in it."""
    import comfy.model_management as mm

    free = mm.get_free_memory(device)
    try:
        still_to_load = max(0, int(patcher.model_size()) - int(patcher.loaded_size()))
    except Exception:
        still_to_load = 0
    return free - still_to_load


def run_flashvsr(
    path: str,
    frames: torch.Tensor,
    scale: float,
    color_match: bool = True,
    vae=None,
    seed: int = 0,
    max_tile_pixels: int | None = None,
):
    """Upscale `frames` with the model file at `path`. `vae`, when given, decodes in place of the fast decoder."""
    import comfy.latent_formats
    import comfy.model_management as mm

    from ._execution_helpers import progress_bar, raise_if_interrupted

    patcher, dtype = load_flashvsr(path)
    device = patcher.load_device
    _, _, work_h, work_w = plan_sizes(frames.shape[1], frames.shape[2], scale)
    wanted = working_memory(work_h * work_w, dtype.itemsize)
    mm.load_models_gpu([patcher], memory_required=min(wanted, MEMORY_TO_ASK_FOR))
    if max_tile_pixels is None and device.type != "cpu":
        max_tile_pixels = tile_pixels_that_fit(_memory_for_work(patcher, device), dtype.itemsize)
    passes = len(list(pass_layout(plan_groups(frames.shape[0]))))

    decode = None
    if vae is not None:
        latent_format = comfy.latent_formats.Wan21()

        def decode(latents: torch.Tensor) -> torch.Tensor:
            images = vae.decode(latent_format.process_out(latents))
            return images.reshape(-1, *images.shape[-3:])

    while True:
        progress = progress_bar(passes * len(plan_tiles(work_h, work_w, max_tile_pixels)))

        def on_pass(done: int, total: int) -> None:
            raise_if_interrupted()
            if progress is not None:
                progress.update_absolute(done, total)

        try:
            return upscale_frames(
                patcher.model,
                frames,
                scale,
                device=device,
                dtype=dtype,
                color_match=color_match,
                seed=seed,
                max_tile_pixels=max_tile_pixels,
                decode_latents=decode,
                on_pass=on_pass,
            )
        except torch.cuda.OutOfMemoryError:
            # Out of graphics memory: start again in tiles half the size, down to the smallest tile.
            tried = max_tile_pixels if max_tile_pixels is not None else work_h * work_w
            if tried <= PIXEL_STEP * PIXEL_STEP:
                raise
            max_tile_pixels = max(PIXEL_STEP * PIXEL_STEP, min(tried, work_h * work_w) // 2)
            mm.soft_empty_cache()


MODEL_FOLDER = "diffusion_models"
EXPECTED_MODEL_NAME = "flashvsr_v1.1_fp16.safetensors"
MODEL_NOT_FOUND = (
    "FlashVSR Upscale could not find {name} in ComfyUI/models/diffusion_models. "
    "Download the FlashVSR model file named in the node's help page and put it there."
)


def list_flashvsr_models() -> list[str]:
    """FlashVSR files in the diffusion models folder; every file there when none is named FlashVSR."""
    try:
        import folder_paths
    except ImportError:  # Offline tests import this module without ComfyUI.
        return [EXPECTED_MODEL_NAME]
    names = list(folder_paths.get_filename_list(MODEL_FOLDER))
    ours = [name for name in names if "flashvsr" in name.lower().replace("_", "").replace("-", "")]
    return ours or names or [EXPECTED_MODEL_NAME]


def resolve_flashvsr_model(name: str) -> str:
    import folder_paths

    path = folder_paths.get_full_path(MODEL_FOLDER, name)
    if not path:
        raise FileNotFoundError(MODEL_NOT_FOUND.format(name=name))
    return path
