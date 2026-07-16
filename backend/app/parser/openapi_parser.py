"""
Parses raw OpenAPI spec text (YAML or JSON) into a plain dict that
app.diff.engine can consume. Kept deliberately dumb: no validation
opinions here beyond "is this valid OpenAPI structurally" — a full
OpenAPI validator (openapi-spec-validator) can be layered in later
without touching the diff engine at all.
"""

import json
import yaml


class SpecParseError(Exception):
    pass


def parse_spec(raw_text: str, fmt: str) -> dict:
    """
    fmt: "yaml" or "json"
    Returns a plain dict with at least a 'paths' key.
    """
    try:
        if fmt == "json":
            spec = json.loads(raw_text)
        elif fmt == "yaml":
            spec = yaml.safe_load(raw_text)
        else:
            raise SpecParseError(f"Unsupported format: {fmt}")
    except (json.JSONDecodeError, yaml.YAMLError) as e:
        raise SpecParseError(f"Failed to parse {fmt.upper()} spec: {e}") from e

    if not isinstance(spec, dict):
        raise SpecParseError("Parsed spec is not a valid object")

    if "paths" not in spec:
        raise SpecParseError("Spec has no 'paths' key — is this a valid OpenAPI document?")

    return spec


def detect_format(filename: str, raw_text: str) -> str:
    """Best-effort format detection from filename, falling back to content sniffing."""
    lower = filename.lower()
    if lower.endswith(".json"):
        return "json"
    if lower.endswith((".yaml", ".yml")):
        return "yaml"
    stripped = raw_text.strip()
    return "json" if stripped.startswith("{") else "yaml"
