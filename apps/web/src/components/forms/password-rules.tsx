import { Check, Circle } from "lucide-react";
import { cn } from "cn";

/** Mirrors `passwordSchema` in @ca-firm/validation (8-128 chars, a letter and a digit). */
const RULES = [
  { id: "length", label: "At least 8 characters", test: (v: string) => v.length >= 8 },
  { id: "letter", label: "Contains a letter", test: (v: string) => /[A-Za-z]/.test(v) },
  { id: "number", label: "Contains a number", test: (v: string) => /[0-9]/.test(v) },
] as const;

export function PasswordRules({ id, value }: { id: string; value: string }) {
  return (
    <ul id={id} aria-label="Password requirements" className="flex flex-col gap-1">
      {RULES.map((rule) => {
        const met = rule.test(value);
        return (
          <li
            key={rule.id}
            data-met={met}
            className={cn(
              "flex items-center gap-1.5 text-xs",
              met ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {met ? (
              <Check className="size-3 text-green-600" aria-hidden />
            ) : (
              <Circle className="size-3" aria-hidden />
            )}
            {rule.label}
            <span className="sr-only">{met ? " (met)" : " (not met yet)"}</span>
          </li>
        );
      })}
    </ul>
  );
}
