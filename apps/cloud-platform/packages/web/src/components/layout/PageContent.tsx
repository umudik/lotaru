import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageContent(props: {
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  let extra = "";
  if (props.className !== undefined) {
    extra = props.className;
  }
  return <div className={cn("min-h-0 flex-1 px-8 pb-6 pt-2", extra)}>{props.children}</div>;
}
