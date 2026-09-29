// After undo or redo in Nodes 2.0, every AusBoss node face shows its own
// node's panels again (the why is in shared/face_handover.mjs).
//
// The hooks go on each node as it is made. A rebuilt node's panels exist by
// the time it is configured (every panel is built in onNodeCreated), and the
// hand-over waits one microtask, so the frontend has rebuilt the whole graph
// before any panel moves.

import { app } from "/scripts/app.js";
import { chainCallback, isAusbossNode } from "../shared/index.mjs";
import { createFaceHandover } from "../shared/face_handover.mjs";

const handover = createFaceHandover();

app.registerExtension({
  name: "AusBoss.FaceHandover",
  nodeCreated(node) {
    if (!isAusbossNode(node)) return;
    chainCallback(node, "onRemoved", function () {
      handover.remember(this);
    });
    chainCallback(node, "onConfigure", function () {
      queueMicrotask(() => handover.handOver(this));
    });
  },
});
