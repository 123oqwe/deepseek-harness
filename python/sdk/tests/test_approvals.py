from __future__ import annotations

import json
import sys
from pathlib import Path

from deepseek_harness import (
    APPROVAL_CAPABILITY,
    ApprovalChanged,
    CapabilityDeclaration,
    HarnessClient,
    HarnessConfig,
)

_APPROVAL = {
    "id": "a-1",
    "sessionId": "main",
    "toolName": "bash",
    "requestDigest": "sha256:a-1",
    "state": "requested",
    "revision": 0,
    "deadlineMs": 1700000060000,
}


def test_lists_decides_and_receives_approvals_through_a_fake_dsh(tmp_path: Path) -> None:
    """Epic P2-07 validation[2], the Python leg: declare, list, decide, receive.

    The client declares ``approval``, lists what still waits, decides it from
    the revision it read, and a session subscription receives the
    ``approval.changed`` the server sends with the session at the top level.
    """
    script = tmp_path / "fake_dsh.py"
    sent_dump = tmp_path / "sent.jsonl"
    script.write_text(
        f"""
import json
import sys

APPROVAL = {json.dumps(_APPROVAL)}
sent = open({json.dumps(str(sent_dump))}, "a")
for line in sys.stdin:
    msg = json.loads(line)
    method = msg.get("method")
    sent.write(json.dumps({{"method": method, "params": msg.get("params")}}) + "\\n")
    sent.flush()
    if method == "initialize":
        print(json.dumps({{"jsonrpc": "2.0", "id": msg["id"], "result": {{
            "serverInfo": {{"name": "fake-dsh", "version": "0.0.1"}},
            "negotiation": {{"protocolVersion": 1, "agreedCapabilities": ["approval"], "ignoredCapabilities": []}},
        }}}}), flush=True)
    elif method == "approval/list":
        print(json.dumps({{"jsonrpc": "2.0", "id": msg["id"], "result": {{"approvals": [APPROVAL]}}}}), flush=True)
    elif method == "approval/decide":
        decided = dict(APPROVAL, state="approved", revision=1)
        print(json.dumps({{"jsonrpc": "2.0", "method": "approval.changed", "params": {{"sessionId": "main", "approval": decided}}}}), flush=True)
        print(json.dumps({{"jsonrpc": "2.0", "id": msg["id"], "result": {{"ok": True, "approval": decided}}}}), flush=True)
    elif method == "shutdown":
        print(json.dumps({{"jsonrpc": "2.0", "id": msg["id"], "result": {{}}}}), flush=True)
        break
""".strip()
    )

    with HarnessClient(HarnessConfig(), _launch_args=(sys.executable, str(script))) as client:
        init = client.initialize(
            provider="deepseek-official",
            cwd="/workspace",
            model="dsagent",
            capabilities=[CapabilityDeclaration(APPROVAL_CAPABILITY)],
        )
        assert init.negotiation is not None
        assert APPROVAL_CAPABILITY in init.negotiation.agreedCapabilities

        pending = client.list_approvals("main")
        assert [(approval.id, approval.state, approval.revision) for approval in pending] == [("a-1", "requested", 0)]

        with client.subscribe_session_notifications("main") as subscription:
            decision = client.decide_approval("a-1", pending[0].revision, "approved")
            assert decision.ok is True
            assert decision.approval is not None
            assert (decision.approval.state, decision.approval.revision) == ("approved", 1)
            changed = subscription.next()
            assert changed.method == "approval.changed"
            payload = ApprovalChanged.model_validate(changed.payload)
            assert (payload.sessionId, payload.approval.state) == ("main", "approved")

    sent = [json.loads(line) for line in sent_dump.read_text().splitlines()]
    assert [entry["method"] for entry in sent[:3]] == ["initialize", "approval/list", "approval/decide"]
    assert sent[1]["params"] == {"sessionId": "main"}
    assert sent[2]["params"] == {"id": "a-1", "revision": 0, "decision": "approved"}
