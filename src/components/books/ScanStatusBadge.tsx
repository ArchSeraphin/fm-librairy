import type { ScanStatus } from '@prisma/client';
import { Loader2, ShieldCheck, ShieldAlert, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  status: ScanStatus;
  size?: 'sm' | 'md';
  className?: string;
}

const VARIANT: Record<ScanStatus, { label: string; cls: string; Icon: typeof Loader2 }> = {
  PENDING: { label: 'En analyse', cls: 'bg-slate-100 text-slate-700', Icon: Loader2 },
  CLEAN: { label: 'Disponible', cls: 'bg-green-100 text-green-800', Icon: ShieldCheck },
  INFECTED: { label: 'Bloqué', cls: 'bg-red-100 text-red-800', Icon: ShieldAlert },
  ERROR: { label: 'Erreur d’analyse', cls: 'bg-orange-100 text-orange-800', Icon: AlertTriangle },
};

export function ScanStatusBadge({ status, size = 'md', className }: Props) {
  const v = VARIANT[status];
  const dim = size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-sm px-2 py-1';
  const animate = status === 'PENDING' ? 'animate-spin' : '';
  return (
    <span
      data-testid={`scan-status-${status.toLowerCase()}`}
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium',
        v.cls,
        dim,
        className,
      )}
    >
      <v.Icon className={cn(size === 'sm' ? 'h-3 w-3' : 'h-4 w-4', animate)} />
      {v.label}
    </span>
  );
}
