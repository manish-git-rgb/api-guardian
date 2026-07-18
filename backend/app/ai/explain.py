"""
AI explanation layer for API Guardian.

Three functions, each building a focused prompt and calling Gemini:
  - explain_change: short explanation of a single breaking change,
    for a result card.
  - generate_migration_guide: step-by-step guidance for a full set of
    changes between two spec versions.
  - generate_release_notes: human-readable release notes summarizing
    all changes for a version.

Each function takes plain dicts (not ORM objects) so this module has
zero dependency on the DB layer — callers (Celery tasks) pull data out
of the DB, hand it here as dicts, and write the string result back.
"""
from app.ai.gemini_client import generate_text


def explain_change(change: dict) -> str:
    prompt = f"""You are an API change assistant. Explain the following
breaking change to a backend engineer in 2-3 plain-English sentences.
Be concrete about what will break for API consumers and why. Do not
repeat the raw fields back verbatim — synthesize them into a clear
explanation.

Change type: {change.get('change_type')}
Severity: {change.get('severity')}
HTTP method: {change.get('method')}
Path: {change.get('path')}
Existing rule-based description: {change.get('description')}

Respond with only the explanation text, no preamble."""
    return generate_text(prompt)


def generate_migration_guide(changes: list[dict]) -> str:
    change_lines = "\n".join(
        f"- [{c.get('severity', 'unknown').upper()}] {c.get('method', '')} "
        f"{c.get('path', '')} — {c.get('change_type', '')}: "
        f"{c.get('description', '')}"
        for c in changes
    )
    prompt = f"""You are an API migration assistant. Given the following
list of breaking and non-breaking changes between two API versions,
write a concise migration guide in markdown for developers who
consume this API. Group related changes, explain what they need to
update in their client code, and order items by severity (critical
first). Keep it practical and skip changes that don't require any
consumer action.

Changes:
{change_lines}

Respond with only the markdown guide, no preamble."""
    return generate_text(prompt)


def generate_release_notes(changes: list[dict], project_name: str = "") -> str:
    change_lines = "\n".join(
        f"- [{c.get('severity', 'unknown').upper()}] {c.get('method', '')} "
        f"{c.get('path', '')} — {c.get('change_type', '')}"
        for c in changes
    )
    project_line = f" for {project_name}" if project_name else ""
    prompt = f"""Write concise release notes{project_line} summarizing
the following API changes. Use a short markdown bullet list, grouped
by severity if there are multiple severities present. Keep the tone
neutral and factual, suitable for a CHANGELOG.md entry.

Changes:
{change_lines}

Respond with only the release notes text, no preamble."""
    return generate_text(prompt)