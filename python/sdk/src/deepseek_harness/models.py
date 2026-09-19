from __future__ import annotations

from dataclasses import dataclass
from typing import TypeAlias

from pydantic import BaseModel, Field

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


class ServerInfo(BaseModel):
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


class NegotiationProvenance(BaseModel):
    """What the two peers agreed to, as the server recorded it."""

    protocolVersion: int | None = None
    agreedCapabilities: list[str] = Field(default_factory=list)
    ignoredCapabilities: list[str] = Field(default_factory=list)


class HostStopRecord(BaseModel):
    """Why the host was stopped, as the surfaces publish it.

    Mirrors the protocol's ``SdkHostStopRecord``; the name is unprefixed here
    because this package has its own namespace and nothing else in it carries
    the name.
    """

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

    stopped: bool
    record: HostStopRecord | None = None


class InitializeResponse(BaseModel):
    serverInfo: ServerInfo | None = None
    negotiation: NegotiationProvenance | None = None
    #: Present only when this client declared ``host-control`` AND the server
    #: has a control plane. Absent means UNKNOWN, never "not stopped".
    hostControl: HostControlState | None = None
