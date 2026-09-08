import { registerTransformExtension } from "../shared/transform_editor.mjs";

// Same editor as the frame picker; the backend applies the transform to the
// whole start/end window, and the timeline only chooses the preview frame.
registerTransformExtension("AUSBOSS_NODES_VideoCropRotatePadClip", "video");
