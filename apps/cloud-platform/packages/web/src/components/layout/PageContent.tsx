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
  return <div className={cn("page-content", extra)}>{props.children}</div>;
}
