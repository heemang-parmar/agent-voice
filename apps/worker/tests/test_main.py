from livekit.agents import WorkerOptions

from agent_voice_worker.main import main

VALID_ENV = {
    "LIVEKIT_URL": "wss://livekit.example.test",
    "LIVEKIT_API_KEY": "lk_key",
    "LIVEKIT_API_SECRET": "lk_secret-never-print",
    "OPENAI_API_KEY": "sk-test-never-print",
    "AGENT_VOICE_AGENT_ENDPOINT": "http://127.0.0.1:8642/v1",
}


def test_check_env_reports_names_only_without_starting_livekit() -> None:
    output: list[str] = []
    started: list[WorkerOptions] = []

    code = main(
        ["check-env"],
        env={"LIVEKIT_API_SECRET": "secret-never-print"},
        output=output.append,
        run_app=started.append,
    )

    assert code == 1
    assert started == []
    rendered = "\n".join(output)
    assert "LIVEKIT_URL" in rendered
    assert "LIVEKIT_API_KEY" in rendered
    assert "secret-never-print" not in rendered


def test_dev_hands_validated_worker_options_to_livekit() -> None:
    output: list[str] = []
    started: list[WorkerOptions] = []

    code = main(["dev"], env=VALID_ENV, output=output.append, run_app=started.append)

    assert code == 0
    assert output == []
    assert len(started) == 1
    assert started[0].agent_name == "agent-voice"


def test_start_rejects_invalid_config_without_starting_livekit() -> None:
    output: list[str] = []
    started: list[WorkerOptions] = []
    invalid = dict(VALID_ENV, LIVEKIT_URL="not-a-url")

    code = main(["start"], env=invalid, output=output.append, run_app=started.append)

    assert code == 1
    assert started == []
    assert "LIVEKIT_URL" in "\n".join(output)
    assert "not-a-url" not in "\n".join(output)


def test_unknown_command_is_rejected() -> None:
    output: list[str] = []
    started: list[WorkerOptions] = []

    code = main(["unknown"], env=VALID_ENV, output=output.append, run_app=started.append)

    assert code == 2
    assert started == []
    assert output == ["usage: agent_voice_worker.main {check-env|dev|start}"]
