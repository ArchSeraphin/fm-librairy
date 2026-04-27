import { Library } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BrandMarkProps {
  className?: string;
  showWordmark?: boolean;
  size?: 'sm' | 'md';
}

export function BrandMark({ className, showWordmark = true, size = 'md' }: BrandMarkProps) {
  const tile = size === 'sm' ? 'h-7 w-7' : 'h-9 w-9';
  const icon = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const text = size === 'sm' ? 'text-sm' : 'text-base';

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className={cn('flex items-center justify-center rounded-md bg-accent/10', tile)}>
        <Library className={cn('text-accent', icon)} aria-hidden="true" />
      </div>
      {showWordmark && (
        <span className={cn('font-semibold tracking-tight text-foreground', text)}>
          BiblioShare
        </span>
      )}
    </div>
  );
}
