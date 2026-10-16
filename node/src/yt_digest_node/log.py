"""Structured logger: one JSON line per event on standard error, validated against the contract."""

import sys
from datetime import UTC, datetime
from typing import Any

from pydantic import ValidationError

from yt_digest_node.contracts.log_event import LogEvent


def emit(event: str, level: str = "info", **fields: Any) -> None:
    """Write one log line; raise ValueError for an event outside the catalogue or an unknown field."""
    ts = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    data = {
        "ts": ts,
        "level": level,
        "service": "node",
        "event": event,
        "attrs": {},
        **fields,
    }
    try:
        line = LogEvent.model_validate(data)
    except ValidationError as error:
        raise ValueError(f"invalid log event: {error}") from error
    print(line.model_dump_json(exclude_none=True), file=sys.stderr)
