# Image Toolbox

Small picture jobs in one node. Pick the job from the **Job** list (`job`);
the rows under it change to what that job needs.

## Jobs

### split sheet at gaps

Cuts a row of pictures that sit side by side, such as the four views of a
character sheet, into separate pictures.

- **Pieces** (`pieces`): how many pictures are on the sheet. 4 for a
  four-view character sheet.

Each cut goes to the gap between two pictures, not to an equal share of the
width. An image model rarely puts each view exactly on its quarter of a
sheet, so cutting into equal parts can leave part of a neighbour's sleeve in
one piece and cut another's off. Here every piece holds one picture.

The pieces come out as one batch, from left to right, all the same size.
Narrower pieces are padded with the sheet's backdrop colour. The first and
last pieces keep the sheet's own left and right edges at their outer edge,
so a person drawn up to the edge of the sheet does not look cut off by a
band of padding. Wire the batch into Save Image to save each piece as its
own file.

A batch of sheets is cut sheet by sheet: the first sheet's pieces, then the
next sheet's.

### cut a piece

Cuts one piece out of the picture, at the size and place you set. Use it when
the parts you need are not the same size, or when you know exactly where a
part is.

- **Width** and **Height** (`width`, `height`): the piece's size in pixels.
  0 takes the picture's full width or height.
- **Position** (`position`): where the piece sits, from **top left** to
  **bottom right**. **center** puts it in the middle.
- **Move right** and **Move down** (`move_right`, `move_down`): move the
  piece from that position by this many pixels. Below 0 moves it left or up.

The piece never leaves the picture. A size larger than the picture is cut to
the picture's size, and a move that would push the piece past an edge stops
at that edge.

The piece comes out of **images**. The second output, **rest**, is what is
left of the picture:

- When the piece is as tall as the picture and sits against its left or
  right edge, **rest** is the strip beside it. The same goes for a piece as
  wide as the picture at the top or bottom. So to split a picture into two
  parts of different sizes, set the first part's width, Height 0, and
  Position **left**: **images** is the first part and **rest** the second.
- Any other piece leaves a hole, and **rest** is the whole picture with the
  hole filled with the picture's backdrop colour.

A batch is cut at the same place in every picture. Other jobs pass the
picture through **rest** unchanged.

## Technical details

- The backdrop colour is the median colour of the picture's border.
- A pixel counts as part of a picture when any channel differs from the
  backdrop by more than 0.1 (on a 0-1 scale).
- Each cut looks for the column with the fewest such pixels, up to 40% of
  one piece's width either side of the equal-share line, and takes the
  middle of the longest run of those columns.
- When two pictures overlap on the sheet, no column is clean. The cut then
  goes where the least of them is lost, and a small part of one can remain
  in the other's piece.
- cut a piece fills its hole with the same backdrop colour.
- Pieces set to 1 returns the picture unchanged.
- Pieces higher than the picture's width in pixels gives one piece per
  pixel column, so fewer pieces than asked for.
