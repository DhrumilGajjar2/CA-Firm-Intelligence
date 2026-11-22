"use client";

import { useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Password field with a show/hide toggle. Accepts the same props as <Input> (incl. react-hook-form's register). */
export function PasswordInput({
  className,
  disabled,
  ...props
}: Omit<ComponentProps<"input">, "type">) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        {...props}
        disabled={disabled}
        type={visible ? "text" : "password"}
        className={`pr-9 ${className ?? ""}`}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-0.5 right-0.5"
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        disabled={disabled}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
      </Button>
    </div>
  );
}
