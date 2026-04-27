import { cn } from '@/lib/utils';

interface StepperProps {
  currentStep: number;
  totalSteps: number;
  className?: string;
  label?: string;
}

export function Stepper({ currentStep, totalSteps, className, label }: StepperProps) {
  return (
    <div
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={totalSteps}
      aria-valuenow={currentStep}
      aria-label={label ?? `Étape ${currentStep} sur ${totalSteps}`}
      className={cn('flex items-center gap-3 text-xs text-muted-foreground', className)}
    >
      <span className="font-medium">
        {currentStep} / {totalSteps}
      </span>
      <div className="flex gap-1.5" aria-hidden="true">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <span
            key={i}
            className={cn(
              'h-1 w-8 rounded-full transition-colors',
              i < currentStep ? 'bg-accent' : 'bg-border',
            )}
          />
        ))}
      </div>
    </div>
  );
}
