import { useId, useRef, useState } from "react";
import { AudioLines, Bot, Check, ChevronDown, Clock, Search } from "lucide-react";
import { ConnectorLogo } from "@/components/ConnectorLogo";
import { catalogEventLabel, catalogEventSource, CATALOG_EVENT_TYPES } from "@/lib/event-catalog";
import type { EventTypeOption } from "@/lib/api";
import { cn } from "@/lib/utils";

export function eventOptionsFromCatalog(): EventTypeOption[] {
  const rows: EventTypeOption[] = [];
  for (const type of CATALOG_EVENT_TYPES) {
    const source = catalogEventSource(type);
    rows.push({
      type,
      label: catalogEventLabel(type),
      kind: "platform",
      sourceId: source.id,
      sourceLabel: source.label,
    });
  }
  return rows;
}

export function eventSourceOf(option: EventTypeOption): { id: string; label: string } {
  if (option.sourceId.length > 0) {
    let label = option.sourceLabel;
    if (label.length === 0) {
      label = option.sourceId;
    }
    return { id: option.sourceId, label };
  }
  if (option.kind === "rule") {
    return { id: "extractor", label: "Extractors" };
  }
  if (option.kind === "agent") {
    return { id: "responder", label: "Responders" };
  }
  return catalogEventSource(option.type);
}

export function optionEventLabel(option: EventTypeOption): string {
  if (option.label.length > 0) {
    return option.label;
  }
  return catalogEventLabel(option.type);
}

function sourceRank(id: string): number {
  if (id === "clock") {
    return 0;
  }
  if (id === "lotaru") {
    return 1;
  }
  if (id === "extractor") {
    return 2;
  }
  if (id === "responder") {
    return 3;
  }
  if (id === "github") {
    return 4;
  }
  if (id === "google") {
    return 5;
  }
  return 50;
}

type SourceGroup = {
  id: string;
  label: string;
  options: EventTypeOption[];
};

function groupEventOptions(options: readonly EventTypeOption[]): SourceGroup[] {
  const groups: SourceGroup[] = [];
  for (const option of options) {
    const source = eventSourceOf(option);
    let found: SourceGroup | null = null;
    for (const group of groups) {
      if (group.id === source.id) {
        found = group;
      }
    }
    if (found === null) {
      groups.push({ id: source.id, label: source.label, options: [option] });
      continue;
    }
    found.options = found.options.concat([option]);
  }
  const copy: SourceGroup[] = [];
  for (const group of groups) {
    copy.push(group);
  }
  copy.sort((left: SourceGroup, right: SourceGroup) => {
    const rankLeft = sourceRank(left.id);
    const rankRight = sourceRank(right.id);
    if (rankLeft !== rankRight) {
      return rankLeft - rankRight;
    }
    return left.label.localeCompare(right.label);
  });
  return copy;
}

function optionMatchesQuery(option: EventTypeOption, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return true;
  }
  const source = eventSourceOf(option);
  const label = optionEventLabel(option);
  const hay = `${source.label} ${label} ${option.type}`.toLowerCase();
  return hay.includes(needle);
}

function placeEventPicker(panel: HTMLElement, button: HTMLElement): void {
  const box = button.getBoundingClientRect();
  const width = Math.max(box.width, 352);
  const maxWidth = Math.min(width, window.innerWidth - 24);
  const left = Math.max(12, Math.min(box.left, window.innerWidth - maxWidth - 12));
  const estimatedHeight = Math.min(448, window.innerHeight - 24);
  let top = box.bottom + 8;
  if (top + estimatedHeight > window.innerHeight - 12) {
    top = Math.max(12, box.top - estimatedHeight - 8);
  }
  panel.style.top = `${String(top)}px`;
  panel.style.left = `${String(left)}px`;
  panel.style.width = `${String(maxWidth)}px`;
}

function toggleEventPicker(panel: HTMLElement): void {
  const toggle = Reflect.get(panel, "togglePopover");
  if (typeof toggle === "function") {
    toggle.call(panel);
    return;
  }
  if (panel.hasAttribute("data-open")) {
    panel.removeAttribute("data-open");
    return;
  }
  panel.setAttribute("data-open", "");
}

function pickerIsOpen(panel: HTMLElement): boolean {
  const listed = Reflect.get(panel, "matches");
  if (typeof listed === "function") {
    if (listed.call(panel, ":popover-open") === true) {
      return true;
    }
  }
  return panel.hasAttribute("data-open");
}

export function EventSourceMark(props: {
  sourceId: string;
  sourceLabel: string;
  size: "sm" | "md";
}): React.JSX.Element {
  const compact = props.size === "sm";
  const box = compact
    ? "grid h-6 w-6 shrink-0 place-items-center rounded-md"
    : "grid h-8 w-8 shrink-0 place-items-center rounded-lg";
  const icon = compact ? "h-3.5 w-3.5" : "h-4 w-4";
  if (props.sourceId === "clock") {
    return (
      <span className={`${box} bg-secondary text-foreground`}>
        <Clock className={icon} aria-hidden="true" />
      </span>
    );
  }
  if (props.sourceId === "extractor") {
    return (
      <span className={`${box} bg-secondary text-foreground`}>
        <AudioLines className={icon} aria-hidden="true" />
      </span>
    );
  }
  if (props.sourceId === "responder") {
    return (
      <span className={`${box} bg-secondary text-foreground`}>
        <Bot className={icon} aria-hidden="true" />
      </span>
    );
  }
  if (props.sourceId === "lotaru") {
    return (
      <span className={`${box} bg-primary text-[11px] font-semibold text-primary-foreground`}>
        L
      </span>
    );
  }
  return (
    <ConnectorLogo id={props.sourceId} label={props.sourceLabel} eager={true} size={props.size} />
  );
}

type Props = {
  id: string;
  value: string;
  options: readonly EventTypeOption[];
  onChange(next: string): void;
  allowEmpty: boolean;
  emptyLabel: string;
  sourceIds: readonly string[];
  className: string;
};

export function EventSourceSelect(rawProps: Partial<Props> & Pick<Props, "id" | "value" | "options" | "onChange">): React.JSX.Element {
  let allowEmpty = false;
  if (rawProps.allowEmpty === true) {
    allowEmpty = true;
  }
  let emptyLabel = "All types";
  if (rawProps.emptyLabel !== undefined && rawProps.emptyLabel.length > 0) {
    emptyLabel = rawProps.emptyLabel;
  }
  let sourceIds: readonly string[] = [];
  if (rawProps.sourceIds !== undefined) {
    sourceIds = rawProps.sourceIds;
  }
  let className = "";
  if (rawProps.className !== undefined) {
    className = rawProps.className;
  }
  const listed: EventTypeOption[] = [];
  for (const option of rawProps.options) {
    if (sourceIds.length > 0) {
      const source = eventSourceOf(option);
      let allowed = false;
      for (const wanted of sourceIds) {
        if (wanted === source.id) {
          allowed = true;
        }
      }
      if (allowed !== true) {
        continue;
      }
    }
    listed.push(option);
  }
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const reactId = useId();
  const panelId = `event-source${reactId.replace(/:/g, "")}`;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const visible: EventTypeOption[] = [];
  for (const option of listed) {
    if (optionMatchesQuery(option, query) !== true) {
      continue;
    }
    visible.push(option);
  }
  const groups = groupEventOptions(visible);
  const flat: EventTypeOption[] = [];
  if (allowEmpty) {
    flat.push({
      type: "",
      label: emptyLabel,
      kind: "platform",
      sourceId: "",
      sourceLabel: "",
    });
  }
  for (const option of visible) {
    flat.push(option);
  }

  let selected: EventTypeOption | null = null;
  for (const option of listed) {
    if (option.type === rawProps.value) {
      selected = option;
    }
  }
  if (selected === null && rawProps.value.length > 0) {
    const source = catalogEventSource(rawProps.value);
    selected = {
      type: rawProps.value,
      label: catalogEventLabel(rawProps.value),
      kind: "platform",
      sourceId: source.id,
      sourceLabel: source.label,
    };
  }

  function bindPanel(el: HTMLDivElement | null): void {
    panelRef.current = el;
    if (el === null) {
      return;
    }
    el.setAttribute("popover", "auto");
    if (el.dataset["listen"] === "1") {
      return;
    }
    el.dataset["listen"] = "1";
    el.addEventListener("toggle", () => {
      setOpen(pickerIsOpen(el));
    });
  }

  function openPicker(): void {
    const panel = panelRef.current;
    const button = buttonRef.current;
    if (panel === null || button === null) {
      return;
    }
    placeEventPicker(panel, button);
    if (pickerIsOpen(panel) !== true) {
      toggleEventPicker(panel);
    }
    setQuery("");
    let index = 0;
    for (let i = 0; i < flat.length; i += 1) {
      const row = flat[i];
      if (row !== undefined && row.type === rawProps.value) {
        index = i;
      }
    }
    setHighlight(index);
    setOpen(true);
    window.setTimeout(() => {
      if (searchRef.current !== null) {
        searchRef.current.focus();
      }
    }, 0);
  }

  function closePicker(): void {
    const panel = panelRef.current;
    if (panel === null) {
      return;
    }
    if (pickerIsOpen(panel)) {
      toggleEventPicker(panel);
    }
    setOpen(false);
    setQuery("");
  }

  function choose(next: string): void {
    rawProps.onChange(next);
    closePicker();
    if (buttonRef.current !== null) {
      buttonRef.current.focus();
    }
  }

  function moveHighlight(delta: number): void {
    if (flat.length === 0) {
      return;
    }
    const next = (highlight + delta + flat.length) % flat.length;
    setHighlight(next);
  }

  let triggerBody: React.JSX.Element;
  if (rawProps.value.length === 0 && allowEmpty) {
    triggerBody = <span className="truncate text-muted-foreground">{emptyLabel}</span>;
  } else if (selected === null) {
    triggerBody = <span className="truncate text-muted-foreground">Choose an event</span>;
  } else {
    const source = eventSourceOf(selected);
    triggerBody = (
      <span className="flex min-w-0 items-center gap-2.5">
        <EventSourceMark sourceId={source.id} sourceLabel={source.label} size="sm" />
        <span className="min-w-0 text-left">
          <span className="block truncate text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {source.label}
          </span>
          <span className="block truncate text-sm text-foreground">{optionEventLabel(selected)}</span>
        </span>
      </span>
    );
  }

  return (
    <div className="relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        id={rawProps.id}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          "flex h-11 w-full min-w-[18rem] items-center justify-between gap-2 rounded-xl border border-white/[0.1] bg-[#111111] px-2.5 py-1.5 text-sm text-foreground ring-offset-black hover:border-white/[0.16] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-black",
          className,
        )}
        onClick={() => {
          const panel = panelRef.current;
          if (panel === null) {
            return;
          }
          if (pickerIsOpen(panel)) {
            closePicker();
            return;
          }
          openPicker();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openPicker();
          }
        }}
      >
        {triggerBody}
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
      </button>
      <div
        ref={bindPanel}
        id={panelId}
        className="event-source-picker"
      >
        <div className="sticky top-0 z-10 border-b border-white/[0.08] bg-[#111111] p-2">
          <label className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-black/40 px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder="Search GitHub, Google, clock…"
              className="h-6 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlight(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  moveHighlight(1);
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  moveHighlight(-1);
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  const row = flat[highlight];
                  if (row !== undefined) {
                    choose(row.type);
                  }
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  closePicker();
                }
              }}
            />
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5" role="listbox" aria-labelledby={rawProps.id}>
          {allowEmpty ? (
            <button
              type="button"
              role="option"
              aria-selected={rawProps.value.length === 0}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm",
                highlight === 0 ? "bg-white/[0.06]" : "hover:bg-white/[0.04]",
              )}
              onMouseEnter={() => {
                setHighlight(0);
              }}
              onClick={() => {
                choose("");
              }}
            >
              <span className="truncate text-muted-foreground">{emptyLabel}</span>
            </button>
          ) : null}
          {groups.map((group) => (
            <section key={group.id} className="pb-1.5" aria-label={group.label}>
              {group.options.map((option) => {
                let index = 0;
                for (let i = 0; i < flat.length; i += 1) {
                  const row = flat[i];
                  if (row !== undefined && row.type === option.type) {
                    index = i;
                  }
                }
                const active = option.type === rawProps.value;
                const lit = index === highlight;
                return (
                  <button
                    key={option.type}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left",
                      lit ? "bg-primary/20" : "hover:bg-white/[0.04]",
                    )}
                    onMouseEnter={() => {
                      setHighlight(index);
                    }}
                    onClick={() => {
                      choose(option.type);
                    }}
                  >
                    <EventSourceMark
                      sourceId={eventSourceOf(option).id}
                      sourceLabel={eventSourceOf(option).label}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-sm", active ? "font-semibold text-foreground" : "text-foreground")}>
                        {optionEventLabel(option)}
                      </span>
                      <span className="block truncate font-mono text-[10px] text-muted-foreground">
                        {option.type}
                      </span>
                    </span>
                    {active ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </section>
          ))}
          {visible.length === 0 && allowEmpty !== true ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">No events match.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
