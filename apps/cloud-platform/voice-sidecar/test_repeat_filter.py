from repeat_filter import is_repetitive_hallucination, sanitize_transcript


def test_blocks_tikpi_loop() -> None:
    text = " ".join(["tıpkı"] * 40)
    assert is_repetitive_hallucination(text) is True
    assert sanitize_transcript(text) == ""


def test_blocks_bir_kere_daha_loop() -> None:
    text = "Tepki vermek için " + " ".join(["bir kere daha"] * 30)
    assert is_repetitive_hallucination(text) is True


def test_blocks_altyazi_watermark() -> None:
    assert sanitize_transcript("Altyazı M.K.") == ""


def test_keeps_normal_turkish() -> None:
    text = "Olum her şey bir değil, nereden çıkarttın ya? Öyle bir şey demedik ya."
    assert is_repetitive_hallucination(text) is False
    assert sanitize_transcript(text) == text


if __name__ == "__main__":
    test_blocks_tikpi_loop()
    test_blocks_bir_kere_daha_loop()
    test_blocks_altyazi_watermark()
    test_keeps_normal_turkish()
    print("ok")
