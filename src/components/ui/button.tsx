import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold leading-none transition-all outline-none disabled:pointer-events-none disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-lime-300/60",
  {
    variants: {
      variant: {
        primary:
          "bg-lime-300 text-zinc-950 shadow-[0_10px_30px_rgba(190,242,100,.18)] hover:bg-lime-200",
        secondary:
          "border border-white/10 bg-white/[.055] text-zinc-100 hover:border-white/20 hover:bg-white/[.09]",
        ghost: "text-zinc-400 hover:bg-white/[.06] hover:text-white",
        danger: "bg-red-500/12 text-red-300 hover:bg-red-500/20",
      },
      size: {
        sm: "h-8 px-3",
        md: "h-10 px-4",
        icon: "size-9 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
