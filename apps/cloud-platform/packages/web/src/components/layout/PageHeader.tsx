import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type Crumb = { label: string; to: string | null };

type PageHeaderProps = {
  context: string | null;
  contextExtra: ReactNode | null;
  breadcrumb: Crumb[] | null;
  title: string;
  subtitle: string | null;
  actions: ReactNode | null;
  className: string | null;
};

export function PageHeader(rawProps: Partial<PageHeaderProps> & Pick<PageHeaderProps, "title">) {
  let context: string | null = null;
  if ("context" in rawProps) {
    if (rawProps.context === null) {
      context = null;
    } else if (typeof rawProps.context === "string" && rawProps.context.length > 0) {
      context = rawProps.context;
    }
  }
  let contextExtra: ReactNode | null = null;
  if ("contextExtra" in rawProps && rawProps.contextExtra !== null && rawProps.contextExtra !== undefined) {
    contextExtra = rawProps.contextExtra;
  }
  let breadcrumb: Crumb[] | null = null;
  if ("breadcrumb" in rawProps) {
    if (rawProps.breadcrumb === null) {
      breadcrumb = null;
    } else if (Array.isArray(rawProps.breadcrumb)) {
      breadcrumb = rawProps.breadcrumb;
    }
  }
  let subtitle: string | null = null;
  if ("subtitle" in rawProps) {
    if (rawProps.subtitle === null) {
      subtitle = null;
    } else if (typeof rawProps.subtitle === "string") {
      subtitle = rawProps.subtitle;
    }
  }
  let actions: ReactNode | null = null;
  if ("actions" in rawProps && rawProps.actions !== null && rawProps.actions !== undefined) {
    actions = rawProps.actions;
  }
  let className: string | null = null;
  if ("className" in rawProps) {
    if (rawProps.className === null) {
      className = null;
    } else if (typeof rawProps.className === "string") {
      className = rawProps.className;
    }
  }
  const { title } = rawProps;
  const showContext = context !== null || contextExtra !== null;

  return (
    <header className={cn("page-toolbar flex-wrap", className)}>
      <div className="min-w-0">
        {breadcrumb !== null && breadcrumb.length > 0 ? <Breadcrumb items={breadcrumb} /> : null}
        {showContext ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {context !== null ? <span className="truncate">{context}</span> : null}
            {contextExtra}
          </div>
        ) : null}
        <h1 className="truncate text-lg font-semibold tracking-tight text-white">{title}</h1>
        {subtitle !== null ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions !== null ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <Fragment key={`${item.label}-${index}`}>
            {item.to !== null && isLast !== true ? (
              <Link to={item.to} className="max-w-[12rem] truncate transition-colors hover:text-foreground">
                {item.label}
              </Link>
            ) : (
              <span className={cn("max-w-[12rem] truncate", isLast && "text-foreground")}>{item.label}</span>
            )}
            {isLast !== true ? <ChevronRight className="h-3 w-3 shrink-0 opacity-60" /> : null}
          </Fragment>
        );
      })}
    </nav>
  );
}
