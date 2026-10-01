import os
import sys
from pathlib import Path

# Apps built by the suite do not start the agents' MCP listener unless a
# test asks for it with `create_app(..., context_server=True)`.
os.environ.setdefault("LEARN_NODES_CONTEXT_SERVER", "0")

# Ensure backend is on path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from httpx import AsyncClient, ASGITransport

# Import app dynamically to avoid module resolution issues
from main import app as fastapi_app


@pytest.fixture
async def async_client():
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


FAKE_ACP_AGENT = Path(__file__).parent / "fixtures" / "fake_acp_agent.py"


@pytest.fixture
def fake_agent_command():
    """Build the argv that launches the fake ACP agent with the given flags.

    Returned as a plain argv so a test can hand it to whatever launches
    agents — `AgentCommand(argv[0], tuple(argv[1:]))` for the client.
    """

    def build(*flags: str) -> list[str]:
        return [sys.executable, str(FAKE_ACP_AGENT), *flags]

    return build
