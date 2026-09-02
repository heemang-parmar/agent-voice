from agent_voice_worker.config import (
    ALLOWED_ADAPTERS,
    ALLOWED_REALTIME_MODELS,
    ALLOWED_REALTIME_VOICES,
    DEFAULT_AGENT_NAME,
    DEFAULT_AGENT_TIMEOUT_SECONDS,
    DEFAULT_REALTIME_MODEL,
    DEFAULT_REALTIME_VOICE,
    DEFAULT_SESSION_KEY,
    load_worker_config,
)

REQUIRED_ENV: dict[str, str] = {
    "LIVEKIT_URL": "wss://livekit.example.test",
    "LIVEKIT_API_KEY": "lk_key",
    "LIVEKIT_API_SECRET": "lk_secret",
    "OPENAI_API_KEY": "sk-test",
    "AGENT_VOICE_AGENT_ENDPOINT": "http://127.0.0.1:8642/v1",
}


def env(**overrides: str | None) -> dict[str, str]:
    merged = dict(REQUIRED_ENV)
    for key, value in overrides.items():
        if value is None:
            merged.pop(key, None)
        else:
            merged[key] = value
    return merged


def test_loads_a_valid_configuration_with_defaults() -> None:
    result = load_worker_config(env())
    assert result.ok is True
    assert result.ok
    config = result.config
    assert config.livekit_url == "wss://livekit.example.test"
    assert config.openai_api_key == "sk-test"
    assert config.realtime_model == DEFAULT_REALTIME_MODEL
    assert config.realtime_voice == DEFAULT_REALTIME_VOICE
    assert config.adapter == "openai-http"
    assert config.agent_endpoint == "http://127.0.0.1:8642/v1"
    assert config.agent_api_key is None
    assert config.agent_model == "default"
    assert config.session_key == DEFAULT_SESSION_KEY
    assert config.agent_timeout_seconds == DEFAULT_AGENT_TIMEOUT_SECONDS
    assert config.agent_name == DEFAULT_AGENT_NAME


def test_reports_missing_required_variables_by_name_only() -> None:
    result = load_worker_config(env(LIVEKIT_URL=None, LIVEKIT_API_KEY=None, OPENAI_API_KEY=None))
    assert result.ok is False
    assert not result.ok
    assert set(result.missing) == {"LIVEKIT_URL", "LIVEKIT_API_KEY", "OPENAI_API_KEY"}
    assert result.invalid == ()
    for value in REQUIRED_ENV.values():
        assert value not in str(result.missing)


def test_treats_blank_values_as_missing() -> None:
    result = load_worker_config(env(OPENAI_API_KEY="   "))
    assert result.ok is False
    assert not result.ok
    assert "OPENAI_API_KEY" in result.missing


def test_rejects_a_malformed_livekit_url() -> None:
    result = load_worker_config(env(LIVEKIT_URL="not-a-url"))
    assert result.ok is False
    assert not result.ok
    assert "LIVEKIT_URL" in result.invalid


def test_rejects_a_non_websocket_http_livekit_url_scheme() -> None:
    result = load_worker_config(env(LIVEKIT_URL="ftp://example.livekit.cloud"))
    assert result.ok is False
    assert not result.ok
    assert "LIVEKIT_URL" in result.invalid


def test_accepts_http_and_https_livekit_urls_too() -> None:
    for scheme in ("ws", "wss", "http", "https"):
        result = load_worker_config(env(LIVEKIT_URL=f"{scheme}://example.livekit.cloud"))
        assert result.ok is True


def test_rejects_a_realtime_model_outside_the_allowlist() -> None:
    result = load_worker_config(env(AGENT_VOICE_REALTIME_MODEL="not-a-real-model"))
    assert result.ok is False
    assert not result.ok
    assert "AGENT_VOICE_REALTIME_MODEL" in result.invalid


def test_accepts_every_allowlisted_realtime_model() -> None:
    for model in ALLOWED_REALTIME_MODELS:
        result = load_worker_config(env(AGENT_VOICE_REALTIME_MODEL=model))
        assert result.ok is True


def test_rejects_a_realtime_voice_outside_the_allowlist() -> None:
    result = load_worker_config(env(AGENT_VOICE_REALTIME_VOICE="not-a-real-voice"))
    assert result.ok is False
    assert not result.ok
    assert "AGENT_VOICE_REALTIME_VOICE" in result.invalid


def test_accepts_every_allowlisted_realtime_voice() -> None:
    for voice in ALLOWED_REALTIME_VOICES:
        result = load_worker_config(env(AGENT_VOICE_REALTIME_VOICE=voice))
        assert result.ok is True


def test_rejects_an_unsupported_adapter_selection() -> None:
    result = load_worker_config(env(AGENT_VOICE_ADAPTER="shell-exec"))
    assert result.ok is False
    assert not result.ok
    assert "AGENT_VOICE_ADAPTER" in result.invalid


def test_every_allowed_adapter_is_accepted() -> None:
    assert frozenset({"openai-http", "none"}) == ALLOWED_ADAPTERS
    for adapter in ALLOWED_ADAPTERS:
        overrides: dict[str, str | None] = {"AGENT_VOICE_ADAPTER": adapter}
        if adapter == "none":
            overrides["AGENT_VOICE_AGENT_ENDPOINT"] = None
        result = load_worker_config(env(**overrides))
        assert result.ok is True


def test_none_adapter_does_not_require_an_agent_endpoint() -> None:
    result = load_worker_config(env(AGENT_VOICE_ADAPTER="none", AGENT_VOICE_AGENT_ENDPOINT=None))
    assert result.ok is True
    assert result.ok
    assert result.config.adapter == "none"
    assert result.config.agent_endpoint is None


def test_openai_http_adapter_requires_an_agent_endpoint() -> None:
    result = load_worker_config(env(AGENT_VOICE_AGENT_ENDPOINT=None))
    assert result.ok is False
    assert not result.ok
    assert "AGENT_VOICE_AGENT_ENDPOINT" in result.missing


def test_rejects_a_non_http_agent_endpoint() -> None:
    result = load_worker_config(env(AGENT_VOICE_AGENT_ENDPOINT="ftp://agent.local/v1"))
    assert result.ok is False
    assert not result.ok
    assert "AGENT_VOICE_AGENT_ENDPOINT" in result.invalid


def test_agent_api_key_is_optional_and_trimmed() -> None:
    result = load_worker_config(env(AGENT_VOICE_AGENT_API_KEY="  secret-key  "))
    assert result.ok is True
    assert result.ok
    assert result.config.agent_api_key == "secret-key"


def test_rejects_an_out_of_range_agent_timeout() -> None:
    for value in ("0", "121", "-5", "not-a-number"):
        result = load_worker_config(env(AGENT_VOICE_AGENT_TIMEOUT_SECONDS=value))
        assert result.ok is False
        assert not result.ok
        assert "AGENT_VOICE_AGENT_TIMEOUT_SECONDS" in result.invalid


def test_accepts_the_boundary_agent_timeouts() -> None:
    for value in ("1", "120"):
        result = load_worker_config(env(AGENT_VOICE_AGENT_TIMEOUT_SECONDS=value))
        assert result.ok is True
        assert result.ok
        assert result.config.agent_timeout_seconds == int(value)


def test_rejects_a_malformed_agent_name() -> None:
    for value in ("-leading-dash", "has a space", "x" * 65):
        result = load_worker_config(env(AGENT_VOICE_AGENT_NAME=value))
        assert result.ok is False
        assert not result.ok
        assert "AGENT_VOICE_AGENT_NAME" in result.invalid


def test_blank_agent_name_falls_back_to_the_default_like_an_unset_one() -> None:
    result = load_worker_config(env(AGENT_VOICE_AGENT_NAME="   "))
    assert result.ok is True
    assert result.ok
    assert result.config.agent_name == DEFAULT_AGENT_NAME


def test_rejects_an_empty_session_key() -> None:
    result = load_worker_config(env(AGENT_VOICE_SESSION_KEY="   "))
    assert result.ok is False
    assert not result.ok
    assert "AGENT_VOICE_SESSION_KEY" in result.invalid


def test_missing_and_invalid_can_both_be_reported_together() -> None:
    result = load_worker_config(env(LIVEKIT_API_SECRET=None, AGENT_VOICE_REALTIME_MODEL="nope"))
    assert result.ok is False
    assert not result.ok
    assert "LIVEKIT_API_SECRET" in result.missing
    assert "AGENT_VOICE_REALTIME_MODEL" in result.invalid


def test_never_stringifies_a_config_object_with_secrets_in_repr() -> None:
    result = load_worker_config(env())
    assert result.ok
    dumped = repr(result.config)
    assert "sk-test" not in dumped
    assert "lk_secret" not in dumped
