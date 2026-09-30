const FENCE_PATTERN = /```(?:mermaid)?[ \t]*\r?\n([\s\S]*?)```/gi;

type LotaruMermaidColors = {
  background: string;
  primaryColor: string;
  primaryTextColor: string;
  primaryBorderColor: string;
  secondaryColor: string;
  secondaryTextColor: string;
  secondaryBorderColor: string;
  tertiaryColor: string;
  tertiaryTextColor: string;
  tertiaryBorderColor: string;
  lineColor: string;
  textColor: string;
  mainBkg: string;
  nodeBkg: string;
  nodeBorder: string;
  nodeTextColor: string;
  clusterBkg: string;
  clusterBorder: string;
  titleColor: string;
  edgeLabelBackground: string;
  noteBkgColor: string;
  noteTextColor: string;
  noteBorderColor: string;
  actorBkg: string;
  actorBorder: string;
  actorTextColor: string;
  actorLineColor: string;
  signalColor: string;
  signalTextColor: string;
  labelBoxBkgColor: string;
  labelBoxBorderColor: string;
  labelTextColor: string;
  loopTextColor: string;
  activationBkgColor: string;
  activationBorderColor: string;
  sequenceNumberColor: string;
  errorBkgColor: string;
  errorTextColor: string;
  fontFamily: string;
};

export const LOTARU_MERMAID_COLORS: LotaruMermaidColors = {
  background: "#09090b",
  primaryColor: "#1c1d2a",
  primaryTextColor: "#f4f4f5",
  primaryBorderColor: "#3f4158",
  secondaryColor: "#15151c",
  secondaryTextColor: "#e4e4e7",
  secondaryBorderColor: "#3f3f4c",
  tertiaryColor: "#111118",
  tertiaryTextColor: "#d4d4d8",
  tertiaryBorderColor: "#2e2e3a",
  lineColor: "#8b8b98",
  textColor: "#e4e4e7",
  mainBkg: "#1c1d2a",
  nodeBkg: "#1c1d2a",
  nodeBorder: "#4c4e66",
  nodeTextColor: "#f4f4f5",
  clusterBkg: "#12121a",
  clusterBorder: "#3f4158",
  titleColor: "#f4f4f5",
  edgeLabelBackground: "#09090b",
  noteBkgColor: "#161622",
  noteTextColor: "#e4e4e7",
  noteBorderColor: "#3f4158",
  actorBkg: "#1c1d2a",
  actorBorder: "#4c4e66",
  actorTextColor: "#f4f4f5",
  actorLineColor: "#3f4158",
  signalColor: "#c4c4d0",
  signalTextColor: "#d4d4dc",
  labelBoxBkgColor: "#1c1d2a",
  labelBoxBorderColor: "#4c4e66",
  labelTextColor: "#f4f4f5",
  loopTextColor: "#c4c4d0",
  activationBkgColor: "#26263a",
  activationBorderColor: "#5c75d6",
  sequenceNumberColor: "#f4f4f5",
  errorBkgColor: "#3f1d1d",
  errorTextColor: "#fca5a5",
  fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif",
};

export function mermaidSourceFromBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    return "";
  }
  const fences = trimmed.matchAll(FENCE_PATTERN);
  for (const fence of fences) {
    const inner = fence[1];
    if (inner === undefined) {
      continue;
    }
    const source = inner.trim();
    if (source.length === 0) {
      continue;
    }
    return source;
  }
  return trimmed;
}

export function mermaidRenderSource(source: string): string {
  const trimmed = source.trim();
  if (trimmed.length === 0) {
    return "";
  }
  if (trimmed.startsWith("---")) {
    return trimmed;
  }
  const varLines: string[] = ["    darkMode: true"];
  const entries = Object.entries(LOTARU_MERMAID_COLORS);
  for (const entry of entries) {
    const key = entry[0];
    const hex = entry[1];
    varLines.push(`    ${key}: '${hex}'`);
  }
  const banner = ["---", "config:", "  theme: base", "  look: neo", "  themeVariables:", ...varLines, "---", ""].join(
    "\n",
  );
  return `${banner}${trimmed}`;
}
