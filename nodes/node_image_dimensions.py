"""Image Dimensions (AusBoss) — reads width/height/batch off an IMAGE."""


class AusBossImageDimensions:
    DESCRIPTION = (
        "Reads the size of whatever IMAGE is wired in and outputs width, "
        "height, and batch size as INTs, plus a one-line summary string. "
        "Wire the INTs into resize or empty-latent nodes, or the summary "
        "into a Show Text node while debugging a pipeline."
    )
    CATEGORY = "🧰 AusBoss/🖼️ Image"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {"tooltip": "Any IMAGE output."}),
            }
        }

    RETURN_TYPES = ("INT", "INT", "INT", "STRING")
    RETURN_NAMES = ("width", "height", "batch_size", "info")
    OUTPUT_TOOLTIPS = (
        "Image width in pixels.",
        "Image height in pixels.",
        "Number of images in the batch.",
        "One-line summary: WxH, channels, batch, megapixels.",
    )
    FUNCTION = "run"

    def run(self, image):
        # ComfyUI IMAGE tensors are batch-height-width-channels (BHWC).
        batch, height, width, channels = image.shape
        megapixels = (width * height) / 1_000_000
        info = (
            f"{width}x{height} | {channels}ch | "
            f"batch {batch} | {megapixels:.2f} MP"
        )
        return (int(width), int(height), int(batch), info)


NODE_CLASS_MAPPINGS = {"AusBossImageDimensions": AusBossImageDimensions}
NODE_DISPLAY_NAME_MAPPINGS = {"AusBossImageDimensions": "Image Dimensions (AusBoss)"}
