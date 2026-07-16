"""
Core diff engine for API Guardian.

Compares two parsed OpenAPI spec dicts and produces a list of Change objects.
This module is intentionally dependency-free from the AI layer: it must be
correct and deterministic on its own. The AI layer only explains what this
engine already found.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class Severity(str, Enum):
    SAFE = "safe"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class ChangeType(str, Enum):
    ENDPOINT_ADDED = "endpoint_added"
    ENDPOINT_REMOVED = "endpoint_removed"
    FIELD_ADDED = "field_added"
    FIELD_REMOVED = "field_removed"
    TYPE_CHANGED = "type_changed"
    REQUIRED_ADDED = "required_added"       # field became required (request)
    REQUIRED_REMOVED = "required_removed"   # field became optional (request)
    RESPONSE_FIELD_REMOVED = "response_field_removed"
    ENUM_NARROWED = "enum_narrowed"
    ENUM_WIDENED = "enum_widened"
    DESCRIPTION_CHANGED = "description_changed"


@dataclass
class Change:
    path: str                 # e.g. "/users/{id}"
    method: str | None        # e.g. "GET", None for schema-level changes
    change_type: ChangeType
    severity: Severity
    field: str | None = None
    old_value: Any = None
    new_value: Any = None
    description: str = ""     # short deterministic description, NOT AI-generated

    def to_dict(self) -> dict:
        return {
            "path": self.path,
            "method": self.method,
            "change_type": self.change_type.value,
            "severity": self.severity.value,
            "field": self.field,
            "old_value": self.old_value,
            "new_value": self.new_value,
            "description": self.description,
        }


# Rule table: change_type -> default severity.
# Kept as a plain dict (not buried in if/else) so it's easy to unit test
# and tune independently of the traversal logic.
SEVERITY_RULES: dict[ChangeType, Severity] = {
    ChangeType.ENDPOINT_ADDED: Severity.SAFE,
    ChangeType.ENDPOINT_REMOVED: Severity.CRITICAL,
    ChangeType.FIELD_ADDED: Severity.SAFE,
    ChangeType.FIELD_REMOVED: Severity.HIGH,
    ChangeType.TYPE_CHANGED: Severity.CRITICAL,
    ChangeType.REQUIRED_ADDED: Severity.HIGH,
    ChangeType.REQUIRED_REMOVED: Severity.SAFE,
    ChangeType.RESPONSE_FIELD_REMOVED: Severity.CRITICAL,
    ChangeType.ENUM_NARROWED: Severity.HIGH,
    ChangeType.ENUM_WIDENED: Severity.SAFE,
    ChangeType.DESCRIPTION_CHANGED: Severity.SAFE,
}


def _endpoints(spec: dict) -> dict[tuple[str, str], dict]:
    """Flatten spec['paths'] into {(path, method): operation_dict}."""
    out = {}
    for path, methods in (spec.get("paths") or {}).items():
        for method, operation in methods.items():
            if method.lower() not in ("get", "post", "put", "patch", "delete"):
                continue
            out[(path, method.upper())] = operation
    return out


def _schema_properties(schema: dict | None) -> dict[str, dict]:
    if not schema:
        return {}
    return schema.get("properties", {}) or {}


def _required_fields(schema: dict | None) -> set[str]:
    if not schema:
        return set()
    return set(schema.get("required", []) or [])


def _get_body_schema(operation: dict, section: str) -> dict | None:
    """
    section = 'requestBody' or a response code like '200'.
    Pulls the application/json schema out, handling both being absent gracefully.
    """
    if section == "requestBody":
        body = operation.get("requestBody", {})
        content = body.get("content", {})
    else:
        responses = operation.get("responses", {})
        response = responses.get(section, {})
        content = response.get("content", {})
    json_content = content.get("application/json", {})
    return json_content.get("schema")


def _diff_properties(
    old_schema: dict | None,
    new_schema: dict | None,
    path: str,
    method: str,
    is_request: bool,
) -> list[Change]:
    changes: list[Change] = []
    old_props = _schema_properties(old_schema)
    new_props = _schema_properties(new_schema)
    old_required = _required_fields(old_schema)
    new_required = _required_fields(new_schema)

    old_fields = set(old_props.keys())
    new_fields = set(new_props.keys())

    for f in new_fields - old_fields:
        changes.append(Change(
            path=path, method=method,
            change_type=ChangeType.FIELD_ADDED,
            severity=SEVERITY_RULES[ChangeType.FIELD_ADDED],
            field=f,
            description=f"Field '{f}' was added",
        ))

    for f in old_fields - new_fields:
        ctype = ChangeType.FIELD_REMOVED if is_request else ChangeType.RESPONSE_FIELD_REMOVED
        changes.append(Change(
            path=path, method=method,
            change_type=ctype,
            severity=SEVERITY_RULES[ctype],
            field=f,
            description=f"Field '{f}' was removed"
                        + (" from the response" if not is_request else " from the request"),
        ))

    for f in old_fields & new_fields:
        old_type = old_props[f].get("type")
        new_type = new_props[f].get("type")
        if old_type and new_type and old_type != new_type:
            changes.append(Change(
                path=path, method=method,
                change_type=ChangeType.TYPE_CHANGED,
                severity=SEVERITY_RULES[ChangeType.TYPE_CHANGED],
                field=f, old_value=old_type, new_value=new_type,
                description=f"Field '{f}' changed type from {old_type} to {new_type}",
            ))

        old_enum = set(old_props[f].get("enum", []) or [])
        new_enum = set(new_props[f].get("enum", []) or [])
        if old_enum and new_enum and old_enum != new_enum:
            if not new_enum.issuperset(old_enum):
                changes.append(Change(
                    path=path, method=method,
                    change_type=ChangeType.ENUM_NARROWED,
                    severity=SEVERITY_RULES[ChangeType.ENUM_NARROWED],
                    field=f, old_value=sorted(old_enum), new_value=sorted(new_enum),
                    description=f"Enum values removed from '{f}': {sorted(old_enum - new_enum)}",
                ))
            elif new_enum != old_enum:
                changes.append(Change(
                    path=path, method=method,
                    change_type=ChangeType.ENUM_WIDENED,
                    severity=SEVERITY_RULES[ChangeType.ENUM_WIDENED],
                    field=f, old_value=sorted(old_enum), new_value=sorted(new_enum),
                    description=f"Enum values added to '{f}': {sorted(new_enum - old_enum)}",
                ))

    if is_request:
        for f in new_required - old_required:
            changes.append(Change(
                path=path, method=method,
                change_type=ChangeType.REQUIRED_ADDED,
                severity=SEVERITY_RULES[ChangeType.REQUIRED_ADDED],
                field=f,
                description=f"Field '{f}' is now required",
            ))
        for f in old_required - new_required:
            changes.append(Change(
                path=path, method=method,
                change_type=ChangeType.REQUIRED_REMOVED,
                severity=SEVERITY_RULES[ChangeType.REQUIRED_REMOVED],
                field=f,
                description=f"Field '{f}' is no longer required",
            ))

    return changes


def diff_specs(old_spec: dict, new_spec: dict) -> list[Change]:
    """
    Main entry point. Compare two OpenAPI spec dicts (already parsed from
    YAML/JSON) and return a flat list of Change objects.
    """
    changes: list[Change] = []

    old_eps = _endpoints(old_spec)
    new_eps = _endpoints(new_spec)

    old_keys = set(old_eps.keys())
    new_keys = set(new_eps.keys())

    for path, method in new_keys - old_keys:
        changes.append(Change(
            path=path, method=method,
            change_type=ChangeType.ENDPOINT_ADDED,
            severity=SEVERITY_RULES[ChangeType.ENDPOINT_ADDED],
            description=f"New endpoint {method} {path}",
        ))

    for path, method in old_keys - new_keys:
        changes.append(Change(
            path=path, method=method,
            change_type=ChangeType.ENDPOINT_REMOVED,
            severity=SEVERITY_RULES[ChangeType.ENDPOINT_REMOVED],
            description=f"Endpoint {method} {path} was removed",
        ))

    for key in old_keys & new_keys:
        path, method = key
        old_op, new_op = old_eps[key], new_eps[key]

        old_req_schema = _get_body_schema(old_op, "requestBody")
        new_req_schema = _get_body_schema(new_op, "requestBody")
        changes.extend(_diff_properties(old_req_schema, new_req_schema, path, method, is_request=True))

        old_resp_schema = _get_body_schema(old_op, "200")
        new_resp_schema = _get_body_schema(new_op, "200")
        changes.extend(_diff_properties(old_resp_schema, new_resp_schema, path, method, is_request=False))

        old_desc = old_op.get("description", "")
        new_desc = new_op.get("description", "")
        if old_desc != new_desc:
            changes.append(Change(
                path=path, method=method,
                change_type=ChangeType.DESCRIPTION_CHANGED,
                severity=SEVERITY_RULES[ChangeType.DESCRIPTION_CHANGED],
                old_value=old_desc, new_value=new_desc,
                description="Description text changed",
            ))

    return changes


def overall_risk_score(changes: list[Change]) -> Severity:
    """The report-level risk score is just the worst individual severity."""
    order = [Severity.SAFE, Severity.MEDIUM, Severity.HIGH, Severity.CRITICAL]
    if not changes:
        return Severity.SAFE
    return max(changes, key=lambda c: order.index(c.severity)).severity
