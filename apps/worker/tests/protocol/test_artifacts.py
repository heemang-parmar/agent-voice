import pytest
from pydantic import TypeAdapter, ValidationError

from agent_voice_worker.protocol.artifacts import (
    Artifact,
    FileArtifact,
    LinkArtifact,
    is_safe_artifact_url,
)
from agent_voice_worker.protocol.limits import LIMITS

artifact_adapter: TypeAdapter[Artifact] = TypeAdapter(Artifact)


@pytest.mark.parametrize(
    "url",
    ["https://example.com/report", "http://example.com/x?a=1", "https://example.com:8443/a"],
)
def test_is_safe_artifact_url_accepts_absolute_http_urls(url: str) -> None:
    assert is_safe_artifact_url(url) is True


@pytest.mark.parametrize(
    "url",
    [
        "",
        "javascript:alert(1)",
        "data:text/plain;base64,aGk=",
        "blob:https://example.com/x",
        "file:///etc/passwd",
        "relative/path",
        "https://user:pass@example.com/",
        "https:// example.com",
        "x" * 2049,
    ],
)
def test_is_safe_artifact_url_rejects_unsafe_or_oversized_urls(url: str) -> None:
    assert is_safe_artifact_url(url) is False


def test_link_artifact_round_trips() -> None:
    artifact = artifact_adapter.validate_python(
        {"id": "art_1", "title": "Report", "kind": "link", "url": "https://example.com/report"}
    )
    assert isinstance(artifact, LinkArtifact)
    assert artifact.kind == "link"


def test_link_artifact_rejects_unsafe_url() -> None:
    with pytest.raises(ValidationError):
        artifact_adapter.validate_python(
            {"id": "art_1", "title": "Report", "kind": "link", "url": "javascript:alert(1)"}
        )


def test_file_artifact_allows_optional_mime_and_bytes() -> None:
    artifact = artifact_adapter.validate_python(
        {
            "id": "art_1",
            "title": "export.csv",
            "kind": "file",
            "url": "https://example.com/export.csv",
            "mimeType": "text/csv",
            "bytes": 128,
        }
    )
    assert isinstance(artifact, FileArtifact)
    assert artifact.bytes == 128


def test_text_artifact_bounds_inline_text() -> None:
    with pytest.raises(ValidationError):
        artifact_adapter.validate_python(
            {
                "id": "art_1",
                "title": "note",
                "kind": "text",
                "text": "x" * (LIMITS.max_artifact_text_chars + 1),
            }
        )


def test_artifact_rejects_unknown_kind() -> None:
    with pytest.raises(ValidationError):
        artifact_adapter.validate_python(
            {"id": "art_1", "title": "note", "kind": "video", "url": "https://example.com/v"}
        )


def test_artifact_rejects_unknown_fields() -> None:
    with pytest.raises(ValidationError):
        artifact_adapter.validate_python(
            {
                "id": "art_1",
                "title": "note",
                "kind": "text",
                "text": "hi",
                "extra": "nope",
            }
        )
