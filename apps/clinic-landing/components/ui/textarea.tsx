import * as React from "react";
import { cn } from "@/lib/utils";

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string;
  label?: string;
  hint?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, hint, className, id, required, rows = 4, ...rest }, ref) => {
    const reactId = React.useId();
    const textareaId = id ?? reactId;
    const errorId = `${textareaId}-error`;
    const hintId = `${textareaId}-hint`;
    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={textareaId}
            className="mb-1.5 block text-sm font-medium text-brand-fg"
          >
            {label}
            {required && (
              <span aria-hidden className="ml-1 text-brand-primary">
                *
              </span>
            )}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          rows={rows}
          className={cn(
            "field resize-y",
            error && "border-red-500 focus:border-red-500 focus:shadow-[0_0_0_3px_rgba(239,68,68,0.18)]",
            className,
          )}
          aria-invalid={Boolean(error)}
          aria-describedby={[error ? errorId : null, hint ? hintId : null]
            .filter(Boolean)
            .join(" ") || undefined}
          required={required}
          {...rest}
        />
        {hint && !error && (
          <p id={hintId} className="mt-1 text-xs text-brand-fg-muted">
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} className="mt-1 text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
    );
  },
);
Textarea.displayName = "Textarea";
