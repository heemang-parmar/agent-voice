"""Bounded, name-only-on-failure configuration for the worker process.

Values are read from the environment once at startup. Failures report
variable *names* only — never values — so they are always safe to print or
log. Mirrors the shape of `apps/web/lib/server/env.ts`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal, TypeVar
from urllib.parse import urlsplit

Env = dict[str, str]

REQUIRED_ENV: tuple[str, ...] = (
    "LIVEKIT_URL",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
)

OPTIONAL_ENV: tuple[str, ...] = (
    "AGENT_VOICE_REALTIME_PROVIDER",
    "AGENT_VOICE_REALTIME_MODEL",
    "AGENT_VOICE_REALTIME_VOICE",
    "AGENT_VOICE_ADAPTER",
    "AGENT_VOICE_AGENT_ENDPOINT",
    "AGENT_VOICE_AGENT_API_KEY",
    "AGENT_VOICE_AGENT_MODEL",
    "AGENT_VOICE_SESSION_KEY",
    "AGENT_VOICE_AGENT_TIMEOUT_SECONDS",
    "AGENT_VOICE_AGENT_NAME",
)

AdapterName = Literal["openai-http", "none"]
RealtimeProvider = Literal["openai-realtime", "livekit-inference"]

ALLOWED_ADAPTERS: frozenset[AdapterName] = frozenset({"openai-http", "none"})
ALLOWED_REALTIME_PROVIDERS: frozenset[RealtimeProvider] = frozenset(
    {"openai-realtime", "livekit-inference"}
)

ALLOWED_REALTIME_MODELS: frozenset[str] = frozenset(
    {"gpt-realtime", "gpt-4o-realtime-preview", "gpt-4o-mini-realtime-preview"}
)

ALLOWED_REALTIME_VOICES: frozenset[str] = frozenset(
    {"marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"}
)

DEFAULT_REALTIME_MODEL = "gpt-realtime"
DEFAULT_REALTIME_VOICE = "marin"
DEFAULT_REALTIME_PROVIDER: RealtimeProvider = "openai-realtime"
INFERENCE_REALTIME_MODEL = "openai/gpt-4o-mini"
INFERENCE_REALTIME_VOICE = "rigel"
DEFAULT_ADAPTER: AdapterName = "openai-http"
DEFAULT_AGENT_MODEL = "default"
DEFAULT_SESSION_KEY = "agent-voice-local"
DEFAULT_AGENT_TIMEOUT_SECONDS = 60
DEFAULT_AGENT_NAME = "agent-voice"

MIN_AGENT_TIMEOUT_SECONDS = 1
MAX_AGENT_TIMEOUT_SECONDS = 120
MAX_SESSION_KEY_CHARS = 200

_AGENT_NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
_LIVEKIT_URL_SCHEMES = ("ws", "wss", "http", "https")


@dataclass(frozen=True, slots=True)
class WorkerConfig:
    livekit_url: str
    livekit_api_key: str = field(repr=False)
    livekit_api_secret: str = field(repr=False)
    openai_api_key: str | None = field(repr=False)
    realtime_provider: RealtimeProvider
    realtime_model: str
    realtime_voice: str
    adapter: AdapterName
    agent_endpoint: str | None
    agent_api_key: str | None = field(repr=False)
    agent_model: str
    session_key: str
    agent_timeout_seconds: int
    agent_name: str


@dataclass(frozen=True, slots=True)
class ConfigOk:
    config: WorkerConfig
    ok: Literal[True] = field(default=True, init=False)


@dataclass(frozen=True, slots=True)
class ConfigErr:
    missing: tuple[str, ...]
    invalid: tuple[str, ...]
    ok: Literal[False] = field(default=False, init=False)


ConfigResult = ConfigOk | ConfigErr

T = TypeVar("T")


def _read(env: Env, name: str) -> str | None:
    value = env.get(name)
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed if trimmed else None


def _is_livekit_url(value: str) -> bool:
    try:
        parsed = urlsplit(value)
    except ValueError:
        return False
    return parsed.scheme in _LIVEKIT_URL_SCHEMES and bool(parsed.hostname)


def _is_http_url(value: str) -> bool:
    try:
        parsed = urlsplit(value)
    except ValueError:
        return False
    return parsed.scheme in ("http", "https") and bool(parsed.hostname)


def _parse_int_in_range(raw: str, low: int, high: int) -> int | None:
    if not re.fullmatch(r"-?\d{1,9}", raw):
        return None
    value = int(raw)
    return value if low <= value <= high else None


def load_worker_config(env: Env) -> ConfigResult:
    missing: list[str] = []
    invalid: list[str] = []

    livekit_url = _read(env, "LIVEKIT_URL")
    if livekit_url is None:
        missing.append("LIVEKIT_URL")
    elif not _is_livekit_url(livekit_url):
        invalid.append("LIVEKIT_URL")

    livekit_api_key = _read(env, "LIVEKIT_API_KEY")
    if livekit_api_key is None:
        missing.append("LIVEKIT_API_KEY")

    livekit_api_secret = _read(env, "LIVEKIT_API_SECRET")
    if livekit_api_secret is None:
        missing.append("LIVEKIT_API_SECRET")

    raw_realtime_provider = _read(env, "AGENT_VOICE_REALTIME_PROVIDER") or DEFAULT_REALTIME_PROVIDER
    realtime_provider: RealtimeProvider | None = (
        raw_realtime_provider if raw_realtime_provider in ALLOWED_REALTIME_PROVIDERS else None
    )
    if realtime_provider is None:
        invalid.append("AGENT_VOICE_REALTIME_PROVIDER")

    openai_api_key = _read(env, "OPENAI_API_KEY")
    if realtime_provider != "livekit-inference" and openai_api_key is None:
        missing.append("OPENAI_API_KEY")

    default_model = (
        INFERENCE_REALTIME_MODEL
        if realtime_provider == "livekit-inference"
        else DEFAULT_REALTIME_MODEL
    )
    realtime_model = _read(env, "AGENT_VOICE_REALTIME_MODEL") or default_model
    allowed_models = (
        {INFERENCE_REALTIME_MODEL}
        if realtime_provider == "livekit-inference"
        else ALLOWED_REALTIME_MODELS
    )
    if realtime_model not in allowed_models:
        invalid.append("AGENT_VOICE_REALTIME_MODEL")

    default_voice = (
        INFERENCE_REALTIME_VOICE
        if realtime_provider == "livekit-inference"
        else DEFAULT_REALTIME_VOICE
    )
    realtime_voice = _read(env, "AGENT_VOICE_REALTIME_VOICE") or default_voice
    allowed_voices = (
        {INFERENCE_REALTIME_VOICE}
        if realtime_provider == "livekit-inference"
        else ALLOWED_REALTIME_VOICES
    )
    if realtime_voice not in allowed_voices:
        invalid.append("AGENT_VOICE_REALTIME_VOICE")

    raw_adapter = _read(env, "AGENT_VOICE_ADAPTER") or DEFAULT_ADAPTER
    adapter: AdapterName | None = raw_adapter if raw_adapter in ALLOWED_ADAPTERS else None
    if adapter is None:
        invalid.append("AGENT_VOICE_ADAPTER")

    agent_endpoint = _read(env, "AGENT_VOICE_AGENT_ENDPOINT")
    if adapter == "openai-http":
        if agent_endpoint is None:
            missing.append("AGENT_VOICE_AGENT_ENDPOINT")
        elif not _is_http_url(agent_endpoint):
            invalid.append("AGENT_VOICE_AGENT_ENDPOINT")
    else:
        agent_endpoint = None

    agent_api_key = _read(env, "AGENT_VOICE_AGENT_API_KEY")
    agent_model = _read(env, "AGENT_VOICE_AGENT_MODEL") or DEFAULT_AGENT_MODEL

    raw_session_key = env.get("AGENT_VOICE_SESSION_KEY")
    session_key = _read(env, "AGENT_VOICE_SESSION_KEY")
    session_key_invalid = (raw_session_key is not None and session_key is None) or (
        session_key is not None and len(session_key) > MAX_SESSION_KEY_CHARS
    )
    if session_key_invalid:
        invalid.append("AGENT_VOICE_SESSION_KEY")
    session_key = session_key or DEFAULT_SESSION_KEY

    raw_timeout = _read(env, "AGENT_VOICE_AGENT_TIMEOUT_SECONDS")
    if raw_timeout is None:
        agent_timeout_seconds: int | None = DEFAULT_AGENT_TIMEOUT_SECONDS
    else:
        agent_timeout_seconds = _parse_int_in_range(
            raw_timeout, MIN_AGENT_TIMEOUT_SECONDS, MAX_AGENT_TIMEOUT_SECONDS
        )
        if agent_timeout_seconds is None:
            invalid.append("AGENT_VOICE_AGENT_TIMEOUT_SECONDS")

    agent_name = _read(env, "AGENT_VOICE_AGENT_NAME") or DEFAULT_AGENT_NAME
    if not _AGENT_NAME_PATTERN.match(agent_name):
        invalid.append("AGENT_VOICE_AGENT_NAME")

    if (
        missing
        or invalid
        or livekit_url is None
        or livekit_api_key is None
        or livekit_api_secret is None
        or realtime_provider is None
        or (realtime_provider == "openai-realtime" and openai_api_key is None)
        or adapter is None
        or agent_timeout_seconds is None
    ):
        return ConfigErr(missing=tuple(missing), invalid=tuple(invalid))

    return ConfigOk(
        config=WorkerConfig(
            livekit_url=livekit_url,
            livekit_api_key=livekit_api_key,
            livekit_api_secret=livekit_api_secret,
            openai_api_key=openai_api_key,
            realtime_provider=realtime_provider,
            realtime_model=realtime_model,
            realtime_voice=realtime_voice,
            adapter=adapter,
            agent_endpoint=agent_endpoint,
            agent_api_key=agent_api_key,
            agent_model=agent_model,
            session_key=session_key,
            agent_timeout_seconds=agent_timeout_seconds,
            agent_name=agent_name,
        )
    )
