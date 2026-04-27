'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface OtpInputProps {
  length: number;
  value: string;
  onChange: (next: string) => void;
  onComplete?: (code: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
  hasError?: boolean;
  className?: string;
}

export function OtpInput({
  length,
  value,
  onChange,
  onComplete,
  disabled,
  autoFocus,
  ariaLabel,
  hasError,
  className,
}: OtpInputProps) {
  const refs = React.useRef<(HTMLInputElement | null)[]>([]);
  const cells = React.useMemo(() => Array.from({ length }), [length]);

  React.useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  const setChar = (index: number, char: string): string => {
    const arr = value.split('');
    while (arr.length < length) arr.push('');
    arr[index] = char;
    return arr.slice(0, length).join('');
  };

  const handleChange = (index: number, raw: string) => {
    const digit = raw.replace(/\D/g, '').slice(-1);
    const next = setChar(index, digit);
    onChange(next);
    if (digit && index < length - 1) {
      refs.current[index + 1]?.focus();
    }
    if (next.length === length && !next.includes('') && next.replace(/\D/g, '').length === length) {
      onComplete?.(next);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!value[index]) {
        if (index > 0) {
          e.preventDefault();
          const next = setChar(index - 1, '');
          onChange(next);
          refs.current[index - 1]?.focus();
        }
      } else {
        const next = setChar(index, '');
        onChange(next);
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      refs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      e.preventDefault();
      refs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!pasted) return;
    onChange(pasted);
    const focusIndex = Math.min(pasted.length, length - 1);
    refs.current[focusIndex]?.focus();
    if (pasted.length === length) {
      onComplete?.(pasted);
    }
  };

  return (
    <div
      role="group"
      aria-label={ariaLabel ?? 'one-time code'}
      className={cn('flex justify-center gap-2', className)}
    >
      {cells.map((_, index) => (
        <input
          key={index}
          ref={(el) => {
            refs.current[index] = el;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]"
          maxLength={1}
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          disabled={disabled}
          value={value[index] ?? ''}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.currentTarget.select()}
          aria-label={`${ariaLabel ?? 'digit'} ${index + 1} of ${length}`}
          className={cn(
            'h-12 w-10 rounded-md border bg-transparent text-center font-mono text-lg shadow-sm transition-colors',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
            hasError ? 'border-destructive/50' : 'border-input',
          )}
        />
      ))}
    </div>
  );
}
