import sys
from pathlib import Path

import pytest


LLM_BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(LLM_BACKEND_ROOT))


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"
