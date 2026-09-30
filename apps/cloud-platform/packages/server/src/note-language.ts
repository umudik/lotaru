export type TargetLanguage = {
  id: string;
  label: string;
};

export const TARGET_LANGUAGES: readonly TargetLanguage[] = [
  { id: "tr", label: "Turkish" },
  { id: "en", label: "English" },
  { id: "de", label: "German" },
  { id: "fr", label: "French" },
  { id: "es", label: "Spanish" },
  { id: "it", label: "Italian" },
  { id: "pt", label: "Portuguese" },
  { id: "ar", label: "Arabic" },
  { id: "ru", label: "Russian" },
  { id: "ja", label: "Japanese" },
  { id: "ko", label: "Korean" },
  { id: "zh", label: "Chinese" },
];

export function languageLabel(id: string): string {
  for (const lang of TARGET_LANGUAGES) {
    if (lang.id === id) {
      return lang.label;
    }
  }
  return id;
}

export function titleFromBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    return "Untitled note";
  }
  const lines = trimmed.split(/\r?\n/);
  const first = lines[0];
  if (first === undefined) {
    return "Untitled note";
  }
  const compact = first.trim();
  if (compact.length === 0) {
    return "Untitled note";
  }
  if (compact.length <= 80) {
    return compact;
  }
  return `${compact.slice(0, 77)}...`;
}
