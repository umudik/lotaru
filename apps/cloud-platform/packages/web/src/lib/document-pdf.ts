import { lexer, type Token, type Tokens } from "marked";

export type PdfTextNode = {
  kind: "text";
  text: string;
  fontSize: number;
  bold: boolean;
};

export type PdfListNode = {
  kind: "ul" | "ol";
  items: string[];
};

export type PdfNode = PdfTextNode | PdfListNode;

type PdfMakeDoc = {
  createPdf: (definition: Record<string, unknown>) => {
    getBlob: (done: (blob: Blob) => void) => void;
  };
  addVirtualFileSystem: (fonts: unknown) => void;
};

function isHeading(token: Token): token is Tokens.Heading {
  return token.type === "heading";
}

function isParagraph(token: Token): token is Tokens.Paragraph {
  return token.type === "paragraph";
}

function isList(token: Token): token is Tokens.List {
  return token.type === "list";
}

function isCode(token: Token): token is Tokens.Code {
  return token.type === "code";
}

function isBlockquote(token: Token): token is Tokens.Blockquote {
  return token.type === "blockquote";
}

function headingSize(depth: number): number {
  if (depth <= 1) {
    return 20;
  }
  if (depth === 2) {
    return 16;
  }
  if (depth === 3) {
    return 13;
  }
  return 12;
}

function tokenPlain(token: Token): string {
  if ("text" in token) {
    const text = token.text;
    if (typeof text === "string" && text.length > 0) {
      return text;
    }
  }
  if ("raw" in token) {
    const raw = token.raw;
    if (typeof raw === "string") {
      return raw.trim();
    }
  }
  return "";
}

function listItemTexts(items: Tokens.ListItem[]): string[] {
  const texts: string[] = [];
  for (const item of items) {
    const line = item.text.trim();
    if (line.length === 0) {
      continue;
    }
    texts.push(line);
  }
  return texts;
}

function nodeFromToken(token: Token): PdfNode[] {
  if (token.type === "space" || token.type === "hr") {
    return [];
  }
  if (isHeading(token)) {
    const text = token.text.trim();
    if (text.length === 0) {
      return [];
    }
    return [{ kind: "text", text, fontSize: headingSize(token.depth), bold: true }];
  }
  if (isParagraph(token)) {
    const text = token.text.trim();
    if (text.length === 0) {
      return [];
    }
    return [{ kind: "text", text, fontSize: 11, bold: false }];
  }
  if (isCode(token)) {
    const text = token.text.trim();
    if (text.length === 0) {
      return [];
    }
    return [{ kind: "text", text, fontSize: 9, bold: false }];
  }
  if (isList(token)) {
    const items = listItemTexts(token.items);
    if (items.length === 0) {
      return [];
    }
    if (token.ordered === true) {
      return [{ kind: "ol", items }];
    }
    return [{ kind: "ul", items }];
  }
  if (isBlockquote(token)) {
    const nested: PdfNode[] = [];
    for (const child of token.tokens) {
      for (const node of nodeFromToken(child)) {
        nested.push(node);
      }
    }
    return nested;
  }
  const fallback = tokenPlain(token);
  if (fallback.length === 0) {
    return [];
  }
  return [{ kind: "text", text: fallback, fontSize: 11, bold: false }];
}

export function markdownToPdfNodes(markdown: string): PdfNode[] {
  const source = markdown.trim();
  if (source.length === 0) {
    return [];
  }
  const tokens = lexer(source, { gfm: true, breaks: true });
  const nodes: PdfNode[] = [];
  for (const token of tokens) {
    for (const node of nodeFromToken(token)) {
      nodes.push(node);
    }
  }
  return nodes;
}

export function documentPdfFilename(title: string, when: Date): string {
  const raw = title.trim();
  let stem = "document";
  if (raw.length > 0) {
    stem = raw;
  }
  const cleaned = stem
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  let safe = cleaned;
  if (safe.length === 0) {
    safe = "document";
  }
  if (safe.length > 80) {
    safe = safe.slice(0, 80);
  }
  const year = String(when.getFullYear());
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return `${safe}-${year}-${month}-${day}.pdf`;
}

function pdfMakeContent(title: string, nodes: readonly PdfNode[]): unknown[] {
  const content: unknown[] = [
    { text: title, fontSize: 22, bold: true, margin: [0, 0, 0, 12] },
  ];
  for (const node of nodes) {
    if (node.kind === "text") {
      content.push({
        text: node.text,
        fontSize: node.fontSize,
        bold: node.bold,
        margin: [0, 0, 0, 8],
      });
      continue;
    }
    if (node.kind === "ol") {
      content.push({ ol: node.items, margin: [0, 0, 0, 8] });
      continue;
    }
    content.push({ ul: node.items, margin: [0, 0, 0, 8] });
  }
  return content;
}

function isPdfMakeDoc(value: unknown): value is PdfMakeDoc {
  if (value === null) {
    return false;
  }
  if (typeof value !== "object") {
    return false;
  }
  if ("addVirtualFileSystem" in value !== true) {
    return false;
  }
  if ("createPdf" in value !== true) {
    return false;
  }
  const candidate = value as PdfMakeDoc;
  if (typeof candidate.addVirtualFileSystem !== "function") {
    return false;
  }
  if (typeof candidate.createPdf !== "function") {
    return false;
  }
  return true;
}

async function loadPdfMake(): Promise<PdfMakeDoc> {
  const pdfModule = await import("pdfmake/build/pdfmake");
  const fontModule = await import("pdfmake/build/vfs_fonts");
  let pdfMake: unknown = pdfModule;
  if ("default" in pdfModule) {
    pdfMake = pdfModule.default;
  }
  if (isPdfMakeDoc(pdfMake) !== true) {
    throw new Error("PDF engine missing");
  }
  pdfMake.addVirtualFileSystem(fontModule);
  if ("default" in fontModule) {
    pdfMake.addVirtualFileSystem(fontModule.default);
  }
  return pdfMake;
}

function blobFromDefinition(pdfMake: PdfMakeDoc, definition: Record<string, unknown>): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      const pdf = pdfMake.createPdf(definition);
      pdf.getBlob((blob) => {
        if (blob.type !== "application/pdf" && blob.size < 8) {
          reject(new Error("PDF blob empty"));
          return;
        }
        resolve(blob);
      });
    } catch (err) {
      if (err instanceof Error) {
        reject(err);
        return;
      }
      reject(new Error("PDF build failed"));
    }
  });
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(href);
  }, 1500);
}

export async function downloadDocumentPdf(input: {
  title: string;
  body: string;
  when: Date;
}): Promise<Blob> {
  const filename = documentPdfFilename(input.title, input.when);
  const nodes = markdownToPdfNodes(input.body);
  const pdfMake = await loadPdfMake();
  const definition = {
    info: { title: input.title, creator: "Lotaru" },
    pageSize: "A4",
    pageMargins: [48, 48, 48, 48],
    defaultStyle: { font: "Roboto", fontSize: 11, lineHeight: 1.25 },
    content: pdfMakeContent(input.title, nodes),
  };
  const blob = await blobFromDefinition(pdfMake, definition);
  triggerBlobDownload(blob, filename);
  return blob;
}
