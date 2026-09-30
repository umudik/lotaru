import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LOTARU_MERMAID_COLORS, mermaidRenderSource, mermaidSourceFromBody } from "@/lib/mermaid-source";
import { beginPanPointer, bindPanDrag, type PanDragState } from "@/components/workflow/workflow-utils";

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.6;

type Point = { x: number; y: number };

type BoardRefs = {
  getZoom: () => number;
  getPan: () => Point;
  setZoom: (zoom: number) => void;
  setPan: (pan: Point) => void;
};

let mermaidConfigured = false;

function clampZoom(value: number): number {
  const floor = MIN_ZOOM;
  const ceiling = MAX_ZOOM;
  if (value < floor) {
    return floor;
  }
  if (value > ceiling) {
    return ceiling;
  }
  return value;
}

function mermaidDomId(seed: string): string {
  const compact = seed.replace(/[^a-zA-Z0-9]/g, "");
  const stamp = Date.now().toString(36);
  if (compact.length === 0) {
    return `m${stamp}`;
  }
  const head = compact.slice(0, 20);
  return `m${head}${stamp}`;
}

function caughtMessage(failure: { message: string }): string {
  const text = failure.message.trim();
  if (text.length === 0) {
    return "Diagram could not be drawn";
  }
  return text;
}

function svgBox(svg: SVGSVGElement): { width: number; height: number } {
  const fallback = { width: svg.clientWidth, height: svg.clientHeight };
  try {
    const bbox = svg.getBBox();
    if (bbox.width > 1 && bbox.height > 1) {
      return { width: bbox.width, height: bbox.height };
    }
    return fallback;
  } catch (failure) {
    void failure;
    return fallback;
  }
}

function diagramSize(svg: SVGSVGElement): { width: number; height: number } {
  const raw = svg.getAttribute("viewBox");
  if (raw !== null) {
    const parts = raw.trim().split(/[\s,]+/);
    if (parts.length === 4) {
      const width = Number(parts[2]);
      const height = Number(parts[3]);
      if (Number.isFinite(width) && Number.isFinite(height) && width > 1 && height > 1) {
        return { width, height };
      }
    }
  }
  return svgBox(svg);
}

function pinSvgLayout(svg: SVGSVGElement): { width: number; height: number } {
  const size = diagramSize(svg);
  svg.setAttribute("width", String(size.width));
  svg.setAttribute("height", String(size.height));
  svg.style.maxWidth = "none";
  svg.style.width = `${String(size.width)}px`;
  svg.style.height = `${String(size.height)}px`;
  return size;
}

function containSvgInHost(svg: SVGSVGElement): void {
  const size = diagramSize(svg);
  if (size.width < 1 || size.height < 1) {
    return;
  }
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.maxWidth = "100%";
  svg.style.maxHeight = "100%";
}

function paintShape(el: SVGElement, fill: string, stroke: string): void {
  const fillValue = fill.trim();
  const strokeValue = stroke.trim();
  if (fillValue.length === 0 || strokeValue.length === 0) {
    return;
  }
  el.style.setProperty("fill", fillValue, "important");
  el.style.setProperty("stroke", strokeValue, "important");
}

function paintText(el: SVGElement, fill: string): void {
  const fillValue = fill.trim();
  if (fillValue.length === 0) {
    return;
  }
  el.style.setProperty("fill", fillValue, "important");
  el.style.setProperty("color", fillValue, "important");
}

function restyleMermaidSvg(svg: SVGSVGElement): void {
  const nodeFill = LOTARU_MERMAID_COLORS.primaryColor;
  const nodeStroke = LOTARU_MERMAID_COLORS.nodeBorder;
  const noteFill = LOTARU_MERMAID_COLORS.noteBkgColor;
  const noteStroke = LOTARU_MERMAID_COLORS.noteBorderColor;
  const textFill = LOTARU_MERMAID_COLORS.primaryTextColor;
  const nodeShapes = svg.querySelectorAll(".node .label-container, .node polygon, .node circle, .node ellipse, .cluster rect");
  for (const shape of nodeShapes) {
    if (shape instanceof SVGElement) {
      paintShape(shape, nodeFill, nodeStroke);
    }
  }
  const notes = svg.querySelectorAll("rect.note");
  for (const note of notes) {
    if (note instanceof SVGElement) {
      paintShape(note, noteFill, noteStroke);
    }
  }
  const actors = svg.querySelectorAll("rect.actor");
  for (const actor of actors) {
    if (actor instanceof SVGElement) {
      paintShape(actor, nodeFill, nodeStroke);
    }
  }
  const texts = svg.querySelectorAll(".node tspan, .noteText, text.actor, .actor tspan");
  for (const label of texts) {
    if (label instanceof SVGElement) {
      paintText(label, textFill);
    }
  }
}

function fitSvgInHost(host: HTMLElement, svg: SVGSVGElement): { zoom: number; pan: Point } {
  const hostW = host.clientWidth;
  const hostH = host.clientHeight;
  const pad = 56;
  const box = pinSvgLayout(svg);
  if (hostW < 1 || hostH < 1 || box.width < 1 || box.height < 1) {
    return { zoom: 1, pan: { x: pad, y: pad } };
  }
  const nextZoom = clampZoom(Math.min((hostW - pad * 2) / box.width, (hostH - pad * 2) / box.height));
  return {
    zoom: nextZoom,
    pan: {
      x: (hostW - box.width * nextZoom) / 2,
      y: (hostH - box.height * nextZoom) / 2,
    },
  };
}

function bindBoardWheel(element: HTMLElement, refs: BoardRefs): () => void {
  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    const rect = element.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const currentZoom = refs.getZoom();
    const currentPan = refs.getPan();
    let factor = 0.92;
    if (event.deltaY < 0) {
      factor = 1.08;
    }
    const nextZoom = clampZoom(currentZoom * factor);
    const scale = nextZoom / currentZoom;
    refs.setPan({
      x: pointerX - (pointerX - currentPan.x) * scale,
      y: pointerY - (pointerY - currentPan.y) * scale,
    });
    refs.setZoom(nextZoom);
  }
  element.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    element.removeEventListener("wheel", onWheel);
  };
}

async function loadMermaid(): Promise<typeof import("mermaid").default> {
  const mermaidMod = await import("mermaid");
  const mermaid = mermaidMod.default;
  if (mermaidConfigured === true) {
    return mermaid;
  }
  mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    look: "neo",
    darkMode: true,
    htmlLabels: false,
    securityLevel: "strict",
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif",
    themeVariables: LOTARU_MERMAID_COLORS,
    flowchart: {
      theme: "base",
      look: "neo",
      curve: "basis",
      padding: 18,
      htmlLabels: false,
      useMaxWidth: false,
    },
    sequence: {
      theme: "base",
      look: "neo",
      useMaxWidth: false,
      actorMargin: 48,
      boxMargin: 8,
      messageMargin: 40,
    },
    class: { theme: "base", look: "neo" },
    er: { theme: "base", look: "neo" },
    state: { theme: "base", look: "neo" },
    requirement: { theme: "base", look: "neo" },
  });
  mermaidConfigured = true;
  return mermaid;
}

export function MermaidBoard(props: {
  body: string;
  mode: "board" | "preview";
  className?: string;
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(1);
  const panRef = useRef<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [panDrag, setPanDrag] = useState<PanDragState | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const source = mermaidSourceFromBody(props.body);

  zoomRef.current = zoom;
  panRef.current = pan;

  let extra = "";
  if (props.className !== undefined) {
    extra = props.className;
  }

  const applyFit = useCallback((): void => {
    const viewport = viewportRef.current;
    const host = hostRef.current;
    if (viewport === null || host === null) {
      return;
    }
    const svg = host.querySelector("svg");
    if (svg instanceof SVGSVGElement) {
      const fitted = fitSvgInHost(viewport, svg);
      setZoom(fitted.zoom);
      setPan(fitted.pan);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function draw(): Promise<void> {
      if (source.length === 0) {
        setBusy(false);
        setError("");
        if (hostRef.current !== null) {
          hostRef.current.replaceChildren();
        }
        return;
      }
      setBusy(true);
      setError("");
      const mermaid = await loadMermaid();
      const rendered = await mermaid.render(mermaidDomId(source), mermaidRenderSource(source));
      if (cancelled === true) {
        return;
      }
      const host = hostRef.current;
      if (host === null) {
        return;
      }
      host.innerHTML = rendered.svg;
      if (rendered.bindFunctions !== undefined) {
        rendered.bindFunctions(host);
      }
      const svg = host.querySelector("svg");
      if (svg instanceof SVGSVGElement) {
        restyleMermaidSvg(svg);
        if (props.mode === "preview") {
          containSvgInHost(svg);
        }
      }
      setBusy(false);
    }
    void draw().catch((failure) => {
      if (cancelled === true) {
        return;
      }
      setBusy(false);
      if (failure instanceof Error) {
        setError(caughtMessage(failure));
        return;
      }
      setError("Diagram could not be drawn");
    });
    return () => {
      cancelled = true;
    };
  }, [props.mode, source]);

  useEffect(() => {
    if (props.mode !== "board") {
      return;
    }
    if (busy === true || error.length > 0 || source.length === 0) {
      return;
    }
    applyFit();
  }, [applyFit, busy, error, props.mode, source]);

  useEffect(() => {
    if (props.mode !== "board") {
      return;
    }
    const viewport = viewportRef.current;
    if (viewport === null) {
      return;
    }
    return bindBoardWheel(viewport, {
      getZoom: () => zoomRef.current,
      getPan: () => panRef.current,
      setZoom,
      setPan,
    });
  }, [props.mode]);

  useEffect(() => {
    if (panDrag === null) {
      return;
    }
    const active = panDrag;
    return bindPanDrag(
      (event) => {
        setPan({
          x: active.panX + (event.clientX - active.startX),
          y: active.panY + (event.clientY - active.startY),
        });
      },
      () => {
        setPanDrag(null);
      },
    );
  }, [panDrag]);

  function startPan(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 && event.button !== 1) {
      return;
    }
    beginPanPointer(event);
    setPanDrag({
      startX: event.clientX,
      startY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    });
  }

  if (props.mode === "preview") {
    return (
      <div className={cn("relative flex h-full w-full items-center justify-center overflow-hidden", extra)}>
        {busy ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : null}
        {error.length > 0 ? (
          <p className="absolute inset-0 z-10 flex items-center justify-center px-3 text-center text-xs text-muted-foreground">
            {error}
          </p>
        ) : null}
        {source.length === 0 && busy === false && error.length === 0 ? (
          <p className="absolute inset-0 z-10 flex items-center justify-center px-3 text-center text-xs text-muted-foreground">
            No diagram yet
          </p>
        ) : null}
        <div
          ref={hostRef}
          className="mermaid-surface mermaid-surface-preview pointer-events-none h-full w-full p-3"
        />
      </div>
    );
  }

  return (
    <div className={cn("relative flex min-h-0 flex-1 flex-col overflow-hidden", extra)}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-2">
        <p className="text-xs text-muted-foreground">Drag to pan · Scroll to zoom</p>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => {
              setZoom(clampZoom(zoom * 0.9));
            }}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => {
              setZoom(clampZoom(zoom * 1.1));
            }}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={applyFit}>
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div
        ref={viewportRef}
        className="cutting-mat relative min-h-0 flex-1 cursor-grab overflow-hidden active:cursor-grabbing"
        onPointerDown={startPan}
      >
        {busy ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/40">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : null}
        {error.length > 0 ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center p-6">
            <p className="max-w-md text-center text-sm text-destructive">{error}</p>
          </div>
        ) : null}
        {source.length === 0 && busy === false && error.length === 0 ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center p-6">
            <p className="text-sm text-muted-foreground">No diagram source in this artifact</p>
          </div>
        ) : null}
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            transform: `translate(${String(pan.x)}px, ${String(pan.y)}px) scale(${String(zoom)})`,
          }}
        >
          <div ref={hostRef} className="mermaid-surface mermaid-surface-board p-2" />
        </div>
      </div>
    </div>
  );
}
