"""Artifacts attached to a delegated action.

Artifact URLs come from the delegated agent and are untrusted. Only absolute
http(s) URLs without embedded credentials are accepted; everything else
(javascript:, data:, blob:, file:, relative paths) is rejected at the
protocol boundary so nothing downstream has to decide whether a link is
safe. Mirrors `packages/protocol/src/artifacts.ts`.
"""

from __future__ import annotations

import re
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from agent_voice_worker.protocol.envelope import IdStr, LabelStr
from agent_voice_worker.protocol.limits import LIMITS

_WHITESPACE = re.compile(r"\s")


def is_safe_artifact_url(value: str) -> bool:
    if len(value) == 0 or len(value) > LIMITS.max_url_chars:
        return False
    if _WHITESPACE.search(value):
        return False
    try:
        parsed = urlsplit(value)
    except ValueError:
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    if not parsed.netloc:
        return False
    if parsed.username is not None or parsed.password is not None:
        return False
    hostname = parsed.hostname
    return hostname is not None and len(hostname) > 0


def _check_artifact_url(value: str) -> str:
    if not is_safe_artifact_url(value):
        raise ValueError("artifact url must be an absolute http(s) url without credentials")
    return value


ArtifactUrlStr = Annotated[
    str, StringConstraints(max_length=LIMITS.max_url_chars), AfterValidator(_check_artifact_url)
]


class LinkArtifact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: IdStr
    title: LabelStr
    kind: Literal["link"]
    url: ArtifactUrlStr


class FileArtifact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: IdStr
    title: LabelStr
    kind: Literal["file"]
    url: ArtifactUrlStr
    mimeType: (
        Annotated[str, StringConstraints(min_length=1, max_length=LIMITS.max_label_chars)] | None
    ) = None
    bytes: Annotated[int, Field(ge=0)] | None = None


class TextArtifact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: IdStr
    title: LabelStr
    kind: Literal["text"]
    text: Annotated[str, StringConstraints(max_length=LIMITS.max_artifact_text_chars)]


Artifact = Annotated[LinkArtifact | FileArtifact | TextArtifact, Field(discriminator="kind")]
