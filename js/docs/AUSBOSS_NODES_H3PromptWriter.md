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

Your words go into the prompt as you typed them. To hear something at a
moment, say it in that line: `Thunder cracks overhead.` For a sound under the
whole clip, add a `sound:` line, such as `sound: rain on the windows`. When
something should stay the way it changed, say so in the later lines too:
`The lights are still off.`

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

- **copy its moves**: someone does the moves in the video. With a picture of
  your person, your person does them. Say where in your lines:
  `@1 dances on a rooftop at sunset.` With no person picture, the person in
  the video keeps their own moves and goes somewhere new: give a picture the
  job **place** and type `He dances in @1.` The clothes can come from words or
  from an outfit picture. It doesn't have to be a person: give a cartoon hand,
  a toy or a mascot the job **thing** and type `@1 waves.` It does the moves in
  its own look, and nothing of the video's subject is kept.
- **swap the person**: your person takes over from the one in the video. The
  place, the moves and the camera stay. With two person pictures, the first
  replaces the person on the left and the second replaces the person on the
  right. To choose who goes, type one line per picture, for example
  `@1 replaces the man in the hat`. Put spoken words in quotes and name
  the speaker. If a voice comes from off screen, say so in the line.
  A line like `@1 dances.` is not read as who goes; only a description such
  as `the man in the hat` is. With two people, name who speaks.
- **change something**: keep the video and describe the change, for example
  `She wears a red raincoat`. Be specific about what should change. To change
  the whole look, connect a picture with the job **style** (or **place**, for
  the same room looking different) and type `It looks like @1.` A clip with
  nobody in it, such as an empty hallway, stays empty.
- **keep going**: more of the same clip, from where it ends. Say what happens
  next, or leave the box empty and it just carries on. Connect the whole clip:
  the node sends H3 only the last 2 seconds.
- **new voice**: the same clip with a new voice. Connect the voice, and type
  what they say in quotes.
  This keeps the person in the clip, so a person picture is not allowed here;
  use **swap the person** to change who is in it.

If your swap keeps the video's audio, connect it to **video_sound** and turn on
**More → Clip's own sound**. The writer uses the clip to estimate when each
line is spoken and keeps only the incoming people's words in the swap prompt.
Type a time such as `3.2s:` to set it yourself. This switch starts off.

With an active video, **copy its moves**, **swap the person**, **change
something** and **new voice** use the incoming clip to set the frame count. **Length** says **From the clip**;
set the clip's length upstream. The bar does not show a guessed duration or offer
retiming controls for these jobs. H3 rounds the frame count to a supported length.
Other video jobs, or turning the video off, use the editable **Length** again.

For a swap, you can optionally describe the replacement on its own line:

```
the woman with black hair walking toward the camera
@1 looks like a woman with blonde hair and a black hoodie.
```

The first line chooses who goes; the `@1 looks like` line describes the connected
replacement person in Picture 1. Use the number of that picture, with its job set
to **person** or **character sheet**. This helps describe the intended appearance;
it does not guarantee an exact identity match. The line is optional: existing
workflows and scripts keep their previous behavior when it is absent.

## What you can type

- **A time**: start a line with `3s:` and it happens at 3 seconds.
- **A cut in the same place**: start the line with a kind of shot, like
  `a close-up of her hand`. Any other line after a blank line goes to a new
  place.
- **A cut back**: `Cut back to the hallway.` returns to a place you have
  already shown.
- **One long take**: type `no cuts` and blank lines stop being cuts.
- **An ending**: start a line with `ends on`, wherever it sits:
  `ends on her sitting by the window`.
- **Speech**: put the words in quotes: `She says "we are late."` With two or
  more people, your sentence goes to H3 as you typed it, so write it the way
  you would tell a person: `@1 listens as @2 says "we are late."`
- **Talking over a cut**: end the words with `...` and the line keeps going
  into the next shot, said once. On the last line, `...` means the clip ends
  mid-sentence.
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

## See and change the full prompt

The **Full prompt** tab at the top of the node shows the prompt the node wrote
on its last run. To change one thing, such as taking out "A slow push in.",
edit it there and run again: H3 gets your text exactly as it is in the box. An
amber dot on the tab shows that an edit is being sent. **Reset to written**
throws the edit away and goes back to what the **Simple** tab writes.

While an edit is in place, changes on the Simple tab do nothing, because your
text is sent instead.

## What you can plug in

- **picture_1** to **picture_4**: your pictures.
- **video** and **video_sound**: the frames and the sound of a video. **keep
  going** sends the last part of the sound to H3. A swap uses the sound to find
  speech timing when **Clip's own sound** is on. To keep source audio in a swap
  or **change something**, route the original loader's audio to the save node.
- **voice**: a clip of someone talking, about 10 seconds, plus words in quotes
  in your script. It goes to whoever speaks first. With two or more people,
  put the speaker right before the words: `@2 says "hello."` It works with your own voice,
  or one you have permission to use. Put the spoken line last: with time left
  after it, H3 tends to keep talking.
- **song**: your music. It is cut to the length of the clip and plays as it is,
  and each moment moves onto its beat.
- **clip**: a small text model such as Qwen3-VL 8B. Type one line and it adds
  what happens next, and it names the sound of the place. Your line always stays
  first. Turn on **More → Tidy up my lines** and it also cleans up what you
  typed before the node reads it (see the controls below).

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

**keeps_clip_sound** is on when a video is connected and **Clip's own sound** is
on, or the video job is **change something**. Use it to select the source audio
for the finished clip. It is the last output; the existing outputs keep their
positions. Keeping source audio still needs the workflow to pass that audio to
its save node.

Nothing plugged in means nothing is added. So a page can turn each one on and off
with [Workflow Switches](#AUSBOSS_NODES_WorkflowSwitches): a bypassed loader reads
as not plugged in.

## The controls

- **Sound** (`sound`): what the clip sounds like, for the whole clip. Same as a
  `sound:` line.
- **Music** (`music`): the music for the whole clip. Same as a `music:` line.
- **Length** (`seconds`): how long the clip is, 4 to 15.
- **Camera** (`camera`): how the camera moves the whole way through. The first
  choice adds no camera words. With a video wired it reads **from the video**:
  the camera does what it does in the video. Pick a move only to change it.
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
- **Tidy up my lines** (`tidy`, under **More**): the model on **clip** rewrites
  your lines first. It fixes spelling, breaks long lines into short sentences,
  and puts each spoken line right after whoever says it, so
  `@1 stares at @2 who goes "No way."` becomes `@1 stares at @2. @2 says "No way."`
  Your words in quotes never go to the model and come back exactly as typed. If
  its answer loses a line, says one twice or changes who is in it, your lines
  are used as typed. With nothing on **clip**, or on a ComfyUI older than
  0.46.1, it does nothing, so a workflow can leave it on. Starts off.
- **Full prompt** (`full_prompt`, on the Full prompt tab): your own edit of the
  finished prompt. Empty means the node's own prompt is sent.

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
| `clip` | input, optional | CLIP | A small text model that fills in a one-line idea, and tidies your lines when Tidy up is on. |
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
| `keeps_clip_sound` | output | BOOLEAN | Whether the finished clip should use the video's own sound. |

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

Tidy up sends the model one call with its own instructions, no picture, and no
randomness, so the same lines tidy the same way every run. Each quote is swapped
for a marker (`SPOKEN`, or `SPOKEN1`, `SPOKEN2`), and the answer is used only when
every marker comes back once, the same `@` numbers are in it, and it is not much
longer than what you typed. On Qwen3-VL 8B the instructions put the right speaker
before the words on 38 of 38 lines they were not written for, took about 0.3
seconds a call once the model was loaded, and passed every check on 77 of 79
lines. What it still changes: "as" and "while" can become two sentences, and a
leading `Voiceover:` label is left as typed.

The Full prompt tab is filled from the node's run, so it shows nothing until
the workflow has run once. The node still writes its own prompt on every run, a
model on `clip` included, so the tab can show it next to your edit and Reset can
go back to it. The last written prompt is kept with the node in a saved
workflow.

H3's own rewriter runs only on paid services, and the open model reads a prompt as
it is. This node does that job on your machine, with no model needed.
