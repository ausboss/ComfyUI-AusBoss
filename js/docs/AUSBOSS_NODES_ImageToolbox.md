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
- Pieces set to 1 returns the picture unchanged.
- Pieces higher than the picture's width in pixels gives one piece per
  pixel column, so fewer pieces than asked for.
