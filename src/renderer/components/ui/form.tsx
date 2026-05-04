import * as LabelPrimitive from "@radix-ui/react-label";
import { type ComponentPropsWithoutRef, type HTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Label({ className, ...props }: ComponentPropsWithoutRef<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className={cn("label", className)} {...props} />;
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("input", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn("textarea", className)} {...props} />;
}

export function Field({ className, ...props }: HTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("field", className)} {...props} />;
}
