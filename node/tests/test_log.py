import json

import pytest
from yt_digest_node.contracts.log_event import LogEventName
from yt_digest_node.log import emit


def test_emit_writes_one_json_line_on_stderr(
    capsys: pytest.CaptureFixture[str],
) -> None:
    emit(LogEventName.service_started, attrs={"version": "0.1.0"}, request_id="r1")
    err = capsys.readouterr().err
    assert err.count("\n") == 1
    line = json.loads(err)
    assert line["service"] == "node"
    assert line["level"] == "info"
    assert line["event"] == "service.started"
    assert line["request_id"] == "r1"
    assert line["ts"].endswith("Z")


def test_emit_rejects_event_outside_catalogue(
    capsys: pytest.CaptureFixture[str],
) -> None:
    with pytest.raises(ValueError):
        emit("nope.event")
    assert capsys.readouterr().err == ""


def test_emit_rejects_unknown_field() -> None:
    with pytest.raises(ValueError):
        emit("service.started", bogus=1)
