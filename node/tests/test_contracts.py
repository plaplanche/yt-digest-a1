import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest
from pydantic import ValidationError
from yt_digest_node.contracts.log_event import LogEvent, LogEventName
from yt_digest_node.contracts.transcript_result import TranscriptResult

REPO = Path(__file__).resolve().parents[2]

VALID = {
    "video_id": "dQw4w9WgXcQ",
    "status": "ok",
    "lang": "en",
    "source": "manual",
    "word_count": 3,
    "truncated": False,
    "sponsor_ratio": 0.1,
    "pages": ["one two three"],
}

NO_TRANSCRIPT = {
    **VALID,
    "status": "no_transcript",
    "lang": None,
    "source": None,
    "word_count": 0,
    "sponsor_ratio": None,
    "pages": [],
}


def test_valid_transcript_result_is_accepted() -> None:
    assert TranscriptResult.model_validate(VALID).word_count == 3


def test_no_transcript_result_with_nulls_is_accepted() -> None:
    result = TranscriptResult.model_validate(NO_TRANSCRIPT)
    assert result.lang is None
    assert result.sponsor_ratio is None


@pytest.mark.parametrize(
    "change",
    [{"extra": 1}, {"video_id": "short"}, {"status": "done"}],
    ids=["extra field", "bad video_id", "bad status"],
)
def test_invalid_transcript_result_is_rejected(change: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        TranscriptResult.model_validate({**VALID, **change})


def test_valid_log_event_is_accepted() -> None:
    event = LogEvent.model_validate(
        {
            "ts": "2026-10-16T12:00:00.000Z",
            "level": "info",
            "service": "node",
            "event": "service.started",
            "attrs": {"version": "0.1.0"},
        }
    )
    assert event.event is LogEventName.service_started


def test_unknown_log_event_is_rejected() -> None:
    with pytest.raises(ValidationError):
        LogEvent.model_validate(
            {
                "ts": "2026-10-16T12:00:00.000Z",
                "level": "info",
                "service": "node",
                "event": "nope",
                "attrs": {},
            }
        )


@pytest.fixture
def tree(tmp_path: Path) -> Path:
    """A copy of the contracts and generated files, checked by scripts/contracts.sh via CONTRACTS_ROOT."""
    for rel in (
        "contracts",
        "worker/src/contracts",
        "node/src/yt_digest_node/contracts",
    ):
        shutil.copytree(REPO / rel, tmp_path / rel)
    (tmp_path / "worker/node_modules").symlink_to(REPO / "worker/node_modules")
    shutil.copy(REPO / "worker/package.json", tmp_path / "worker")
    for name in ("pyproject.toml", "uv.lock"):
        shutil.copy(REPO / "node" / name, tmp_path / "node")
    shutil.copy(
        REPO / "node/src/yt_digest_node/__init__.py",
        tmp_path / "node/src/yt_digest_node",
    )
    return tmp_path


def check(root: Path) -> subprocess.CompletedProcess[str]:
    env = {**os.environ, "CONTRACTS_ROOT": str(root)}
    return subprocess.run(
        [REPO / "scripts/contracts.sh", "--check"],
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )


def test_check_passes_on_fresh_tree(tree: Path) -> None:
    assert check(tree).returncode == 0


def test_check_names_hand_edited_file(tree: Path) -> None:
    generated = "node/src/yt_digest_node/contracts/transcript_result.py"
    with (tree / generated).open("a") as f:
        f.write("# hand edit\n")
    result = check(tree)
    assert result.returncode == 1
    assert generated in result.stderr


def test_check_names_files_when_schema_changes(tree: Path) -> None:
    schema = tree / "contracts/transcript-result.schema.json"
    data = json.loads(schema.read_text())
    data["properties"]["word_count"]["minimum"] = 1
    schema.write_text(json.dumps(data))
    result = check(tree)
    assert result.returncode == 1
    assert "node/src/yt_digest_node/contracts/transcript_result.py" in result.stderr


def test_check_names_orphaned_generated_file(tree: Path) -> None:
    orphan = "worker/src/contracts/gone.ts"
    (tree / orphan).write_text("// orphan\n")
    result = check(tree)
    assert result.returncode == 1
    assert orphan in result.stderr
