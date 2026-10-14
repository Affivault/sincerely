import { cn } from '../../lib/utils';

interface AvatarProps {
  /** Display name — used for initials + colour seed */
  name?: string | null;
  /** Optional email — fallback if name is missing */
  email?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  /** Force specific tone classes instead of deriving them from the name */
  gradient?: string;
}

const sizeMap = {
  xs: 'h-4 w-4 text-micro',
  sm: 'h-5 w-5 text-micro',
  md: 'h-7 w-7 text-micro',
  lg: 'h-9 w-9 text-body',
  xl: 'h-12 w-12 text-heading',
};

/*
 * Eight stable tones - a pale pigment ground with the initials in the same
 * pigment, darker. Gradient discs were the most "generated" thing in the
 * app: a candy-coloured circle per person turns a list of names into
 * confetti. These read as a set and let the name stay the loud part.
 */
const TONES = [
  'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-200',
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200',
  'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200',
  'bg-violet-100 text-violet-800 dark:bg-violet-900/60 dark:text-violet-200',
  'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200',
  'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200',
  'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/60 dark:text-cyan-200',
  'bg-stone-200 text-stone-700 dark:bg-stone-700/60 dark:text-stone-200',
];

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function initials(name?: string | null, email?: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  if (email) return email.slice(0, 2).toUpperCase();
  return '··';
}

export function Avatar({ name, email, size = 'md', className, gradient }: AvatarProps) {
  const seed = (name || email || '?').toLowerCase();
  const tone = gradient || TONES[hashCode(seed) % TONES.length];

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full font-semibold flex-shrink-0 tracking-[0.01em]',
        tone,
        sizeMap[size],
        className
      )}
      aria-label={name || email || ''}
    >
      {initials(name, email)}
    </span>
  );
}
