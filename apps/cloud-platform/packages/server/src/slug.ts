/**
 * Slugs are how a feature mints a stable event id from a name someone typed, so
 * the same folding has to apply wherever that happens — rules and agents alike.
 */

const DIACRITICS = /[̀-ͯ]/g;

const TURKISH_LETTERS: Record<string, string> = {
  ı: "i",
  İ: "i",
  ğ: "g",
  Ğ: "g",
  ş: "s",
  Ş: "s",
  ç: "c",
  Ç: "c",
  ö: "o",
  Ö: "o",
  ü: "u",
  Ü: "u",
};

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const SLUG_MAX = 48;

export function slugifyName(name: string): string {
  let mapped = "";
  for (const char of name) {
    const replacement = TURKISH_LETTERS[char];
    if (replacement !== undefined) {
      mapped += replacement;
      continue;
    }
    mapped += char;
  }
  const ascii = mapped
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toLowerCase();
  const dashed = ascii.replace(/[^a-z0-9]+/g, "-");
  const trimmed = dashed.replace(/^-+/, "").replace(/-+$/, "");
  if (trimmed.length === 0) {
    return "";
  }
  if (trimmed.length <= SLUG_MAX) {
    return trimmed;
  }
  return trimmed.slice(0, SLUG_MAX).replace(/-+$/, "");
}
