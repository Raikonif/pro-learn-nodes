"""Standalone entry point for the bundled FastAPI sidecar."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

import uvicorn


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the Learn Nodes FastAPI sidecar")
    parser.add_argument(
        "--uds",
        type=Path,
        help="Unix domain socket path to listen on",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument(
        "--data-dir",
        type=Path,
        help="Directory containing durable local application data",
    )
    # Matches the documented dev default. Production uses `--uds` and ignores
    # this entirely; it only applies when the sidecar is run over TCP by hand.
    parser.add_argument("--port", type=int, default=8009)
    parser.add_argument(
        "--require-existing",
        action="store_true",
        help="Report a missing data directory instead of creating it",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()

    # Settings are imported by the ASGI application. Set the explicit
    # production data directory before importing it so the database never
    # accidentally follows the sidecar's transient working directory.
    if args.data_dir is not None:
        os.environ["LEARN_NODES_DATA_DIR"] = str(args.data_dir)
    if args.require_existing:
        os.environ["LEARN_NODES_REQUIRE_EXISTING_DATA"] = "1"

    from main import app

    if args.uds is not None:
        args.uds.parent.mkdir(parents=True, exist_ok=True)
        args.uds.unlink(missing_ok=True)

    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        uds=str(args.uds) if args.uds is not None else None,
        log_level="info",
        # Bounded: by default uvicorn waits for every open connection — a
        # streaming turn, a proxy's keep-alive — before exiting, so a stop
        # could take forever. The desktop shell waits for the exit before it
        # copies or restores the data folder (`data-location`).
        timeout_graceful_shutdown=5,
    )


if __name__ == "__main__":
    main()
