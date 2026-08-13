// Shared helpers for AusBoss frontend extensions.
//
// .mjs files under js/ are NOT auto-loaded by ComfyUI (only .js files are),
// which makes this the right home for import-only utilities. Per-node
// entry points live in js/<node>/index.js and import from here.

export const BRAND = "#00b4aa"; // AusBoss teal — keep node accents consistent.
export const BRAND_DARK = "#007f78";
export const BRAND_BODY = "#081413";

// Wrap a LiteGraph prototype callback without clobbering whoever hooked it
// first. Other node packs patch the same prototypes, so never assign
// `proto[name] = fn` directly — always chain.
export function chainCallback(proto, name, fn) {
  const prior = proto[name];
  proto[name] = function (...args) {
    const result = prior?.apply(this, args);
    fn.apply(this, args);
    return result;
  };
}
