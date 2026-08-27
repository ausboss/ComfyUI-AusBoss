// Which Save Video 🆎 widgets mean anything for each format. Pure data and
// one decision function — no DOM, no ComfyUI imports — so node:test drives
// it directly and the entry file stays thin.
//
// The names mirror the keys of VIDEO_FORMATS in nodes/_video_save_helpers.py
// (tests/test_video_save_helpers.py checks the two lists agree). What each
// widget means per format is decided there too: crf drives the constant-
// quality dial of the software and NVENC encoders and maps onto webp's
// quality scale, while prores rides its own profile ladder, ffv1 is lossless
// by definition, and Pillow's gif path quantizes per frame with no quality
// dial at all. gif and webp are written frame by frame through Pillow and
// never carry the workflow metadata the video containers embed.
export const FORMAT_WIDGET_SETS = {
  "mp4 h264": ["crf", "save_metadata"],
  "mp4 h265": ["crf", "save_metadata"],
  "mp4 h264 nvenc": ["crf", "save_metadata"],
  "mp4 h265 nvenc": ["crf", "save_metadata"],
  "webm vp9": ["crf", "save_metadata"],
  "webm av1": ["crf", "save_metadata"],
  "mov prores": ["save_metadata"],
  "mkv ffv1": ["save_metadata"],
  "gif": [],
  "webp": ["crf"],
};

// The only widgets the format ever toggles. Everything else on the node —
// fps, filename_prefix, format itself, pingpong — applies to every format
// and is deliberately absent from the table above.
export const FORMAT_TOGGLED_WIDGETS = ["crf", "save_metadata"];

// Visibility per toggled widget for one format value. An unrecognized format
// (say, a newer backend's entry reaching older JavaScript) shows everything:
// an inert-but-visible widget is harmless, a hidden live one loses a control.
export function formatWidgetVisibility(format) {
  const relevant = FORMAT_WIDGET_SETS[format];
  const visibility = {};
  for (const name of FORMAT_TOGGLED_WIDGETS) {
    visibility[name] = relevant ? relevant.includes(name) : true;
  }
  return visibility;
}
