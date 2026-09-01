import { useId, useRef } from "react";
import { Info } from "lucide-react";

function placePopover(panel: HTMLElement, button: HTMLElement): void {
  const box = button.getBoundingClientRect();
  const width = 320;
  const left = Math.max(12, Math.min(box.left, window.innerWidth - width - 12));
  const top = box.bottom + 8;
  panel.style.top = `${String(top)}px`;
  panel.style.left = `${String(left)}px`;
}

function toggleInfoPopover(panel: HTMLElement): void {
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

export function PageInfoButton(props: { text: string }): React.JSX.Element {
  const reactId = useId();
  const panelId = `page-info${reactId.replace(/:/g, "")}`;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  function bindPanel(el: HTMLDivElement | null): void {
    panelRef.current = el;
    if (el === null) {
      return;
    }
    el.setAttribute("popover", "auto");
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
        aria-label="About this page"
        onClick={() => {
          const panel = panelRef.current;
          const button = buttonRef.current;
          if (panel === null || button === null) {
            return;
          }
          placePopover(panel, button);
          toggleInfoPopover(panel);
        }}
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      <div ref={bindPanel} id={panelId} className="page-info-popover">
        <p className="text-sm leading-relaxed text-muted-foreground">{props.text}</p>
      </div>
    </>
  );
}
