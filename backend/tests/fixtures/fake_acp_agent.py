"""A fake ACP agent: newline-delimited JSON-RPC 2.0 on stdio.

It stands in for `codex-acp` / `claude-agent-acp` so the client and the
supervisor are tested against a real subprocess and a real pipe — the parts
that break — without spending anyone's subscription. It implements exactly the
subset the client uses, and each misbehaviour a real agent is capable of is a
flag, so a test names the failure it exercises.

Standard library only: it is launched as `sys.executable fake_acp_agent.py`,
and must not depend on anything the backend's environment happens to have.

A prompt normally answers with `--chunks` text chunks, `"chunk 0 "`,
`"chunk 1 "`, … . A prompt whose text is exactly `recall` instead answers with
one chunk, `"previously: <earlier prompts joined by ' | '>"` — the property
the spike measured on real agents, made checkable after a process restart when
`--sessions-dir` persists sessions.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

PROTOCOL_VERSION = 1


class FakeAgent:
    def __init__(self, options: argparse.Namespace) -> None:
        self.options = options
        self.write_lock = threading.Lock()
        self.sessions: dict[str, dict] = {}
        self.cancelled: dict[str, threading.Event] = {}
        self.mcp: dict[str, list] = {}
        self.next_id = 0
        self.pending: dict[int, dict] = {}
        self.pending_ready: dict[int, threading.Event] = {}
        self.children: list[subprocess.Popen] = []

    # --- wire ----------------------------------------------------------

    def send(self, message: dict) -> None:
        line = json.dumps({"jsonrpc": "2.0", **message}) + "\n"
        with self.write_lock:
            sys.stdout.write(line)
            sys.stdout.flush()

    def respond(self, request_id, result=None, error=None) -> None:
        if error is not None:
            self.send({"id": request_id, "error": error})
        else:
            self.send({"id": request_id, "result": result})

    def update(self, session_id: str, update: dict) -> None:
        self.send(
            {"method": "session/update", "params": {"sessionId": session_id, "update": update}}
        )

    def request(self, method: str, params: dict) -> dict:
        """Agent → client request; blocks the turn until the client answers."""

        with self.write_lock:
            self.next_id += 1
            request_id = f"agent-{self.next_id}"
        ready = threading.Event()
        self.pending_ready[request_id] = ready
        self.send({"id": request_id, "method": method, "params": params})
        ready.wait()
        return self.pending.pop(request_id)

    # --- sessions ------------------------------------------------------

    def session_path(self, session_id: str) -> Path | None:
        if self.options.sessions_dir is None:
            return None
        return Path(self.options.sessions_dir) / f"{session_id}.json"

    def save(self, session_id: str) -> None:
        path = self.session_path(session_id)
        if path is not None:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(self.sessions[session_id]))

    def restore(self, session_id: str) -> dict | None:
        if session_id in self.sessions:
            return self.sessions[session_id]
        path = self.session_path(session_id)
        if path is None or not path.exists():
            return None
        return json.loads(path.read_text())

    # --- methods -------------------------------------------------------

    def initialize(self, request_id, params) -> None:
        if self.options.broken_negotiation:
            self.respond(request_id, error={"code": -32603, "message": "fake negotiation failure"})
            return
        auth_methods = []
        if self.options.unauthenticated:
            auth_methods = [
                {
                    "id": "fake-login",
                    "name": "Log in with Fake",
                    "description": "Run `fake login` in a terminal",
                }
            ]
        self.respond(
            request_id,
            {
                "protocolVersion": self.options.protocol_version,
                "agentCapabilities": {
                    "loadSession": not self.options.no_load_session,
                    "promptCapabilities": {"image": False},
                },
                "agentInfo": {"name": "fake-acp-agent", "title": os.environ.get("FAKE_ACP_TITLE", "Fake Agent"), "version": "0.0.1"},
                "authMethods": auth_methods,
            },
        )

    def session_new(self, request_id, params) -> None:
        if self.options.unauthenticated:
            self.respond(request_id, error={"code": -32000, "message": "Authentication required"})
            return
        session_id = f"fake-{uuid.uuid4().hex[:12]}"
        self.sessions[session_id] = {"cwd": params.get("cwd"), "history": []}
        # Held in memory only, like a real agent: a loaded session is handed
        # its servers — and a fresh credential — again.
        self.mcp[session_id] = params.get("mcpServers") or []
        self.save(session_id)
        self.respond(request_id, {"sessionId": session_id})

    def session_load(self, request_id, params) -> None:
        if self.options.no_load_session:
            self.respond(request_id, error={"code": -32601, "message": "Method not found"})
            return
        session_id = params.get("sessionId")
        session = self.restore(session_id)
        if session is None:
            self.respond(request_id, error={"code": -32002, "message": "Session not found"})
            return
        self.sessions[session_id] = session
        self.mcp[session_id] = params.get("mcpServers") or []
        # Real agents replay the whole history while loading; a client that
        # forwarded it would duplicate the conversation.
        for text in session["history"]:
            self.update(
                session_id,
                {"sessionUpdate": "user_message_chunk", "content": {"type": "text", "text": text}},
            )
            self.update(
                session_id,
                {
                    "sessionUpdate": "agent_message_chunk",
                    "content": {"type": "text", "text": f"replayed answer to {text}"},
                },
            )
        self.respond(request_id, None)

    def session_prompt(self, request_id, params) -> None:
        session_id = params.get("sessionId")
        session = self.sessions.get(session_id)
        if session is None:
            self.respond(request_id, error={"code": -32002, "message": "Session not found"})
            return
        text = "".join(
            block.get("text", "") for block in params.get("prompt", []) if block.get("type") == "text"
        )
        cancelled = threading.Event()
        self.cancelled[session_id] = cancelled
        threading.Thread(
            target=self.run_turn, args=(request_id, session_id, session, text, cancelled), daemon=True
        ).start()

    def call_mcp_tool(self, session_id, line: str) -> str:
        """`mcp:<tool> <json args>` — call a tool on the session's MCP server.

        Reports the call as a `tool_call` the way real agents do, and answers
        with the tool's text result (or the HTTP status on refusal).
        """

        import urllib.error
        import urllib.request

        name, _, raw_args = line[len("mcp:"):].partition(" ")
        arguments = json.loads(raw_args) if raw_args.strip() else {}
        servers = self.mcp.get(session_id) or []
        if not servers:
            return "no mcp server"
        server = servers[0]
        call_id = f"call-{uuid.uuid4().hex[:8]}"
        self.update(session_id, {"sessionUpdate": "tool_call", "toolCallId": call_id,
                                 "title": f"mcp.{server['name']}.{name}", "kind": "other", "status": "pending"})
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                           "params": {"name": name, "arguments": arguments}}).encode()
        request = urllib.request.Request(server["url"], data=body, method="POST")
        request.add_header("content-type", "application/json")
        request.add_header("accept", "application/json, text/event-stream")
        for header in server.get("headers", []):
            request.add_header(header["name"], header["value"])
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                result = json.loads(response.read())["result"]
            text = "".join(block.get("text", "") for block in result.get("content", []))
            status = "failed" if result.get("isError") else "completed"
        except urllib.error.HTTPError as error:
            text, status = f"http {error.code}", "failed"
        self.update(session_id, {"sessionUpdate": "tool_call_update", "toolCallId": call_id, "status": status})
        return text

    def run_turn(self, request_id, session_id, session, text, cancelled) -> None:
        options = self.options
        # Always first: a kind no client knows, which must be ignored.
        self.update(session_id, {"sessionUpdate": "some_future_kind", "whatever": [1, 2, 3]})

        if options.hang:
            self.update(
                session_id,
                {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "hanging "}},
            )
            while True:
                time.sleep(3600)

        if options.tools:
            self.update(session_id, {"sessionUpdate": "agent_thought_chunk", "content": {"type": "text", "text": "thinking"}})
            self.update(session_id, {"sessionUpdate": "plan", "entries": [{"content": "Read notes", "priority": "high", "status": "pending"}]})
            self.update(session_id, {"sessionUpdate": "tool_call", "toolCallId": "call-1", "title": "Read notes.md", "kind": "read", "status": "pending"})
            self.update(session_id, {"sessionUpdate": "tool_call_update", "toolCallId": "call-1", "status": "completed"})
            self.update(session_id, {"sessionUpdate": "usage_update", "used": 100, "size": 1000})

        if options.request_permission:
            answer = self.request(
                "session/request_permission",
                {
                    "sessionId": session_id,
                    "toolCall": {"toolCallId": "call-perm", "title": "Write notes.md", "kind": "edit", "status": "pending"},
                    "options": [
                        {"optionId": "allow", "name": "Allow", "kind": "allow_once"},
                        {"optionId": "reject", "name": "Reject", "kind": "reject_once"},
                    ],
                },
            )
            outcome = (answer.get("result") or {}).get("outcome", {}).get("outcome")
            self.update(session_id, {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": f"permission {outcome} "}})

        if options.unexpected_request:
            answer = self.request("fs/read_text_file", {"sessionId": session_id, "path": "/etc/hosts"})
            code = (answer.get("error") or {}).get("code")
            self.update(session_id, {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": f"fs error {code} "}})

        last_line = text.strip().splitlines()[-1] if text.strip() else ""
        if "`add_question`" in text and "multiple_choice" in text and "The learner asked:" in text:
            # A /quiz command, answered the way the measured agents did: one
            # tool call per question, then a pointer rather than the questions.
            for prompt in ("Which builds a list from an iterable?", "What does [x * 2 for x in [1, 2]] give?"):
                # Not `options`: that name is this function's flags.
                choices = [{"text": "a comprehension" if "builds" in prompt else "[2, 4]", "correct": True},
                           {"text": "a decorator" if "builds" in prompt else "[1, 2]", "correct": False}]
                self.call_mcp_tool(session_id, "mcp:add_question " + json.dumps(
                    {"prompt": prompt, "kind": "multiple_choice", "options": choices}))
            chunks = ["Two questions are in the Quiz panel."]
        elif "`add_code_exercise`" in text and "The learner asked:" in text:
            self.call_mcp_tool(session_id, "mcp:add_code_exercise " + json.dumps(
                {"prompt": "Print the sum of numbers.", "starter_code": "numbers = [1, 2, 3]\n", "expected_output": "6"}))
            chunks = ["The exercise is in the Code panel."]
        elif last_line == "read-solution":
            # Reads the learner's mirrored solution with its own file access.
            solutions = sorted(Path(session["cwd"]).glob("practice/*/solution.py"))
            chunks = ["solution: " + (solutions[0].read_text() if solutions else "none")]
        elif last_line.startswith("mcp:"):
            chunks = [self.call_mcp_tool(session_id, last_line)]
        elif text == "recall":
            chunks = ["previously: " + " | ".join(session["history"])]
        else:
            chunks = [f"chunk {i} " for i in range(options.chunks)]

        for index, chunk in enumerate(chunks):
            if cancelled.is_set():
                break
            if options.crash_mid_turn and index == max(1, len(chunks) // 2):
                os._exit(3)
            self.update(session_id, {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": chunk}})
            if options.delay:
                cancelled.wait(options.delay)
        if options.crash_mid_turn:
            os._exit(3)

        if text != "recall":
            session["history"].append(text)
            self.save(session_id)

        stop_reason = "cancelled" if cancelled.is_set() else options.stop_reason
        self.respond(
            request_id,
            {
                "stopReason": stop_reason,
                "usage": {"inputTokens": 11, "outputTokens": 7, "totalTokens": 18},
            },
        )

    def session_cancel(self, params) -> None:
        event = self.cancelled.get(params.get("sessionId"))
        if event is not None:
            event.set()

    # --- loop ----------------------------------------------------------

    def spawn_child(self) -> None:
        # A long-lived grandchild, as an `npx` wrapper leaves behind: it must
        # die with the group, not be orphaned.
        tag = self.options.tag or ""
        child = subprocess.Popen(
            [sys.executable, "-c", "import time, sys; time.sleep(600)", "fake-acp-child", tag],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self.children.append(child)

    def serve(self) -> None:
        if self.options.stderr_noise:
            # More than a pipe buffer holds: a client that never drains
            # stderr would block this write, and the agent with it.
            line = "x" * 1023 + "\n"
            for _ in range(self.options.stderr_noise):
                sys.stderr.write(line)
            sys.stderr.flush()
        if self.options.spawn_child:
            self.spawn_child()
        if self.options.pid_file:
            pids = [os.getpid(), *(child.pid for child in self.children)]
            Path(self.options.pid_file).write_text(json.dumps(pids))
        if self.options.exit_immediately:
            sys.stderr.write("fake agent: refusing to start\n")
            sys.stderr.flush()
            sys.exit(2)

        handlers = {
            "initialize": self.initialize,
            "session/new": self.session_new,
            "session/load": self.session_load,
            "session/prompt": self.session_prompt,
        }
        for raw in sys.stdin:
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                continue
            method = message.get("method")
            if method is None:  # a response to one of our requests
                request_id = message.get("id")
                ready = self.pending_ready.pop(request_id, None)
                if ready is not None:
                    self.pending[request_id] = message
                    ready.set()
                continue
            params = message.get("params") or {}
            if "id" not in message:
                if method == "session/cancel":
                    self.session_cancel(params)
                continue
            handler = handlers.get(method)
            if handler is None:
                self.respond(message["id"], error={"code": -32601, "message": "Method not found"})
            else:
                handler(message["id"], params)


def parse(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chunks", type=int, default=3)
    parser.add_argument("--delay", type=float, default=0.0, help="seconds between chunks")
    parser.add_argument("--stop-reason", default="end_turn")
    parser.add_argument("--protocol-version", type=int, default=PROTOCOL_VERSION)
    parser.add_argument("--tools", action="store_true", help="emit thought, plan, tool calls")
    parser.add_argument("--request-permission", action="store_true")
    parser.add_argument("--unexpected-request", action="store_true", help="send fs/read_text_file")
    parser.add_argument("--crash-mid-turn", action="store_true")
    parser.add_argument("--no-load-session", action="store_true")
    parser.add_argument("--unauthenticated", action="store_true")
    parser.add_argument("--broken-negotiation", action="store_true")
    parser.add_argument("--exit-immediately", action="store_true")
    parser.add_argument("--hang", action="store_true")
    parser.add_argument("--stderr-noise", type=int, default=0, help="KiB written to stderr at start")
    parser.add_argument("--sessions-dir", default=None)
    parser.add_argument("--spawn-child", action="store_true")
    parser.add_argument("--pid-file", default=None)
    parser.add_argument("--tag", default=None, help="marker so tests can find these processes")
    return parser.parse_args(argv)


if __name__ == "__main__":
    FakeAgent(parse(sys.argv[1:])).serve()
