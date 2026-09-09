# Run Timer

A stopwatch for the whole run, drawn as one black readout with no title bar
and no wires: it listens to the queue.

- The clock starts when a queued prompt begins executing and ticks while it
  runs — amber dot.
- When the run finishes the total holds — teal dot. A failed or interrupted
  run shows its time in red and is not kept as a reference.
- The last completed run is saved with the workflow, so a shared graph
  reopens showing its author's time; hover the box for the few before it.
  Right-click → *Reset Run Timer history* clears them.

The node is exactly the box, painted by the node itself on the classic
canvas: drag it from anywhere, resize it by the corner (the digits scale
with it), and it wears no title bar and no pack badge. Right-click lists the
last runs.

## Notes and limitations

- It measures the *queue's* execution, from `execution_start` to the run's
  end, on the browser's clock. Model loading counts; time spent waiting in
  the queue behind another prompt does not.
- Several Run Timer nodes on one canvas all show the same run.
- Per-node times are a separate feature: **Settings → 🆎 AusBoss → Chrome →
  Node runtime badges** stamps every node with its own seconds.
- Want a sound when it stops? **Settings → 🆎 AusBoss → Notifications →
  Completion sound** chimes when the queue empties.
