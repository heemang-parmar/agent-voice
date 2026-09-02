from agent_voice_worker.protocol.limits import LIMITS, PROTOCOL_VERSION, TOPICS


def test_protocol_version_is_one() -> None:
    assert PROTOCOL_VERSION == 1


def test_limits_match_the_shared_contract() -> None:
    assert LIMITS.max_event_bytes == 12 * 1024
    assert LIMITS.max_id_chars == 64
    assert LIMITS.max_label_chars == 200
    assert LIMITS.max_text_chars == 4000
    assert LIMITS.max_message_chars == 1000
    assert LIMITS.max_url_chars == 2048
    assert LIMITS.max_artifacts == 20
    assert LIMITS.max_artifact_text_chars == 4000


def test_topics_match_the_livekit_transport_binding() -> None:
    assert TOPICS.events == "agent-voice.events.v1"
    assert TOPICS.commands == "agent-voice.commands.v1"
