/**
 * Keyboard bindings (GDD §O). Keys bind on `e.code` so layouts (AZERTY, Dvorak) keep positions.
 * Pure: maps a key description to a high-level action; the input layer executes it.
 */

export interface KeyInput {
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  repeat?: boolean;
}

export type KeyAction =
  | { type: 'escape' }
  | { type: 'attackMove' }
  | { type: 'stop' }
  | { type: 'hold' }
  | { type: 'group'; n: number; op: 'recall' | 'assign' | 'add' }
  | { type: 'selectHearth' }
  /** `add` (Shift+`): toggle the Warden in the current selection instead of replacing it. */
  | { type: 'selectWarden'; add?: boolean }
  | { type: 'idleTiller' }
  | { type: 'allMilitary' }
  | { type: 'jumpAlert' }
  | { type: 'counterWheel' }
  | { type: 'pause' }
  | { type: 'speed'; dir: -1 | 1 }
  | { type: 'mute' }
  | { type: 'delete' }
  /** Context hotkey resolved against the command card (Q/W/E train, Z/X/C research, V, build letters, Warden Q/W). */
  | { type: 'card'; letter: string; shift: boolean };

/** Arrow-key pan directions (held keys, handled per frame). */
export const PAN_KEYS: Record<string, { dx: number; dy: number }> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
};

/** Codes whose browser default must always be suppressed during battle (§O). */
const ALWAYS_PREVENT = new Set(['Space', 'Tab', 'Backquote', 'F2', 'Backspace', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

export function digitOf(code: string): number | null {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  return m ? Number(m[1]) : null;
}

export function letterOf(code: string): string | null {
  const m = /^Key([A-Z])$/.exec(code);
  return m ? m[1] : null;
}

/** Global single-letter bindings that never go to the command card. */
const GLOBAL_LETTERS: Record<string, KeyAction> = {
  A: { type: 'attackMove' },
  S: { type: 'stop' },
  G: { type: 'hold' },
  H: { type: 'selectHearth' },
  M: { type: 'mute' },
};

export function resolveKey(k: KeyInput): KeyAction | null {
  const { code } = k;
  if (k.metaKey) return null; // leave Cmd shortcuts to the browser / OS
  const digit = digitOf(code);
  if (digit !== null) {
    if (k.ctrlKey || k.altKey) return { type: 'group', n: digit, op: 'assign' };
    if (k.shiftKey) return { type: 'group', n: digit, op: 'add' };
    return { type: 'group', n: digit, op: 'recall' };
  }
  if (k.ctrlKey) return null; // Ctrl+letter etc. stay with the browser
  switch (code) {
    case 'Escape':
      return { type: 'escape' };
    case 'Backquote':
      return { type: 'selectWarden', add: k.shiftKey };
    case 'Period':
    case 'NumpadDecimal':
      return { type: 'idleTiller' };
    case 'Comma':
      return { type: 'allMilitary' };
    case 'Space':
      return { type: 'jumpAlert' };
    case 'Tab':
      return { type: 'counterWheel' };
    case 'F2':
    case 'Pause':
      return { type: 'pause' };
    case 'Minus':
    case 'NumpadSubtract':
      return { type: 'speed', dir: -1 };
    case 'Equal':
    case 'NumpadAdd':
      return { type: 'speed', dir: 1 };
    case 'Delete':
    case 'Backspace':
      return { type: 'delete' };
    default:
      break;
  }
  const letter = letterOf(code);
  if (!letter) return null;
  if (k.altKey) return null;
  const g = GLOBAL_LETTERS[letter];
  if (g) return g;
  return { type: 'card', letter, shift: k.shiftKey };
}

// ---------------------------------------------------------------------------
// Hotkey labels for the player's keyboard layout (bindings stay on e.code)
// ---------------------------------------------------------------------------

/** e.code → printed key (e.g. QWERTZ: KeyZ → 'y'), from navigator.keyboard.getLayoutMap(). */
let layoutMap: ReadonlyMap<string, string> | null = null;

/** Install (or clear) the layout map used for hotkey labels. */
export function setKeyboardLayout(map: ReadonlyMap<string, string> | null): void {
  layoutMap = map && map.size ? new Map(map) : null;
}

/** The character printed on the key with this code, upper-cased; falls back to the QWERTY letter. */
export function letterFor(code: string): string {
  const k = layoutMap?.get(code);
  if (k && k.trim()) return k.length === 1 ? k.toUpperCase() : k;
  return letterOf(code) ?? (code === 'Backquote' ? '`' : code);
}

/**
 * Label for a hotkey written as its QWERTY character in data/HUD ('Z', 'Q', '`'). Bindings use
 * e.code, so on QWERTZ the research key 'Z' (KeyZ) is printed as 'Y'. Other labels pass through.
 */
export function hotkeyLabel(hotkey: string): string {
  if (/^[A-Za-z]$/.test(hotkey)) return letterFor(`Key${hotkey.toUpperCase()}`);
  if (hotkey === '`') return letterFor('Backquote');
  return hotkey;
}

interface LayoutNavigator {
  keyboard?: { getLayoutMap?: () => Promise<ReadonlyMap<string, string>> };
}

/** Read the layout map once (Chromium); without navigator.keyboard the QWERTY labels stay. */
export async function loadKeyboardLayout(nav: LayoutNavigator | undefined = typeof navigator !== 'undefined' ? (navigator as LayoutNavigator) : undefined): Promise<boolean> {
  const get = nav?.keyboard?.getLayoutMap;
  if (typeof get !== 'function') return false;
  try {
    const map = await get.call(nav!.keyboard);
    setKeyboardLayout(map);
    return !!layoutMap;
  } catch {
    return false;
  }
}

/** Should the browser default be suppressed for this key? */
export function shouldPreventDefault(k: KeyInput, action: KeyAction | null): boolean {
  if (k.metaKey) return false;
  if (ALWAYS_PREVENT.has(k.code)) return true;
  if (action && action.type === 'group' && (k.ctrlKey || k.altKey)) return true;
  // Alt+letter would type special characters / open menus on some platforms.
  return action !== null && !k.ctrlKey;
}
