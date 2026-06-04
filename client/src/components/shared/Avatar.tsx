import { cn } from '../../lib/utils';

interface AvatarProps {
  /** Display name — used for initials + colour seed */
  name?: string | null;
  /** Optional email — fallback if name is missing */
  email?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  /** Force a specific gradient instead of deriving from name */
  gradient?: string;
}

const sizeMap = {
  xs: 'h-4 w-4 text-[8px]',
  sm: 'h-5 w-5 text-[9px]',
  md: 'h-7 w-7 text-[10.5px]',
  lg: 'h-9 w-9 text-[12px]',
  xl: 'h-12 w-12 text-[14px]',
};

/* Eight stable gradient pairings — chosen for the SkySend palette */
const GRADIENTS = [
  'from-[#5B5BF5] to-[#8B5CF6]',
  'from-[#8B5CF6] to-[#EC4899]',
  'from-[#06B6D4] to-[#5B5BF5]',
  'from-[#10B981] to-[#06B6D4]',
  'from-[#F59E0B] to-[#EF4444]',
  'from-[#EF4444] to-[#EC4899]',
  'from-[#5B5BF5] to-[#06B6D4]',
  'from-[#8B5CF6] to-[#5B5BF5]',
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
  const grad = gradient || GRADIENTS[hashCode(seed) % GRADIENTS.length];

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full font-bold text-white flex-shrink-0 bg-gradient-to-br shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]',
        grad,
        sizeMap[size],
        className
      )}
      aria-label={name || email || ''}
    >
      {initials(name, email)}
    </span>
  );
}
