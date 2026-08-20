JUNK_PHRASES = (
    "altyazı m.k.",
    "altyazi m.k.",
    "izlediğiniz için teşekkür ederim",
    "izlediginiz icin tesekkur ederim",
    "thanks for watching",
    "subscribe",
)


def normalize_spaces(text: str) -> str:
    return " ".join(text.split()).strip()


def max_consecutive_ngram_repeats(words: list[str], size: int) -> int:
    if size < 1 or len(words) < size * 2:
        return 0
    best = 1
    index = 0
    while index + size <= len(words):
        gram = tuple(words[index : index + size])
        runs = 1
        cursor = index + size
        while cursor + size <= len(words):
            nxt = tuple(words[cursor : cursor + size])
            if nxt != gram:
                break
            runs += 1
            cursor += size
        if runs > best:
            best = runs
        index += 1
    return best


def is_junk_caption(text: str) -> bool:
    lowered = normalize_spaces(text).lower()
    if len(lowered) == 0:
        return True
    for phrase in JUNK_PHRASES:
        if lowered == phrase:
            return True
        if len(lowered) <= len(phrase) + 8 and phrase in lowered:
            return True
    return False


def is_repetitive_hallucination(text: str) -> bool:
    cleaned = normalize_spaces(text)
    if is_junk_caption(cleaned):
        return True
    words = cleaned.lower().split()
    if len(words) < 6:
        return False
    unique = len(set(words))
    if len(words) >= 10 and unique / len(words) <= 0.28:
        return True
    for size in (1, 2, 3, 4):
        if max_consecutive_ngram_repeats(words, size) >= 5:
            return True
    return False


def sanitize_transcript(text: str) -> str:
    cleaned = normalize_spaces(text)
    if len(cleaned) == 0:
        return ""
    if is_repetitive_hallucination(cleaned):
        return ""
    return cleaned
