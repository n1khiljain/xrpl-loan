import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

/*
 * The design system's button. One shape (a pill), one weight (medium, the heading face's), one focus treatment (a
 * deep orange ring offset from the button), and a press that settles slightly. Variants by emphasis:
 *   default      the one primary action in a view: Night
 *   secondary    a quieter companion to the primary: warm grey
 *   outline      a standalone action on a light surface: white with a hairline
 *   ghost, link  the least emphasis
 *   destructive  irreversible actions
 *   light, glass the same roles on Night and other dark surfaces
 * A leading or trailing icon tightens that side's padding on its own, so callers don't adjust padding by hand.
 */
const buttonVariants = cva(
  [
    "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap select-none",
    "transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:scale-[0.98] motion-reduce:active:scale-100",
    "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-40 aria-invalid:ring-2 aria-invalid:ring-destructive/30",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-ink-2",
        destructive: "bg-destructive text-on-status hover:bg-destructive/90 focus-visible:ring-destructive",
        outline: "border border-border bg-surface text-foreground hover:border-muted-foreground/40 hover:bg-surface-muted",
        secondary: "bg-divider text-foreground hover:bg-border",
        ghost: "text-foreground hover:bg-surface-muted",
        link: "h-auto! px-0! text-link underline-offset-4 hover:underline",
        /* the same roles on Night and other dark surfaces */
        light: "bg-on-ink text-ink hover:bg-on-ink/90",
        glass: "border border-on-ink/20 bg-on-ink/10 text-on-ink hover:bg-on-ink/18",
      },
      size: {
        xs: "h-7 gap-1 px-3 text-xs has-[>svg:first-child]:pl-2 has-[>svg:last-child]:pr-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-9 gap-1.5 px-4 text-[13px] has-[>svg:first-child]:pl-3 has-[>svg:last-child]:pr-3",
        default: "h-11 px-5 text-sm has-[>svg:first-child]:pl-4 has-[>svg:last-child]:pr-4",
        lg: "h-12 px-6 text-[15px] has-[>svg:first-child]:pl-5 has-[>svg:last-child]:pr-5",
        icon: "size-11",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
