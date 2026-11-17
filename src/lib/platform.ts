/** macOS gets a native menu bar (src-tauri/src/lib.rs) instead of in-window file buttons. */
export const IS_MAC = navigator.userAgent.includes("Mac");
/** Modifier prefix for shortcut hints in tooltips. */
export const MOD = IS_MAC ? "⌘" : "Ctrl+";
export const SHIFT = IS_MAC ? "⇧" : "Shift+";
export const ALT = IS_MAC ? "⌥" : "Alt+";
