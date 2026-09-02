"""Command-line entrypoint for the Agent Voice LiveKit worker."""

from __future__ import annotations

import os
import sys
from collections.abc import Callable, Mapping, Sequence

from livekit.agents import WorkerOptions, cli

from agent_voice_worker.config import ConfigErr, load_worker_config
from agent_voice_worker.entrypoint import build_worker_options

Output = Callable[[str], object]
RunApp = Callable[[WorkerOptions], object]
USAGE = "usage: agent_voice_worker.main {check-env|dev|start}"


def _report_config_error(error: ConfigErr, output: Output) -> None:
    """Print configuration variable names only; never include their values."""
    if error.missing:
        output(f"missing: {', '.join(error.missing)}")
    if error.invalid:
        output(f"invalid: {', '.join(error.invalid)}")


def main(
    argv: Sequence[str] | None = None,
    *,
    env: Mapping[str, str] | None = None,
    output: Output = print,
    run_app: RunApp = cli.run_app,
) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 1 or args[0] not in {"check-env", "dev", "start"}:
        output(USAGE)
        return 2

    result = load_worker_config(dict(os.environ if env is None else env))
    if not result.ok:
        _report_config_error(result, output)
        return 1

    if args[0] == "check-env":
        output("worker configuration: ok")
        return 0

    run_app(build_worker_options(result.config))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
