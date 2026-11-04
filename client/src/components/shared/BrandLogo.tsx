import { BRAND_LOGOS, type BrandId } from './brandLogos';
import { cn } from '../../lib/utils';

/**
 * A brand's official mark on a tile: white with a hairline border for
 * marks drawn in their own colours, or the brand's colour for an app icon
 * that is white on colour (Pipedrive). Rendered as an <img> from a data URI,
 * so the SVG is static artwork and nothing in it can run.
 */
export function BrandLogo({ id, size = 'md', className }: { id: BrandId; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const brand = BRAND_LOGOS[id];
  const box = size === 'lg' ? 'h-11 w-11 rounded-xl' : size === 'sm' ? 'h-7 w-7 rounded-lg' : 'h-9 w-9 rounded-xl';
  const mark = size === 'lg' ? 'h-6 w-6' : size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';
  const filled = brand.tile !== 'light';
  return (
    <span
      className={cn('flex flex-shrink-0 items-center justify-center', box, !filled && 'border border-[var(--border-subtle)] bg-white', className)}
      style={filled ? { backgroundColor: brand.tile } : undefined}
    >
      <img
        src={`data:image/svg+xml;utf8,${encodeURIComponent(brand.svg)}`}
        alt=""
        aria-hidden="true"
        className={cn('object-contain', filled ? (size === 'lg' ? 'h-8 w-8' : size === 'sm' ? 'h-5 w-5' : 'h-7 w-7') : mark)}
        draggable={false}
      />
    </span>
  );
}
