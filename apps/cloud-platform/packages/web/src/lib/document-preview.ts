export type DocumentPreviewKind = "text" | "image" | "pdf" | "binary";

const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "json",
  "xml",
  "html",
  "htm",
  "csv",
  "log",
  "svg",
]);

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

function extensionOf(filename: string): string {
  const trimmed = filename.trim().toLowerCase();
  const dot = trimmed.lastIndexOf(".");
  if (dot < 0 || dot === trimmed.length - 1) {
    return "";
  }
  return trimmed.slice(dot + 1);
}

export function documentPreviewKind(mimeType: string, filename: string): DocumentPreviewKind {
  const mime = mimeType.trim().toLowerCase();
  const ext = extensionOf(filename);
  if (mime === "application/pdf" || ext === "pdf") {
    return "pdf";
  }
  if (mime.startsWith("image/") || IMAGE_EXTENSIONS.has(ext)) {
    return "image";
  }
  if (ext === "docx" || ext === "xlsx" || ext === "pptx" || ext === "doc" || ext === "xls" || ext === "ppt" || ext === "zip") {
    return "binary";
  }
  if (mime.startsWith("text/") || mime === "application/json" || mime === "application/xml" || mime === "text/xml" || TEXT_EXTENSIONS.has(ext)) {
    return "text";
  }
  return "binary";
}
