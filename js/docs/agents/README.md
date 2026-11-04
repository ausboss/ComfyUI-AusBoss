# AusBoss nodes: a workflow guide

Find the job in the table below, then read that node's help page before
wiring it. Each help page is `js/docs/<node id>.md` in this pack. ComfyUI
shows the same page in its node help panel. This guide ships with the pack.

## Which node for which job

| The job | Node (id) |
|---|---|
| Pick a picture size by shape and megapixels, in place of Empty Latent | Latent Size (`AUSBOSS_NODES_Resolution`) |
| Resize a picture, or snap its size to a multiple | Image Resize (`AUSBOSS_NODES_ImageResize`), Align Image (`AUSBOSS_NODES_AlignImage`) |
| Read a picture's width and height | Image Size (`AUSBOSS_NODES_ImageSize`) |
| Outpaint: load a picture and add empty space around it | Load Image + Pad (`AUSBOSS_NODES_LoadImagePad`) |
| Turn, crop and pad a picture in one node | Image Crop + Rotate + Pad (`AUSBOSS_NODES_ImageCropRotatePad`) |
| Inpaint only the masked part, then put it back | Crop For Inpaint (`AUSBOSS_NODES_CropForInpaint`) then Stitch Inpaint (`AUSBOSS_NODES_StitchInpaint`) |
| Remove a watermark or an object with no prompt | LaMa Inpaint (`AUSBOSS_NODES_LaMaInpaint`) |
| Get a mask by typing what to find | Mask by Name (`AUSBOSS_NODES_MaskByName`) |
| Get a mask by clicking the thing | Mask by Touch (`AUSBOSS_NODES_MaskByTouch`) |
| Grow, shrink, fill or smooth a mask | Mask Refine (`AUSBOSS_NODES_RefineMask`) |
| Line an edited picture back up with the original | Realign to Source (`AUSBOSS_NODES_RealignToSource`, experimental) |
| Match one picture's colors to another | Color Match (`AUSBOSS_NODES_ColorMatch`) |
| Upscale big pictures in tiles | Tiled Upscale (`AUSBOSS_NODES_TiledUpscale`) then Tiled Upscale Stitch (`AUSBOSS_NODES_TiledUpscaleStitch`) |
| Compare two pictures | Image Compare A/B (`AUSBOSS_NODES_Compare`) |
| Save pictures (PNG, lossless WebP or JPEG XL) | Save Image (`AUSBOSS_NODES_SaveImage`) |
| Run a workflow on each picture in a folder | Image Folder (`AUSBOSS_NODES_ImageFolder`) |
| Apply a stack of LoRAs | LoRA Loader (`AUSBOSS_NODES_LoraLoader`) |
| Krea 2 prompt, and Krea 2 outpainting | Krea 2 Encode (`AUSBOSS_NODES_Krea2Encode`), Krea 2 Outpaint Model Patch (`AUSBOSS_NODES_Krea2OutpaintModelPatch`) |
| Load or save a video | Load Video (`AUSBOSS_NODES_LoadVideo`), Save Video (`AUSBOSS_NODES_SaveVideo`) |
| Turn, crop and pad a video: one frame, or the whole clip | Video Crop + Rotate + Pad → Frame (`AUSBOSS_NODES_VideoCropRotatePad`), → Clip (`AUSBOSS_NODES_VideoCropRotatePadClip`) |
| Change a clip's frame rate | Frame Interpolate (`AUSBOSS_NODES_FrameInterpolate`) |
| Work with frame batches | Select Frame (`AUSBOSS_NODES_SelectFrame`), Select Every Nth (`AUSBOSS_NODES_SelectEveryNth`), Split Batch (`AUSBOSS_NODES_SplitBatch`), Merge Batches (`AUSBOSS_NODES_MergeBatches`) |
| One shared seed, number or text | Seed (`AUSBOSS_NODES_Seed`), Integer (`AUSBOSS_NODES_Integer`), Float (`AUSBOSS_NODES_Float`), Text (`AUSBOSS_NODES_Text`) |
| Write a MiniMax H3 or Pika H3 Flex prompt from a script and references | H3 Prompt Writer (`AUSBOSS_NODES_H3PromptWriter`) |
| Do maths on numbers | Math Expression (`AUSBOSS_NODES_MathExpression`) |
| Show text on the node, or the picture while it is made | Show Text (`AUSBOSS_NODES_ShowText`), Step Preview (`AUSBOSS_NODES_StepPreview`) |
| Free graphics memory between steps | Free Memory (`AUSBOSS_NODES_FreeMemory`) |
| Time the whole run | Run Timer (`AUSBOSS_NODES_RunTimer`) |
| Turn parts of a workflow off and on | Workflow Switches (`AUSBOSS_NODES_WorkflowSwitches`): [workflow file guide](workflow_switches.md) |
| Explain a shared workflow on the canvas | Workflow Note (`AUSBOSS_NODES_WorkflowNote`), Callout (`AUSBOSS_NODES_Callout`) |
| Lay out boxes of things and words on a canvas | Layout Boxes (`AUSBOSS_NODES_LayoutBoxes`) |

Every node's display name ends in 🆎 and sits under `🆎 AusBoss/<group>` in
the node menu. In a workflow file and in the API, a node is named by its id,
the `AUSBOSS_NODES_...` key above.

## Before you edit a workflow

- **Read settings by name.** A saved workflow keeps each node's settings
  twice: by position in `widgets_values`, and by name in
  `widgets_values_named`. Read and write by name, and keep both copies in
  step.
- **Look at a node's inputs and outputs** in the running ComfyUI:
  `GET /object_info/<node id>` lists them with their types and defaults.
- **Inputs never get renamed or reordered** after a release, so a workflow
  that worked keeps working.
- **Media loaders start blank** in the example workflows. Put in the file the
  person wants to use before you queue.

## Example workflows

`example_workflows/` in this pack holds complete workflows, each with a
picture of what it makes. Each one starts with a Workflow Note that lists the
model files it needs and where they go. Start from the closest one rather
than building from nothing.

## When something goes wrong

- Read the node's help page again, including its "Technical details" or "Notes" part when it has one.
- Search the pack's GitHub issues: https://github.com/ausboss/ComfyUI-AusBoss/issues
- A new bug report should name the ComfyUI version, the pack version from
  the console banner, the node, and the smallest workflow that shows it.
