# H3 Prompt Writer

Type what happens, one line for each moment. Leave a blank line to cut to a new
place. The node writes H3's full prompt for you, and you never see its format.

Use it with MiniMax H3 or Pika H3 Flex. Connect up to four pictures and give each
one a job. Copy the moves from a video, keep a clip going, or add a voice or a
song.

## How to write it

Every line is a moment, and the lines play in order in one shot. The bar under
the box shows the second each one starts, before you spend a run.

```
@1 walks through a crowded night market toward us, looking over her shoulder.
@1 stops and looks up at the lanterns.

@1 stands at the edge of a rooftop in the rain, her back to us.
@1 slowly turns her head toward us.
```

That is two shots in two places. `@1` is Picture 1. With one person you can
write `She` or `He` instead.

The node also fills in two things H3 misses by itself. A moment gets its own
sound when it names something that makes one, like rain, footsteps or thunder.
And what changes stays changed: when the lights go out, the next moments in that
place say they are still out.

## The words box and the bar

The words the node acts on light up as you type: `@1` in teal (amber when
nothing is plugged in there), a time like `3s:` in amber, words in quotes in
yellow, and a blank line shows as a line marked CUT. Hover the `?` beside
"What happens" for a short list of everything you can type.

Typing `@` lists the pictures you plugged in, with their job. The first letters
of a line offer `sound:`, `music:`, `camera:` or `look:`, and after `camera:` or
`look:` you get the node's own choices. Tab picks one, Esc closes the list.

The bar under the box is the clip from start to end, one block for each moment
with the pictures it names:

- **Drag a block** along the bar to move its line. The times and cuts stay
  where they are.
- **Drag the left edge** of a block to set when that moment starts. The node
  types the time (`3s:`) into its line for you.
- **Click the left edge** to add or take out a cut there.
- **Click a block** to pick out its line in the words, ready to change.

Everything on the bar changes the words, so Ctrl+Z undoes it.

## Give each picture a job

Pick a job for each picture under the words, then name it in your lines with
`@1`, `@2`, `@3` or `@4`.

- **person**: this person goes wherever your lines say. Name the place in the
  line, or name none and they stay where the picture shows. Use a clear photo.
- **character sheet**: one character drawn from several sides. Only the
  character is used, not the panels.
- **place**: where it happens. Use a picture with nobody in it.
- **outfit**: clothes for your person. Works best with no head in the picture.
- **thing**: an object or a product. Works best with nobody in the picture.
- **style**: only the look is used, for the whole clip.
- **start on it**: the clip starts from this picture and stays in its place.
- **end on it**: the clip lands on this picture. It can't be named in a line.

Some scripts, with the jobs they need:

```
@1 sits at the counter in @2.                     Picture 2 is a place
@1 and @2 sit side by side on a night bus.        Picture 2 is a person
@1 walks down a runway wearing @2.                Picture 2 is an outfit
@1 spins slowly on a black glass table.           Picture 1 is a thing
```

A picture that is off simply isn't counted. If a line still names it, the node
stops and tells you which one. It needs at least one picture or a video to start
from.

## Use a video

Connect a video, then pick what it is for:

- **copy its moves**: your person does the moves in the video. It needs a
  picture of your person. Say where in your lines:
  `@1 dances on a rooftop at sunset.` The clothes can come from words or from an
  outfit picture.
- **swap the person**: your person takes over from the one in the video. The
  place, the moves and the camera stay. With two person pictures, the first
  replaces the person on the left and the second replaces the person on the
  right. To choose who goes, type one line per picture, for example
  `@1 replaces the man in the hat`. Put spoken words in quotes and name
  the speaker. If a voice comes from off screen, say so in the line.
- **keep going**: more of the same clip, from where it ends. Say what happens
  next, or leave the box empty and it just carries on. Connect the whole clip:
  the node sends H3 only the last 2 seconds.
- **new voice**: the same clip with a new voice. Connect the voice, and type
  what they say in quotes.

Swap and new voice ignore **Length** and keep the video's own length.

## What you can type

- **A time**: start a line with `3s:` and it happens at 3 seconds.
- **A cut in the same place**: start the line with a kind of shot, like
  `a close-up of her hand`. Any other line after a blank line goes to a new
  place.
- **One long take**: type `no cuts` and blank lines stop being cuts.
- **An ending**: start a line with `ends on`, wherever it sits:
  `ends on her sitting by the window`.
- **Speech**: put the words in quotes: `@1 says "we are late."` Each person
  keeps their own voice.
- **Words on a sign**: name the sign: `a neon sign reads "OPEN"`.
- **Sound and music**: use the **Sound** and **Music** boxes, or type
  `sound: rain on a tin roof` and `music: slow sad piano`. With no music you get
  none, and the clip comes out quieter.
- **Camera and look**: pick them on the node, or type your own:
  `camera: slow push in`, `look: a 1970s film`.

A `camera:` or `sound:` line inside a group of lines belongs to that shot. On its
own, with blank lines around it, it is for the whole clip.

Already wrote H3's six parts yourself? Paste them in and they go through as
they are.

## What you can plug in

- **picture_1** to **picture_4**: your pictures.
- **video** and **video_sound**: the frames and the sound of a video. Only keep
  going uses the sound.
- **voice**: a clip of someone talking, about 10 seconds, plus words in quotes
  in your script. It goes to whoever speaks first. It works with your own voice,
  or one you have permission to use. Put the spoken line last: with time left
  after it, H3 tends to keep talking.
- **song**: your music. It is cut to the length of the clip and plays as it is,
  and each moment moves onto its beat.
- **clip**: a small text model such as Qwen3-VL 8B. Type one line and it adds
  what happens next, and it names the sound of the place. Your line always stays
  first.

A voice and a song work together. H3 can't keep a song while someone speaks, so
the node keeps the song out of H3's way and hands it on as **song_under**, turned
down, to mix under the finished clip.

Then wire the node's outputs into H3: **prompt** into its prompt, **frames** into
its length, each **picture** into its next `ref_image`, **video** into `ref_video`,
**video_sound** into `ref_video_audio`, **voice** into its first `ref_audio`,
**song** into the next one. The pictures come out in the order the prompt counts
them, so a picture that is off leaves no gap. **width** and **height** go into
H3's width and height: the clip takes the shape of your video, or else of your
first picture. **song_under** goes into `audio2` of Audio Merge, with the clip's
sound in `audio1`.

Nothing plugged in means nothing is added. So a page can turn each one on and off
with [Workflow Switches](#AUSBOSS_NODES_WorkflowSwitches): a bypassed loader reads
as not plugged in.

## The controls

- **Sound** (`sound`): what the clip sounds like, for the whole clip. Same as a
  `sound:` line.
- **Music** (`music`): the music for the whole clip. Same as a `music:` line.
- **Length** (`seconds`): how long the clip is, 5 to 15.
- **Camera** (`camera`): how the camera moves the whole way through.
- **Look** (`look`): from the picture keeps your photo's look. The others redraw
  the clip. Clay and 3D don't work from words, so change your picture first with
  an edit model.
- **Picture 1** to **Picture 4** (`job_1` to `job_4`): what each picture is
  for, on the picture chips under the bar. An empty slot shows as a faint `+ @3`.
- **Video** (`video_job`): what the video is for, on the video chip.
- **Song starts at** (`song_start`, under **More**): the second of the song to
  start from, so the clip gets the good part.
- **Moments on the beat** (`cut_on_beat`, under **More**): moves each moment onto
  the nearest beat of the song. Off keeps your own seconds.
- **Language** (`language`, under **More**): the language of the words in quotes.

## Tips

- About one moment a second is the most H3 can play. The line under the rows
  warns you, and it warns you when a spoken line won't fit its moment.
- Say which way they face, and think about where they end up. If someone walks
  away from us, we see their back until a line turns them.
- H3 draws each shot on its own. A cut to a new place hides that. A cut inside one
  place shows every gap, so keep a place in one shot and move the camera instead.
- Nothing moves or exists unless a line says so. If the birds should fly, say so
  in that shot.
- Say what you would see, not what someone feels. `She smiles` works.
  `She feels happy` doesn't.
- A clip came out wrong? Run again with a new seed.

## Slots

| Slot | Direction | Type | Purpose |
| --- | --- | --- | --- |
| `script` | input | STRING | What happens, one line for each moment. |
| `seconds` | input | INT | How long the clip is. |
| `clip` | input, optional | CLIP | A small text model that fills in a one-line idea. |
| `picture_1` to `picture_4` | input, optional | IMAGE | Your pictures. |
| `video` | input, optional | IMAGE | The frames of a video. |
| `video_sound` | input, optional | AUDIO | The video's own sound. |
| `voice` | input, optional | AUDIO | A clip of the voice to use. |
| `song` | input, optional | AUDIO | The music to use. |
| `prompt` | output | STRING | The finished prompt. |
| `picture_1` to `picture_4` | output | IMAGE | Your pictures, in the order the prompt counts them. |
| `video` | output | IMAGE | The video, or only its end to keep going from. |
| `video_sound` | output | AUDIO | The video's sound, when it should reach H3. |
| `voice` | output | AUDIO | The voice, 15 seconds at most. |
| `song` | output | AUDIO | The song, cut to the clip. Empty when a voice is connected too. |
| `song_under` | output | AUDIO | With a voice and a song, the song to mix under the finished clip. |
| `frames` | output | INT | The clip's length in frames. |
| `width`, `height` | output | INT | The shape of your video, or else of your first picture. |

## Technical details

Code does the reading, so nothing typed can be lost or moved. It follows Pika's
and MiniMax's published prompt guides: every picture is defined once, each one
states what is kept and how, and a person who changes clothes or moves to a new
place is marked that way.

A timed shot mark makes H3 jump, whatever the words around it say: in tests 31 of
36 one-take clips jumped within half a second of a mark. So a mark is written only
for a real cut, and the moments of one take are sentences inside one shot. Clips
written that way had no jumps in 4 of 4 tries.

The prompt always tells H3 not to keep the background of a person's picture. With
a place in your lines the clip stayed there to the end on 2 of 2 tries; without
that sentence the picture's street came back halfway through on 2 of 2. With no
place in your lines H3 has nothing else to use, so it stayed in the picture's
place on 2 of 2.

H3's own rewriter runs only on paid services, and the open model reads a prompt as
it is. This node does that job on your machine, with no model needed.
