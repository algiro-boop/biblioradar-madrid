from estimate_vectors import OUTPUT, render


def test_web_parity_vectors_match_python_engine():
    # Si falla: `uv run python tests/estimate_vectors.py` y `npm test` en web/.
    assert OUTPUT.read_text(encoding="utf-8") == render()
