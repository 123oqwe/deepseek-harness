from __future__ import annotations

import pytest

from deepseek_harness import ExecutionOutcome, RunResult, SdkProtocolError, tool_result_outcome


def _tool_result(call_id: str, outcome: object | None = None) -> dict:
    data: dict = {
        "turn": 1,
        "step": 1,
        "message": {"source": {"kind": "tool", "callId": call_id}, "content": [], "role": "user"},
        "isError": False,
    }
    if outcome is not None:
        data["outcome"] = outcome
    return {"type": "tool/result", "seq": 1, "time": 0, "data": data}


def test_a_tool_result_reads_its_typed_outcome() -> None:
    """Epic P3-03 acceptance[1], the Python leg: the outcome keeps its type in the SDK."""
    assert tool_result_outcome(_tool_result("c-1")) is None
    failed = tool_result_outcome(_tool_result("c-2", {"kind": "tool_failed", "exitCode": 3}))
    assert failed == ExecutionOutcome(kind="tool_failed", exitCode=3)
    exhausted = tool_result_outcome(_tool_result("c-3", {"kind": "resource_exhausted", "limit": "memory", "since": "later"}))
    assert exhausted is not None
    assert (exhausted.kind, exhausted.limit, exhausted.model_extra) == ("resource_exhausted", "memory", {"since": "later"})


def test_a_malformed_outcome_or_another_event_is_a_protocol_error() -> None:
    with pytest.raises(SdkProtocolError, match="malformed outcome"):
        tool_result_outcome(_tool_result("c-1", {"kind": "printed_denial"}))
    with pytest.raises(SdkProtocolError, match="requires a tool/result event"):
        tool_result_outcome({"type": "turn/end", "data": {}})


def test_a_run_lists_the_calls_that_did_not_succeed() -> None:
    events = [
        {"type": "turn/start", "data": {"turn": 1}},
        _tool_result("c-1"),
        _tool_result("c-2", {"kind": "cancelled", "by": "abort"}),
        _tool_result("c-3", {"kind": "policy_denied", "source": "policy", "name": "PolicyRefusedError"}),
    ]
    result = RunResult(session_id="main", final_response="", finish_reason=None, events=events, notifications=[])
    assert result.tool_outcomes() == [
        ("c-2", ExecutionOutcome(kind="cancelled", by="abort")),
        ("c-3", ExecutionOutcome(kind="policy_denied", source="policy", name="PolicyRefusedError")),
    ]
    broken = RunResult(
        session_id="main",
        final_response="",
        finish_reason=None,
        events=[{"type": "tool/result", "data": {"outcome": {"kind": "timeout", "by": "executor"}}}],
        notifications=[],
    )
    with pytest.raises(SdkProtocolError, match="callId"):
        broken.tool_outcomes()
