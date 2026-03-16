import { keyboard, Key } from "@nut-tree-fork/nut-js";

export async function typeText(text: string): Promise<void> {
  await keyboard.type(text);
}

const KEY_MAP: Record<string, Key> = {
  enter: Key.Enter,
  return: Key.Enter,
  tab: Key.Tab,
  escape: Key.Escape,
  esc: Key.Escape,
  space: Key.Space,
  backspace: Key.Backspace,
  delete: Key.Delete,
  up: Key.Up,
  down: Key.Down,
  left: Key.Left,
  right: Key.Right,
  home: Key.Home,
  end: Key.End,
  pageup: Key.PageUp,
  pagedown: Key.PageDown,
  command: Key.LeftCmd,
  cmd: Key.LeftCmd,
  control: Key.LeftControl,
  ctrl: Key.LeftControl,
  alt: Key.LeftAlt,
  option: Key.LeftAlt,
  shift: Key.LeftShift,
  f1: Key.F1,
  f2: Key.F2,
  f3: Key.F3,
  f4: Key.F4,
  f5: Key.F5,
  f6: Key.F6,
  f7: Key.F7,
  f8: Key.F8,
  f9: Key.F9,
  f10: Key.F10,
  f11: Key.F11,
  f12: Key.F12,
  a: Key.A,
  b: Key.B,
  c: Key.C,
  d: Key.D,
  e: Key.E,
  f: Key.F,
  g: Key.G,
  h: Key.H,
  i: Key.I,
  j: Key.J,
  k: Key.K,
  l: Key.L,
  m: Key.M,
  n: Key.N,
  o: Key.O,
  p: Key.P,
  q: Key.Q,
  r: Key.R,
  s: Key.S,
  t: Key.T,
  u: Key.U,
  v: Key.V,
  w: Key.W,
  x: Key.X,
  y: Key.Y,
  z: Key.Z,
};

function resolveKey(keyName: string): Key {
  const lower = keyName.toLowerCase();
  const mapped = KEY_MAP[lower];
  if (mapped !== undefined) return mapped;
  throw new Error(`Unknown key: ${keyName}`);
}

export async function shortcut(keys: string[]): Promise<void> {
  const resolvedKeys = keys.map(resolveKey);
  // Press all modifier keys, then the final key
  for (let i = 0; i < resolvedKeys.length - 1; i++) {
    await keyboard.pressKey(resolvedKeys[i]);
  }
  await keyboard.pressKey(resolvedKeys[resolvedKeys.length - 1]);
  // Release in reverse order
  for (let i = resolvedKeys.length - 1; i >= 0; i--) {
    await keyboard.releaseKey(resolvedKeys[i]);
  }
}
