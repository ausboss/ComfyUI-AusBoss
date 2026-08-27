# Text

A multiline text box on its own `STRING` wire. Type a prompt, a caption, or
any other text once and feed it to every node that needs it — changing it in
one place updates them all.

## Controls

- **text**: The text to output. Multiline; newlines and spacing are kept.

## Output

- **text**: Exactly what you typed, unchanged.

The node performs no processing at all: no trimming, no template expansion,
no substitutions. What you see in the box is what arrives downstream.
