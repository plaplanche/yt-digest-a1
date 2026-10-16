from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError
from yt_digest_node.contracts import node_result_request, transcript_result
from yt_digest_node.contracts.error import ErrorBody
from yt_digest_node.contracts.node_claim_request import NodeClaimRequest
from yt_digest_node.contracts.node_claim_response import NodeClaimResponse
from yt_digest_node.contracts.node_heartbeat_request import NodeHeartbeatRequest
from yt_digest_node.contracts.node_heartbeat_response import NodeHeartbeatResponse
from yt_digest_node.contracts.node_job_ack import NodeJobAck
from yt_digest_node.contracts.node_release_request import NodeReleaseRequest
from yt_digest_node.contracts.node_result_request import NodeResultRequest

TRANSCRIPT = {
    "video_id": "dQw4w9WgXcQ",
    "status": "ok",
    "lang": "en",
    "source": "manual",
    "word_count": 3,
    "truncated": False,
    "sponsor_ratio": 0.1,
    "pages": ["one two three"],
}
LEASE = {
    "video_id": "dQw4w9WgXcQ",
    "lease_id": "0123456789abcdef",
    "lease_expires_at": "2026-10-16T07:00:01.123Z",
}
HEARTBEAT = {"version": "0.1.0", "uptime_s": 5, "jobs_in_progress": 0}
RESULT = {"lease_id": "l", "outcome": "ok", "transcript": TRANSCRIPT}

CASES: list[tuple[type[BaseModel], dict[str, Any], dict[str, Any]]] = [
    (
        NodeHeartbeatRequest,
        {
            **HEARTBEAT,
            "last_success_at": None,
            "disk_free_ratio": 0.5,
            "cpu_temp_c": 40.5,
        },
        {"extra": 1},
    ),
    (
        NodeHeartbeatResponse,
        {"node_id": "n1", "state": "healthy", "hourly_budget": 10, "directive": "run"},
        {"state": "sleepy"},
    ),
    (NodeClaimRequest, {"max_jobs": 3}, {"max_jobs": 0}),
    (NodeClaimResponse, {"jobs": [LEASE]}, {"jobs": [{**LEASE, "lease_id": "short"}]}),
    (NodeResultRequest, RESULT, {"outcome": "maybe"}),
    (NodeReleaseRequest, {"lease_id": "l"}, {"lease_id": ""}),
    (NodeJobAck, {"video_id": "dQw4w9WgXcQ", "status": "done"}, {"status": "nope"}),
    (ErrorBody, {"error": {"code": "x", "message": "y"}}, {"error": {"code": "x"}}),
]
IDS = [case[0].__name__ for case in CASES]


@pytest.mark.parametrize(("model", "valid", "_bad"), CASES, ids=IDS)
def test_valid_instance_is_accepted(
    model: type[BaseModel], valid: dict[str, Any], _bad: dict[str, Any]
) -> None:
    model.model_validate(valid)


@pytest.mark.parametrize(("model", "valid", "bad"), CASES, ids=IDS)
def test_extra_field_and_bad_value_are_rejected(
    model: type[BaseModel], valid: dict[str, Any], bad: dict[str, Any]
) -> None:
    with pytest.raises(ValidationError):
        model.model_validate({**valid, "extra": 1})
    with pytest.raises(ValidationError):
        model.model_validate({**valid, **bad})


@pytest.mark.parametrize("max_jobs", [0, 11])
def test_max_jobs_out_of_range_is_rejected(max_jobs: int) -> None:
    with pytest.raises(ValidationError):
        NodeClaimRequest.model_validate({"max_jobs": max_jobs})


def test_claim_request_max_jobs_is_optional() -> None:
    assert NodeClaimRequest.model_validate({}).max_jobs is None


def test_heartbeat_without_version_is_rejected() -> None:
    with pytest.raises(ValidationError):
        NodeHeartbeatRequest.model_validate({"uptime_s": 0, "jobs_in_progress": 0})


def test_result_with_broken_transcript_is_rejected() -> None:
    with pytest.raises(ValidationError):
        NodeResultRequest.model_validate(
            {**RESULT, "transcript": {**TRANSCRIPT, "status": "done"}}
        )


def test_result_with_null_transcript_is_accepted_but_not_absent() -> None:
    NodeResultRequest.model_validate({**RESULT, "transcript": None})
    with pytest.raises(ValidationError):
        NodeResultRequest.model_validate({"lease_id": "l", "outcome": "error"})


def test_result_request_uses_the_generated_transcript_result_type() -> None:
    field = NodeResultRequest.model_fields["transcript"]
    assert transcript_result.TranscriptResult in field.annotation.__args__  # type: ignore[union-attr]
    source = Path(node_result_request.__file__).read_text()
    assert "class TranscriptResult" not in source
