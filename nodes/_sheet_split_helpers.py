"""Split a sheet of side-by-side pictures at the gaps between them.

A generated sheet (a character turnaround, a row of close-ups) rarely puts
each picture exactly on its share of the width. Cutting into equal parts then
lands a neighbour's sleeve in one piece and cuts another's off. Here each cut
moves to the cleanest column near its equal-share line: the column where the
fewest pixels differ from the sheet's backdrop.

Every piece is then placed on a backdrop-coloured canvas as wide as the widest
piece, so the pieces form one batch. The outer pieces keep the sheet's own
left and right edges at the canvas edge; the inner ones are centred.
"""

from __future__ import annotations

import torch

# How far a cut may move from its equal-share line, as a part of one share.
SEARCH = 0.4
# A pixel this far from the backdrop colour (0-1, any channel) counts as content.
CONTENT_STEP = 0.1
# Border strip, in pixels, that the backdrop colour is read from.
BORDER = 8


def backdrop_color(image: torch.Tensor) -> torch.Tensor:
    """The median colour of the picture's border: the sheet's backdrop."""
    height, width, channels = image.shape
    strip = max(1, min(BORDER, height // 4, width // 4))
    border = torch.cat([
        image[:strip].reshape(-1, channels),
        image[-strip:].reshape(-1, channels),
        image[:, :strip].reshape(-1, channels),
        image[:, -strip:].reshape(-1, channels),
    ])
    return border.median(dim=0).values


def column_content(image: torch.Tensor, backdrop: torch.Tensor) -> torch.Tensor:
    """For each column, how many pixels are not backdrop."""
    return ((image - backdrop).abs().amax(dim=-1) > CONTENT_STEP).sum(dim=0)


def cut_columns(image: torch.Tensor, pieces: int) -> list[int]:
    """Cut positions for one HWC picture: 0, the inner cuts, then the width."""
    width = int(image.shape[1])
    pieces = max(1, min(int(pieces), width))
    if pieces == 1:
        return [0, width]
    content = column_content(image, backdrop_color(image))
    share = width / pieces
    reach = int(share * SEARCH)
    cuts = [0]
    for index in range(1, pieces):
        centre = round(index * share)
        low = max(cuts[-1] + 1, centre - reach)
        high = min(width - (pieces - index), centre + reach + 1)
        if high <= low:
            cuts.append(min(max(centre, cuts[-1] + 1), width - (pieces - index)))
            continue
        window = content[low:high]
        cleanest = torch.nonzero(window == window.min()).flatten()
        # The middle of the longest run of cleanest columns; on a tie the run
        # nearest the equal-share line.
        breaks = torch.nonzero(cleanest[1:] - cleanest[:-1] > 1).flatten() + 1
        runs = torch.tensor_split(cleanest, breaks.tolist())
        best = max(runs, key=lambda run: (len(run), -abs(int(run.float().mean()) + low - centre)))
        cuts.append(low + int(round(float(best.float().mean()))))
    cuts.append(width)
    return cuts


def split_sheet(images: torch.Tensor, pieces: int) -> torch.Tensor:
    """Split every picture of a BHWC batch into ``pieces`` side by side.

    Returns one batch: the first picture's pieces from left to right, then the
    next picture's. All pieces share the widest piece's width.
    """
    if not isinstance(images, torch.Tensor) or images.ndim != 4:
        raise ValueError("Image Toolbox expected a BHWC IMAGE batch.")
    pieces = int(pieces)
    if pieces < 1:
        raise ValueError("Pieces must be 1 or more.")
    if pieces == 1:
        return images
    cut_sets = [cut_columns(image, pieces) for image in images]
    backdrops = [backdrop_color(image) for image in images]
    widest = max(b - a for cuts in cut_sets for a, b in zip(cuts, cuts[1:]))
    out = []
    for image, cuts, backdrop in zip(images, cut_sets, backdrops):
        height = int(image.shape[0])
        spans = list(zip(cuts, cuts[1:]))
        for index, (start, end) in enumerate(spans):
            span = end - start
            canvas = backdrop.to(image.dtype).expand(height, widest, image.shape[-1]).clone()
            if index == 0:
                offset = 0
            elif index == len(spans) - 1:
                offset = widest - span
            else:
                offset = (widest - span) // 2
            canvas[:, offset:offset + span] = image[:, start:end]
            out.append(canvas)
    return torch.stack(out)
