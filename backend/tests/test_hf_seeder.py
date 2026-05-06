"""Unit tests for hf_seeder.classify_author() — no DB required."""

from app.services.hf_seeder import (
    KNOWN_COMMUNITY_AUTHORS,
    STANDARD_AUTHORS,
    classify_author,
)


# ── classify_author ───────────────────────────────────────────────────────────

def test_standard_author_meta():
    author, cls, label = classify_author("meta-llama/Llama-3.1-8B-Instruct")
    assert author == "meta-llama"
    assert cls == "standard"
    assert label == "Meta"


def test_standard_author_google():
    author, cls, label = classify_author("google/gemma-2-9b-it")
    assert author == "google"
    assert cls == "standard"
    assert label == "Google"


def test_standard_author_mistral():
    author, cls, label = classify_author("mistralai/Mistral-7B-Instruct-v0.3")
    assert author == "mistralai"
    assert cls == "standard"


def test_community_author_bartowski():
    author, cls, label = classify_author("bartowski/Llama-3.1-8B-GGUF")
    assert author == "bartowski"
    assert cls == "community"


def test_community_author_thebloke():
    author, cls, label = classify_author("TheBloke/Llama-2-7B-GGUF")
    assert cls == "community"


def test_private_author():
    author, cls, label = classify_author("some-random-user/my-custom-model")
    assert author == "some-random-user"
    assert cls == "private"
    assert label == "some-random-user"


def test_author_key_lookup_is_case_insensitive():
    # STANDARD_AUTHORS keys are lowercase; mixed-case org in repo_id should still match
    _, cls, _ = classify_author("Meta-Llama/Llama-3.1-8B")
    assert cls == "standard"


def test_no_slash_falls_back_to_private():
    author, cls, label = classify_author("bare-name")
    assert cls == "private"
    assert author == "bare-name"
    assert label == "bare-name"


def test_returns_three_tuple():
    result = classify_author("mistralai/Mistral-7B-Instruct-v0.3")
    assert len(result) == 3
    author, cls, label = result
    assert isinstance(author, str)
    assert isinstance(cls, str)
    assert isinstance(label, str)


def test_standard_author_url_not_in_result():
    # classify_author only returns (author, class, label) — URL is derived separately by the seeder
    _, _, label = classify_author("meta-llama/Llama-3.1-8B-Instruct")
    assert "http" not in label


# ── Vocabulary completeness ───────────────────────────────────────────────────

def test_all_standard_authors_have_non_empty_labels():
    for key, label in STANDARD_AUTHORS.items():
        assert label, f"STANDARD_AUTHORS[{key!r}] has an empty label"


def test_all_community_authors_have_non_empty_labels():
    for key, label in KNOWN_COMMUNITY_AUTHORS.items():
        assert label, f"KNOWN_COMMUNITY_AUTHORS[{key!r}] has an empty label"


def test_standard_and_community_keys_do_not_overlap():
    overlap = set(STANDARD_AUTHORS) & set(KNOWN_COMMUNITY_AUTHORS)
    assert not overlap, f"Keys in both dicts: {overlap}"
