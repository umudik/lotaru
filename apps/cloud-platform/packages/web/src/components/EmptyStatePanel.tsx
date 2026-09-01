import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyStatePanel(props: {
  title: string;
  description: string;
  action?: ReactNode;
  plain?: boolean;
}): React.JSX.Element {
  let shellClass = "panel-card flex flex-col items-center justify-center px-6 py-10 text-center";
  if (props.plain === true) {
    shellClass = "flex flex-col items-center justify-center px-4 py-10 text-center";
  }
  return (
    <div className={cn(shellClass)}>
      <p className="text-sm font-semibold text-foreground">{props.title}</p>
      {props.description.length > 0 ? (
        <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
          {props.description}
        </p>
      ) : null}
      {props.action !== undefined ? <div className="mt-4">{props.action}</div> : null}
    </div>
  );
}
