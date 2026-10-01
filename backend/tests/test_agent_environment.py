"""An agent launched from the desktop app finds what the learner's terminal finds."""

from __future__ import annotations

import subprocess

from service.agent import environment


def _runner(stdout: str = "", *, fails: bool = False):
    def run(argv, **kwargs):
        if fails:
            raise subprocess.TimeoutExpired(argv, 5)
        return subprocess.CompletedProcess(argv, 0, stdout=stdout, stderr="")

    return run


def test_the_login_shell_path_comes_first_and_nothing_is_lost():
    path = environment.resolve_agent_path(
        "/usr/bin:/bin",
        shell="/bin/zsh",
        run=_runner("noise from .zshrc\n__LN_PATH__/Users/a/.nvm/bin:/opt/homebrew/bin:/usr/bin__LN_PATH__"),
    )
    assert path == "/Users/a/.nvm/bin:/opt/homebrew/bin:/usr/bin:/bin"


def test_a_shell_that_fails_or_hangs_leaves_the_path_as_it_was():
    assert environment.resolve_agent_path("/usr/bin:/bin", shell="/bin/zsh", run=_runner(fails=True)) == "/usr/bin:/bin"
    assert environment.resolve_agent_path("/usr/bin:/bin", shell="/bin/zsh", run=_runner("no marker")) == "/usr/bin:/bin"
