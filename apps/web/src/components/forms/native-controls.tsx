import type { ComponentProps } from "react";
import { cn } from "cn";

const control =
  "border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 disabled:bg-input/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 w-full min-w-0 rounded-lg border bg-transparent px-2.5 text-base transition-colors outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3 md:text-sm";

/** Native <select>: keyboard and screen-reader behaviour for free, styled like <Input>. */
export function SelectInput({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(control, "h-8 py-1", className)} {...props} />;
}

export function TextareaInput({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-16 py-1.5", className)} {...props} />;
}
