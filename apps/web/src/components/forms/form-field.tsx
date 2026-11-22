import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

interface FormFieldProps {
  id: string;
  label: string;
  error?: string;
  /** Extra content on the label row (e.g. a "Forgot password?" link). */
  labelAside?: ReactNode;
  /** Helper content shown under the input (e.g. password rules). */
  hint?: ReactNode;
  children: ReactNode;
}

/** Label + control + error message. The control must set `id` and `aria-describedby` via `errorId(id)`. */
export function FormField({
  id,
  label,
  error,
  labelAside,
  hint,
  children,
}: FormFieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        {labelAside}
      </div>
      {children}
      {hint}
      {error ? (
        <p id={errorId(id)} className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const errorId = (id: string) => `${id}-error`;

/** Spread on the control: id + invalid state + link to the error message for screen readers. */
export function fieldProps(id: string, error?: string) {
  return {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? errorId(id) : undefined,
  } as const;
}
