from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, TypeAlias

from pydantic import BaseModel, ConfigDict, Field

JsonScalar: TypeAlias = str | int | float | bool | None
JsonValue: TypeAlias = JsonScalar | dict[str, "JsonValue"] | list["JsonValue"]
JsonObject: TypeAlias = dict[str, JsonValue]


@dataclass(slots=True)
class Notification:
    method: str
    payload: JsonObject


@dataclass(slots=True)
class IncomingRequest:
    id: str | int
    method: str
    payload: JsonObject


#: The ``initialize`` reply's models keep the members they do not name: a newer
#: server's optional additions reach the caller in ``model_extra`` instead of
#: being dropped (P0-06 acceptance[1]).
_KEEP_UNKNOWN = ConfigDict(extra="allow")


class ServerInfo(BaseModel):
    model_config = _KEEP_UNKNOWN

    name: str | None = None
    version: str | None = None


@dataclass(frozen=True, slots=True)
class CapabilityDeclaration:
    """One capability this client declares at ``initialize``.

    ``mandatory`` is a property of the declaration, not of the capability: the
    server refuses the connection outright when it cannot supply a mandatory
    one, and records an optional one it does not support as ignored. A client
    that merely wants a capability when it is available declares it optional
    and reads the result to learn whether it was agreed.
    """

    id: str
    mandatory: bool = False


class CapabilityDowngrade(BaseModel):
    """A capability an adapter downgraded during negotiation, and why.

    Mirrors the protocol's ``CapabilityDowngrade``.
    """

    model_config = _KEEP_UNKNOWN

    capability: str
    reason: str
    adapter: str


class NegotiationProvenance(BaseModel):
    """What the two peers agreed to, as the server recorded it."""

    model_config = _KEEP_UNKNOWN

    protocolVersion: int | None = None
    agreedCapabilities: list[str] = Field(default_factory=list)
    ignoredCapabilities: list[str] = Field(default_factory=list)
    downgrades: list[CapabilityDowngrade] = Field(default_factory=list)


class HostStopRecord(BaseModel):
    """Why the host was stopped, as the surfaces publish it.

    Mirrors the protocol's ``SdkHostStopRecord``; the name is unprefixed here
    because this package has its own namespace and nothing else in it carries
    the name.
    """

    model_config = _KEEP_UNKNOWN

    requestedBy: str | None = None
    reason: str | None = None
    requestedAtMs: int | None = None
    release: str | None = None


class HostControlState(BaseModel):
    """Whether the host is stopped, and the record that says why when it is.

    Mirrors the protocol's ``SdkHostControlState``. ``stopped`` is required
    rather than defaulted: it is the field the whole state answers, and a
    payload missing it is a protocol violation, not a running host. ``record``
    is present exactly when ``stopped`` is true.
    """

    model_config = _KEEP_UNKNOWN

    stopped: bool
    record: HostStopRecord | None = None


class ProtocolVersionRange(BaseModel):
    """The protocol versions a peer supports, inclusive."""

    model_config = _KEEP_UNKNOWN

    min: int
    max: int


class Approval(BaseModel):
    """One approval as the SDK carries it (Epic P2-07).

    Mirrors the protocol's ``SdkApproval``. ``state`` is read against the
    server's clock, so a lapsed approval arrives as ``expired``; ``revision``
    is what a decision names, and a decision from an older read is refused.
    """

    model_config = _KEEP_UNKNOWN

    id: str
    sessionId: str
    runId: str | None = None
    toolName: str
    requestDigest: str
    state: str
    revision: int
    deadlineMs: int


class ApprovalDecision(BaseModel):
    """``approval/decide``'s answer: the decided approval, or why the decision did not happen.

    ``conflict`` is set exactly when ``ok`` is false. An approval of another
    tenant is ``not-found``, as if it did not exist.
    """

    model_config = _KEEP_UNKNOWN

    ok: bool
    conflict: str | None = None
    approval: Approval | None = None


class ApprovalChanged(BaseModel):
    """``approval.changed`` payload: an approval was recorded or moved.

    Sent only to a client that declared the ``approval`` capability.
    ``sessionId`` is at the top level, so a session subscription receives it.
    """

    model_config = _KEEP_UNKNOWN

    sessionId: str
    approval: Approval


class ExecutionOutcome(BaseModel):
    """How one tool call did not succeed, as its ``tool/result`` event records it (Epic P3-03).

    ``kind`` is one of the six typed outcomes. The detail fields are the ones
    each kind carries; any field a newer server adds stays in ``model_extra``.
    """

    model_config = _KEEP_UNKNOWN

    kind: Literal["policy_denied", "resource_exhausted", "timeout", "cancelled", "tool_failed", "world_lost"]
    #: ``policy_denied``: the gate that refused, and the refusal's error name.
    source: str | None = None
    name: str | None = None
    #: ``resource_exhausted``: the limit reached (``memory``, ``budget``, ...).
    limit: str | None = None
    #: ``timeout`` and ``cancelled``: what stopped the call; a timeout's deadline.
    by: str | None = None
    deadlineMs: int | None = None
    #: ``tool_failed``: the exit code, signal or error code.
    exitCode: int | None = None
    signal: str | None = None
    code: str | None = None
    #: ``world_lost``: why, and which provider's world.
    reason: str | None = None
    provider: str | None = None


class InitializeResponse(BaseModel):
    model_config = _KEEP_UNKNOWN

    serverInfo: ServerInfo | None = None
    negotiation: NegotiationProvenance | None = None
    protocolVersions: ProtocolVersionRange | None = None
    schemaFingerprint: str | None = None
    #: Present only when this client declared ``host-control`` AND the server
    #: has a control plane. Absent means UNKNOWN, never "not stopped".
    hostControl: HostControlState | None = None
