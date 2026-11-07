// Seed 🆎's two looks, picked from the gear on its card: the full card
// (the default), or "compact", one short row with the number, a mode chip
// and a new-seed button. The look is kept in the node's properties, so the
// node's inputs, saved values and the prompt it sends are the same in both,
// and the last look picked is what new Seed nodes start with.
//
// Data and decisions only (tests/seed_look.test.mjs); js/seed/index.js
// draws the card.

export const SEED_LOOK_PROPERTY = "ausboss_seed_look";
export const SEED_LOOKS = ["full", "compact"];
export const SEED_LOOK_SCOPE = "seed_look";

export function seedLook(node) {
  return node?.properties?.[SEED_LOOK_PROPERTY] === "compact" ? "compact" : "full";
}

// The full card leaves no property behind, so a node set back to it is
// saved exactly as one that was never changed.
export function setSeedLook(node, look) {
  if (!node) return "full";
  node.properties ??= {};
  if (look === "compact") node.properties[SEED_LOOK_PROPERTY] = "compact";
  else delete node.properties[SEED_LOOK_PROPERTY];
  return seedLook(node);
}

// The gear menu (js/shared/settings_menu.mjs). The pick is also kept as the
// look new Seed nodes start with.
export const SEED_LOOK_MENU = [
  {
    key: "look",
    label: "Look",
    type: "choice",
    options: SEED_LOOKS,
    default: "full",
    hint: "How this Seed node looks. New Seed nodes start the same way.",
    optionHints: {
      full: "the whole card: mode buttons, New seed, Use last run, and the seeds it ran with.",
      compact: "one short row: the number, a mode chip you tap to change, and a dice for a new seed.",
    },
  },
];

// The compact row's chip: tap to go Random -> Fixed -> Step +1 -> Step -1
// -> Random. Values are the frontend's control_after_generate choices.
const CYCLE = ["randomize", "fixed", "increment", "decrement"];

export function nextControl(control) {
  const index = CYCLE.indexOf(control);
  return CYCLE[(index + 1) % CYCLE.length] ?? "fixed";
}

export function controlChip(control) {
  switch (control) {
    case "randomize": return { text: "Random", title: "Rolls a new seed after each run. Tap for Fixed." };
    case "increment": return { text: "+1", title: "Adds 1 after each run. Tap for -1." };
    case "decrement": return { text: "−1", title: "Takes 1 off after each run. Tap for Random." };
    default: return { text: "Fixed", title: "Keeps this seed for every run. Tap for +1." };
  }
}
