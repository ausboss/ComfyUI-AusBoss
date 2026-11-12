# Prompt Variations

A prompt box that changes on every run. Write choices in curly brackets and
the node picks one from each set:

```text
A woman in a {plain|striped|patterned} {tank top|sweater|button-up shirt}
and {jeans|a pleated skirt|cargo shorts}, {standing|sitting on a stool|leaning on the wall}.
```

One run might give "A woman in a striped sweater and jeans, sitting on a
stool." The next gives another mix.

Use it to make many different pictures in one go. Wire in the seed, set the
Seed node to **randomize**, and set the number of runs next to the Run
button to 50. Each run gets a new seed, so each picture gets new choices.

## Controls

- The text box (`text`): your prompt. Put each set of choices in curly
  brackets and split the choices with `|`. Write as many sets as you like,
  each with as many choices as you like.
- `seed` (a socket): the seed your sampler uses. A new seed picks new
  choices. The same seed picks the same ones again, so a picture you like
  can be made again from its seed.

## Output

- **prompt**: your text with one choice picked from each set. Wire it to
  Show Text to see what was picked.

## Tips

- An empty choice lets a part come and go: `a {|striped} shirt` gives "a
  shirt" or "a striped shirt".
- Sets can go inside sets: `{a {red|blue} hat|a scarf}`.
- Text without curly brackets comes out exactly as typed.
- To make one choice come up more often, write it more than once:
  `{jeans|jeans|skirt}`.

## Technical details

Only brackets that hold a `|` are choices. Brackets without one are left as
they are, so a JSON prompt such as `{"light": "soft"}` passes through
unchanged. A `|` inside JSON brackets still counts as a choice.

The innermost sets are picked first, from left to right, with Python's
`random.Random(seed)`. The same text and seed always give the same prompt,
on any machine. Spaces around each choice are trimmed, and an empty pick
also drops the one space in front of it.

The picks happen when the prompt runs, on the server, not in the browser.
ComfyUI's own `{a|b}` choices in some text boxes are picked by the browser
when you queue, with no seed; this node does not use them.
