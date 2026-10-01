"""The PATH an agent is launched with.

A macOS app opened from Finder does not inherit the learner's terminal
environment: its PATH is `/usr/bin:/bin:/usr/sbin:/sbin`. The agents this
app launches live where the learner installed them — `npx` and `codex`
under nvm, `claude` under Homebrew — so a command that works in their
terminal fails here with "not found", which is the first thing a learner
would try.

So the PATH is read once from the learner's login shell, the way editors
that launch language servers do, and put ahead of the inherited one. A
shell that fails or hangs changes nothing.
"""

from __future__ import annotations

import os
import subprocess
from collections.abc import Callable
from functools import cache

__all__ = ["agent_path", "resolve_agent_path"]

# Delimits the value in the shell's output, since an interactive shell's
# startup files may print anything before or after it.
_MARKER = "__LN_PATH__"


def resolve_agent_path(
    inherited: str,
    *,
    shell: str,
    run: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> str:
    try:
        result = run(
            [shell, "-ilc", f'printf "{_MARKER}%s{_MARKER}" "$PATH"'],
            capture_output=True,
            text=True,
            timeout=5,
            stdin=subprocess.DEVNULL,
        )
    except (OSError, subprocess.SubprocessError):
        return inherited
    parts = (result.stdout or "").split(_MARKER)
    if len(parts) < 3 or not parts[1].strip():
        return inherited
    merged: list[str] = []
    for entry in [*parts[1].split(":"), *inherited.split(":")]:
        if entry and entry not in merged:
            merged.append(entry)
    return ":".join(merged)


@cache
def agent_path() -> str:
    """Resolved once per process: the login shell is slow to start."""

    return resolve_agent_path(
        os.environ.get("PATH", ""), shell=os.environ.get("SHELL") or "/bin/zsh"
    )
