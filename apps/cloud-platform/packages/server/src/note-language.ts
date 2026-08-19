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

export function edgeVoiceForLanguage(id: string): string {
  if (id === "tr") {
    return "tr-TR-EmelNeural";
  }
  if (id === "en") {
    return "en-US-JennyNeural";
  }
  if (id === "de") {
    return "de-DE-KatjaNeural";
  }
  if (id === "fr") {
    return "fr-FR-DeniseNeural";
  }
  if (id === "es") {
    return "es-ES-ElviraNeural";
  }
  if (id === "it") {
    return "it-IT-ElsaNeural";
  }
  if (id === "pt") {
    return "pt-BR-FranciscaNeural";
  }
  if (id === "ar") {
    return "ar-SA-ZariyahNeural";
  }
  if (id === "ru") {
    return "ru-RU-SvetlanaNeural";
  }
  if (id === "ja") {
    return "ja-JP-NanamiNeural";
  }
  if (id === "ko") {
    return "ko-KR-SunHiNeural";
  }
  if (id === "zh") {
    return "zh-CN-XiaoxiaoNeural";
  }
  return "en-US-JennyNeural";
}

export function ttsPreviewLine(language: string): string {
  if (language === "tr") {
    return "Merhaba güzel kardeşim. Yazım düzgün okunuyor mu?";
  }
  if (language === "en") {
    return "Hello. This is a short test of the selected voice.";
  }
  if (language === "de") {
    return "Hallo. Das ist ein kurzer Test der ausgewählten Stimme.";
  }
  if (language === "fr") {
    return "Bonjour. Ceci est un court test de la voix sélectionnée.";
  }
  if (language === "es") {
    return "Hola. Esta es una prueba breve de la voz seleccionada.";
  }
  if (language === "it") {
    return "Ciao. Questa è una breve prova della voce selezionata.";
  }
  if (language === "pt") {
    return "Olá. Este é um teste curto da voz selecionada.";
  }
  if (language === "ar") {
    return "مرحباً. هذا اختبار قصير للصوت المحدد.";
  }
  if (language === "ru") {
    return "Здравствуйте. Это короткий тест выбранного голоса.";
  }
  if (language === "ja") {
    return "こんにちは。選択した声の短いテストです。";
  }
  if (language === "ko") {
    return "안녕하세요. 선택한 목소리의 짧은 테스트입니다.";
  }
  if (language === "zh") {
    return "你好。这是所选声音的简短测试。";
  }
  return "Hello. This is a short test of the selected voice.";
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
