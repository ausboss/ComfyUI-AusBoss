// Stitch Inpaint's Seam choice as its widget card shows it: the data and
// decisions only (tests/stitch_seam.test.mjs); js/widget_cards/index.js
// builds the DOM.
//
// Seam has no row on the card. A gear in the card's top-right corner opens a
// menu that sets it, a "blend in" chip beside the gear shows it at a glance,
// and blend in mutes the two rows only the classic seam reads: they stay in
// place, dimmed, so the node keeps its height in either mode.

// The backend's choices, in its order; the first is the default.
export const SEAM_CHOICES = ["classic", "blend in"];

// The gear menu (js/shared/settings_menu.mjs). persist: false - the choice
// belongs to this node and is never a default for new ones.
export const SEAM_MENU = [
  {
    key: "seam",
    label: "Seam",
    type: "choice",
    options: SEAM_CHOICES,
    default: SEAM_CHOICES[0],
    persist: false,
    hint: "How the new area joins your picture. Stored on this node.",
    optionHints: {
      classic: "the feathered paste older workflows use, with Tone match.",
      "blend in": "for turned pictures, and outpaints with Tone match off.",
    },
  },
];

export function isBlendIn(values) {
  return values?.seam === "blend in";
}

// Hover hints on the rows blend in does not read.
export const SEAM_MUTE_TITLES = {
  color_match: "Blend in doesn't use Tone match. Switch Seam back to classic in the gear menu to use it.",
  fix_edge_halo: "Blend in doesn't use Fix edge halo. Switch Seam back to classic in the gear menu to use it.",
};

// Room the corner tools take from every row's control, so the controls keep
// one right edge: the gear alone, or the gear with the chip and its note.
export function seamCornerReserve(values) {
  return isBlendIn(values) ? 84 : 30;
}
