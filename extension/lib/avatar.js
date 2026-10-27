/**
 * Avatar tones, ported from client/src/components/shared/Avatar.tsx so the
 * same person gets the same colour in the extension and the app.
 *
 * The app moved off gradient discs in the redesign: a pale pigment ground with
 * the initials in the same pigment, darker. These are its Tailwind classes
 * written out as values (light ground, light ink, dark ground, dark ink).
 */
const TONES = [
  ['#e0e7ff', '#3730a3', 'rgba(49, 46, 129, 0.6)', '#c7d2fe'],
  ['#d1fae5', '#065f46', 'rgba(6, 78, 59, 0.6)', '#a7f3d0'],
  ['#fef3c7', '#92400e', 'rgba(120, 53, 15, 0.6)', '#fde68a'],
  ['#ede9fe', '#5b21b6', 'rgba(76, 29, 149, 0.6)', '#ddd6fe'],
  ['#e0f2fe', '#075985', 'rgba(12, 74, 110, 0.6)', '#bae6fd'],
  ['#ffe4e6', '#9f1239', 'rgba(136, 19, 55, 0.6)', '#fecdd3'],
  ['#cffafe', '#155e75', 'rgba(22, 78, 99, 0.6)', '#a5f3fc'],
  ['#e7e5e4', '#44403c', 'rgba(68, 64, 60, 0.6)', '#e7e5e4'],
];

/** The app's hash, so the seed picks the same tone in both places. */
export function hashCode(value) {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = ((h << 5) - h + value.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** @param {string} [name] @param {string} [email] */
export function initialsFor(name, email) {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  if (email) return email.slice(0, 2).toUpperCase();
  return '··';
}

/**
 * Colour an avatar element for a seed. The CSS reads the four custom
 * properties, picking the dark pair under `.dark`.
 *
 * @param {HTMLElement} node
 * @param {string} seed
 */
export function paintAvatar(node, seed) {
  const [bg, fg, bgDark, fgDark] = TONES[hashCode(String(seed || '?').toLowerCase()) % TONES.length];
  node.style.setProperty('--av-bg', bg);
  node.style.setProperty('--av-fg', fg);
  node.style.setProperty('--av-bg-dark', bgDark);
  node.style.setProperty('--av-fg-dark', fgDark);
}

/** @param {HTMLElement} node */
export function clearAvatar(node) {
  for (const prop of ['--av-bg', '--av-fg', '--av-bg-dark', '--av-fg-dark']) node.style.removeProperty(prop);
}
