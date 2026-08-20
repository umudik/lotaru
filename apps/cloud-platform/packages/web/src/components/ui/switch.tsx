import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";
import { cn, omitProps, type PropBag } from "@/lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>((rawProps, ref) => {
  return React.createElement(
    SwitchPrimitives.Root,
    Object.assign({}, omitProps(rawProps as PropBag, ["className"]), {
      ref,
      className: cn(
        "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=unchecked]:border-white/30 data-[state=unchecked]:bg-[#2a2a2a]",
        rawProps.className,
      ),
    }),
    React.createElement(SwitchPrimitives.Thumb, {
      className:
        "pointer-events-none block h-5 w-5 rounded-full bg-white shadow-sm ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0",
    }),
  );
});
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
