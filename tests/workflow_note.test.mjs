import assert from "node:assert/strict";
import test from "node:test";
import {
  MODEL_COLUMNS,
  baseName,
  emptyNote,
  folderPath,
  groupModels,
  hostLabel,
  matchInstalled,
  noteIsEmpty,
  normalizeNote,
  packsFromGraph,
  parseInline,
  parseMarkdown,
  rowFromCells,
  safeUrl,
  serializeNote,
} from "../js/shared/workflow_note.mjs";

test("normalizeNote accepts the widget string, an object, or garbage", () => {
  assert.deepEqual(normalizeNote(""), emptyNote());
  assert.deepEqual(normalizeNote("not json"), emptyNote());
  assert.deepEqual(normalizeNote(null), emptyNote());
  assert.deepEqual(normalizeNote([1, 2]), emptyNote());
  const note = normalizeNote({ title: "  Krea 2 Outpaint ", layout: "banner", accent: "#00B4AA" });
  assert.equal(note.title, "Krea 2 Outpaint");
  assert.equal(note.layout, "banner");
  assert.equal(note.accent, "#00b4aa");
});

test("rows drop empties, coerce types, and keep only http(s) urls", () => {
  const note = normalizeNote({
    models: [
      { name: "a.safetensors", dir: "/loras/", url: "javascript:alert(1)", size: 12 },
      { name: "", url: "https://x" },
      "nonsense",
      { name: "b.safetensors", dir: "vae", url: "https://huggingface.co/x/b.safetensors" },
    ],
    packs: [{ name: "ComfyUI-AusBoss", url: "http://github.com/a", node: "AUSBOSS_NODES_Seed" }, { url: "https://x" }],
    links: [{ label: "", url: "https://civitai.com/user/AusBoss" }, { label: "", url: "ftp://nope" }],
    layout: "weird",
    accent: "red",
  });
  assert.deepEqual(note.models, [
    { name: "a.safetensors", dir: "loras", url: "", size: "12", note: "" },
    { name: "b.safetensors", dir: "vae", url: "https://huggingface.co/x/b.safetensors", size: "", note: "" },
  ]);
  assert.deepEqual(note.packs, [{ name: "ComfyUI-AusBoss", url: "http://github.com/a", node: "AUSBOSS_NODES_Seed" }]);
  assert.deepEqual(note.links, [{ label: "civitai.com", url: "https://civitai.com/user/AusBoss" }]);
  assert.equal(note.layout, "card");
  assert.equal(note.accent, "");
});

test("serializeNote round-trips through normalizeNote", () => {
  const note = normalizeNote({ title: "T", body: "b", models: [{ name: "m", dir: "vae" }] });
  assert.deepEqual(normalizeNote(serializeNote(note)), note);
});

test("the editor's model table has a column for every field a model row keeps", () => {
  // A field with no column is lost the first time someone saves the form.
  const kept = Object.keys(normalizeNote({ models: [{ name: "m" }] }).models[0]);
  assert.deepEqual(MODEL_COLUMNS.map((column) => column.key).sort(), kept.sort());
});

test("saving the editor's model table unchanged keeps every note", () => {
  // Model rows from the LTX 2.3 Video Outpaint example, one without a note.
  const note = normalizeNote({
    title: "LTX 2.3 Video Outpaint",
    models: [
      { name: "ltx-2.3_text_projection_bf16.safetensors", dir: "text_encoders", size: "2.2 GB",
        url: "https://huggingface.co/Kijai/LTX2.3_comfy/resolve/main/text_encoders/ltx-2.3_text_projection_bf16.safetensors",
        note: "second slot of the text encoder loader" },
      { name: "LTX23_video_vae_bf16.safetensors", dir: "vae", size: "1.4 GB" },
      { name: "ltx-2.3-22b-ic-lora-outpaint.safetensors", dir: "loras",
        note: "outpaint IC-LoRA by oumoumad, fills pure-black bars" },
    ],
  });
  // What the form does: one cell per column, read back on Save.
  const cells = note.models.map((row) => MODEL_COLUMNS.map((column) => row[column.key]));
  const saved = normalizeNote({ ...note, models: cells.map((values) => rowFromCells(MODEL_COLUMNS, values)) });
  assert.deepEqual(saved, note);
  assert.deepEqual(saved.models.map((row) => row.note), [
    "second slot of the text encoder loader", "", "outpaint IC-LoRA by oumoumad, fills pure-black bars",
  ]);
});

test("rowFromCells names each cell by its column and fills missing cells", () => {
  const columns = [{ key: "label" }, { key: "url" }];
  assert.deepEqual(rowFromCells(columns, ["GitHub", "https://github.com/ausboss"]), { label: "GitHub", url: "https://github.com/ausboss" });
  assert.deepEqual(rowFromCells(columns, ["GitHub"]), { label: "GitHub", url: "" });
  assert.deepEqual(rowFromCells(columns, undefined), { label: "", url: "" });
});

test("noteIsEmpty is true only for a card with nothing on it", () => {
  assert.equal(noteIsEmpty(emptyNote()), true);
  assert.equal(noteIsEmpty(normalizeNote({ body: "   \n" })), true);
  assert.equal(noteIsEmpty(normalizeNote({ links: [{ url: "https://a.b" }] })), false);
});

test("safeUrl, hostLabel and baseName", () => {
  assert.equal(safeUrl(" https://huggingface.co/a/b "), "https://huggingface.co/a/b");
  assert.equal(safeUrl("data:text/html,hi"), "");
  assert.equal(safeUrl("https://a b"), "");
  assert.equal(hostLabel("https://www.youtube.com/@ausboss"), "youtube.com");
  assert.equal(hostLabel("nope"), "");
  assert.equal(baseName("Krea 2\\krea2_turbo_fp8.safetensors"), "krea2_turbo_fp8.safetensors");
  assert.equal(baseName("plain.png"), "plain.png");
});

test("folderPath and groupModels read like the install tree", () => {
  assert.equal(folderPath("loras"), "ComfyUI/models/loras");
  assert.equal(folderPath("input"), "ComfyUI/input");
  assert.equal(folderPath(""), "ComfyUI/models");
  const groups = groupModels([
    { name: "a", dir: "vae" }, { name: "b", dir: "loras" }, { name: "c", dir: "vae" },
  ]);
  assert.deepEqual(groups.map((g) => [g.dir, g.rows.map((r) => r.name)]), [["vae", ["a", "c"]], ["loras", ["b"]]]);
});

test("matchInstalled finds exact paths first, then basenames in any subfolder", () => {
  const files = ["Krea 2/krea2_turbo_fp8.safetensors", "other/thing.safetensors", "top.safetensors"];
  assert.deepEqual(matchInstalled("krea2_turbo_fp8.safetensors", files), { found: true, path: "Krea 2/krea2_turbo_fp8.safetensors" });
  assert.deepEqual(matchInstalled("TOP.safetensors", files), { found: true, path: "top.safetensors" });
  assert.deepEqual(matchInstalled("other\\thing.safetensors", files), { found: true, path: "other/thing.safetensors" });
  assert.deepEqual(matchInstalled("missing.safetensors", files), { found: false, path: null });
  assert.deepEqual(matchInstalled("x", null), { found: false, path: null });
});

test("packsFromGraph lists each custom pack once and skips core modules", () => {
  const moduleOf = (type) => ({
    KSampler: "nodes",
    ImageBlend: "comfy_extras.nodes_post_processing",
    AUSBOSS_NODES_Seed: "custom_nodes.ComfyUI-AusBoss",
    AUSBOSS_NODES_LoraLoader: "custom_nodes.ComfyUI-AusBoss",
    "Power Lora Loader (rgthree)": "custom_nodes.rgthree-comfy",
    Unknown: undefined,
  })[type];
  assert.deepEqual(
    packsFromGraph(["KSampler", "AUSBOSS_NODES_Seed", "ImageBlend", "AUSBOSS_NODES_LoraLoader", "Power Lora Loader (rgthree)", "Unknown"], moduleOf),
    [
      { name: "ComfyUI-AusBoss", url: "", node: "AUSBOSS_NODES_Seed" },
      { name: "rgthree-comfy", url: "", node: "Power Lora Loader (rgthree)" },
    ],
  );
});

test("parseInline handles bold, italic, code and safe links", () => {
  assert.deepEqual(parseInline("a **b** *c* `d` [e](https://f.g) [h](javascript:x) i"), [
    { type: "text", text: "a " },
    { type: "strong", text: "b" },
    { type: "text", text: " " },
    { type: "em", text: "c" },
    { type: "text", text: " " },
    { type: "code", text: "d" },
    { type: "text", text: " " },
    { type: "link", text: "e", url: "https://f.g" },
    { type: "text", text: " " },
    { type: "text", text: "h" },
    { type: "text", text: " i" },
  ]);
  // A lone asterisk or one inside a word is just text.
  assert.deepEqual(parseInline("2 * 3 and snake_case*x"), [{ type: "text", text: "2 * 3 and snake_case*x" }]);
});

test("parseMarkdown yields headings, paragraphs with soft breaks, lists, rules and code", () => {
  const blocks = parseMarkdown("# Title\n\nline one\nline two\n\n- a\n- **b**\n  more\n1. one\n2. two\n\n---\n```\nx = 1\n```\n");
  assert.deepEqual(blocks.map((b) => b.type), ["heading", "paragraph", "list", "list", "hr", "code"]);
  assert.equal(blocks[0].level, 1);
  assert.deepEqual(blocks[1].spans, [
    { type: "text", text: "line one" }, { type: "br" }, { type: "text", text: "line two" },
  ]);
  assert.equal(blocks[2].ordered, false);
  assert.deepEqual(blocks[2].items[1], [{ type: "strong", text: "b" }, { type: "br" }, { type: "text", text: "more" }]);
  assert.equal(blocks[3].ordered, true);
  assert.equal(blocks[5].text, "x = 1");
});

test("parseMarkdown on empty or plain text is a single paragraph or nothing", () => {
  assert.deepEqual(parseMarkdown(""), []);
  assert.deepEqual(parseMarkdown("just words"), [{ type: "paragraph", spans: [{ type: "text", text: "just words" }] }]);
});
