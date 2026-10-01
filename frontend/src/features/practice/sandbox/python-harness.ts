/**
 * The Python side of a run, evaluated once when the interpreter loads.
 *
 * It defines `_learn_nodes_run(code, emit)`, which:
 *
 * - compiles the whole buffer first, so code that cannot be parsed is reported
 *   and *nothing* executes;
 * - executes it in a brand-new globals dict as `__main__`;
 * - routes `sys.stdout` / `sys.stderr` through one `emit(stream, text)` call
 *   per write, which keeps the two streams in the order they were written;
 * - reports an uncaught exception as its type, message, and the deepest line
 *   of the learner's own code (`<sandbox>`) in its traceback;
 *
 * It deliberately does NOT try to undo a run's side effects in place. Pyodide
 * preloads modules the learner can also import (`json`, `os`, ...), so a
 * mutation of one of them cannot be reliably rolled back from inside the
 * interpreter. Isolation between runs is the runner's job instead: every
 * worker — and so every interpreter — serves exactly one run
 * (see `sandbox-runner.ts`).
 */
export const PYTHON_HARNESS = String.raw`
import builtins as _b
import sys as _sys

_LEARN_NODES_FILENAME = "<sandbox>"


class _LearnNodesStream:
    def __init__(self, name, emit):
        self._name = name
        self._emit = emit

    def write(self, text):
        if not isinstance(text, str):
            raise TypeError("write() argument must be str, not " + type(text).__name__)
        if text:
            self._emit(self._name, text)
        return len(text)

    def writelines(self, lines):
        for line in lines:
            self.write(line)

    def flush(self):
        pass

    def isatty(self):
        return False

    def writable(self):
        return True

    def readable(self):
        return False

    @property
    def encoding(self):
        return "utf-8"


def _learn_nodes_line(exc):
    line = None
    tb = exc.__traceback__
    while tb is not None:
        if tb.tb_frame.f_code.co_filename == _LEARN_NODES_FILENAME:
            line = tb.tb_lineno
        tb = tb.tb_next
    return line


def _learn_nodes_describe(exc):
    return {
        "type": type(exc).__name__,
        "message": str(exc),
        "line": _learn_nodes_line(exc),
    }


def _learn_nodes_run(code, emit):
    saved_stdout, saved_stderr = _sys.stdout, _sys.stderr
    namespace = {"__name__": "__main__", "__builtins__": _b}
    _sys.stdout = _LearnNodesStream("stdout", emit)
    _sys.stderr = _LearnNodesStream("stderr", emit)
    try:
        try:
            compiled = compile(code, _LEARN_NODES_FILENAME, "exec", dont_inherit=True)
        except SyntaxError as exc:
            return {"type": type(exc).__name__, "message": exc.msg, "line": exc.lineno}
        except Exception as exc:
            return {"type": type(exc).__name__, "message": str(exc), "line": None}

        try:
            exec(compiled, namespace)
        except SystemExit as exc:
            if exc.code is None or exc.code == 0:
                return None
            return {"type": "SystemExit", "message": str(exc.code), "line": _learn_nodes_line(exc)}
        except BaseException as exc:
            return _learn_nodes_describe(exc)
        return None
    finally:
        _sys.stdout, _sys.stderr = saved_stdout, saved_stderr
`
