from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Generic, TypeVar

T = TypeVar("T")


@dataclass(slots=True)
class AxiEnvelope(Generic[T]):
    ok: bool
    data: T
    meta: dict[str, Any]
    links: list[dict[str, Any]]
    error: dict[str, Any] | None = None

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "AxiEnvelope[Any]":
        return cls(
            ok=bool(value.get("ok")),
            data=value.get("data"),
            meta=dict(value.get("meta") or {}),
            links=list(value.get("links") or []),
            error=value.get("error"),
        )
