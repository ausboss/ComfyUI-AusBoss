// The Text node's two looks, chosen per node from the gear on its card: the
// usual text box (the default), or "big", a word or two in large centred
// letters that are easy to spot, for a label typed over a picture.
//
// The choice is kept in the node's properties, so it is saved with the
// workflow and nothing else changes: the node's inputs, its saved widget
// values and the prompt it sends are the same in both looks, and a pack that
// does not know the property shows the usual box.
//
// The data and decisions only (tests/text_look.test.mjs); the card
// (js/shared/widget_card.mjs) draws the look and js/widget_cards/index.js
// puts the gear on the Text node's card.

export const TEXT_LOOK_PROPERTY = "ausboss_text_look";
export const TEXT_LOOKS = ["normal", "big"];

// The node's look: "big" only when the node says so, else "normal".
export function textLook(node) {
  return node?.properties?.[TEXT_LOOK_PROPERTY] === "big" ? "big" : "normal";
}

// Keep a look on the node. The usual box leaves no property behind, so a
// node set back to it is saved exactly as one that was never changed.
export function setTextLook(node, look) {
  if (!node) return "normal";
  node.properties ??= {};
  if (look === "big") node.properties[TEXT_LOOK_PROPERTY] = "big";
  else delete node.properties[TEXT_LOOK_PROPERTY];
  return textLook(node);
}

// The gear menu (js/shared/settings_menu.mjs). persist: false - the look
// belongs to this node and is never a default for new ones.
export const TEXT_LOOK_MENU = [
  {
    key: "look",
    label: "Look",
    type: "choice",
    options: TEXT_LOOKS,
    default: "normal",
    persist: false,
    hint: "How this box shows its text. Stored on this node.",
    optionHints: {
      normal: "the usual text box, for prompts and longer text.",
      big: "large centred letters, for a word or two you want to see at a glance.",
    },
  },
];

// Room the gear takes from the card's control column. The usual box keeps
// the gear beside it; the big field spans the card and the gear sits in its
// top corner instead.
export function textLookCornerReserve(look) {
  return look === "big" ? 0 : 30;
}
