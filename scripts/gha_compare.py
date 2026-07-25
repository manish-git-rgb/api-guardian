#!/usr/bin/env python3
"""
API Guardian — GitHub Action script.

Runs entirely inside a CI job: parses two versions of an OpenAPI spec
file, diffs them using the same diff engine as the main app, optionally
calls Gemini for AI explanations (if GEMINI_API_KEY is set), posts a
Markdown summary as a PR comment, and exits non-zero if the risk is
critical/high — so a workflows step can fail the check on breaking changes.

This does NOT require the API Guardian backend to be deployed anywhere —
it imports the diff/parser/AI modules directly from backend/app, so it
runs standalone in the Action's own Python environment.

Usage:
    python scripts/gha_compare.py --old old_spec.json --new new_spec.json

Environment variables (all optional except where noted):
    GITHUB_TOKEN       — required to post a PR comment (provided
                          automatically by GitHub Actions as
                          ${{ secrets.GITHUB_TOKEN }})
    GITHUB_REPOSITORY  — auto-set by GitHub Actions, e.g. "owner/repo"
    GITHUB_EVENT_PATH  — auto-set by GitHub Actions; used to find the PR number
    GEMINI_API_KEY     — if set, AI explanations/migration guide/release
                          notes are generated; if not set, the comment
                          falls back to rule-based descriptions only
"""
import argparse
import json
import os
import sys

import requests

# Make backend/app importable — this script lives at scripts/gha_compare.py,
# so backend/ is one level up, then into "backend".
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO_ROOT, "backend"))

from app.parser.openapi_parser import parse_spec, SpecParseError  # noqa: E402
from app.diff.engine import diff_specs, overall_risk_score  # noqa: E402

RISK_EMOJI = {
    "critical": "🔴",
    "high": "🟠",
    "medium": "🟡",
    "safe": "🟢",
}


def detect_format(path: str) -> str:
    ext = path.rsplit(".", 1)[-1].lower()
    return "yaml" if ext in ("yaml", "yml") else "json"


def load_spec(path: str, fmt: str):
    with open(path, encoding="utf-8") as f:
        raw = f.read()
    try:
        return parse_spec(raw, fmt)
    except SpecParseError as e:
        print(f"::error::Failed to parse {path}: {e}", file=sys.stderr)
        sys.exit(1)


def try_generate_ai_content(changes: list[dict]) -> dict | None:
    """Returns a dict with per-change explanations + migration guide +
    release notes, or None if GEMINI_API_KEY isn't set (graceful
    degradation so this works without any AI setup at all)."""
    if not os.getenv("GEMINI_API_KEY"):
        print("GEMINI_API_KEY not set — skipping AI explanations, using rule-based descriptions only.")
        return None
    try:
        from app.ai.explain import explain_change, generate_migration_guide, generate_release_notes
    except Exception as e:
        print(f"Could not load AI module ({e}) — skipping AI explanations.")
        return None

    try:
        explanations = [explain_change(c) for c in changes]
        migration_guide = generate_migration_guide(changes)
        release_notes = generate_release_notes(changes)
        return {
            "explanations": explanations,
            "migration_guide": migration_guide,
            "release_notes": release_notes,
        }
    except Exception as e:
        print(f"Gemini call failed ({e}) — falling back to rule-based descriptions only.")
        return None


def build_comment(changes, risk: str, ai_content: dict | None) -> str:
    emoji = RISK_EMOJI.get(risk, "")
    lines = [
        f"## {emoji} API Guardian — Breaking Change Report",
        "",
        f"**Overall risk: `{risk.upper()}`**",
        "",
    ]

    if not changes:
        lines.append("No changes detected between these spec versions. ✅")
        return "\n".join(lines)

    lines.append("### Change summary")
    lines.append("")
    for i, c in enumerate(changes):
        method = f"`{c['method']}` " if c.get("method") else ""
        lines.append(f"- **[{c['severity'].upper()}]** {method}`{c['path']}` — {c['description']}")
        if ai_content:
            lines.append(f"  \n  _{ai_content['explanations'][i]}_")
    lines.append("")

    if ai_content:
        lines.append("### AI Migration Guide")
        lines.append("")
        lines.append(ai_content["migration_guide"])
        lines.append("")
        lines.append("### Release Notes")
        lines.append("")
        lines.append(ai_content["release_notes"])
        lines.append("")

    lines.append("---")
    lines.append("_Generated automatically by [API Guardian](https://github.com/manish-git-rgb/api-guardian)._")
    return "\n".join(lines)


def post_pr_comment(body: str):
    token = os.getenv("GITHUB_TOKEN")
    repo = os.getenv("GITHUB_REPOSITORY")
    event_path = os.getenv("GITHUB_EVENT_PATH")

    if not (token and repo and event_path):
        print("Not running inside a GitHub Actions PR context — skipping comment post.")
        print("\n--- Comment content ---\n")
        print(body)
        return

    with open(event_path) as f:
        event = json.load(f)
    pr_number = event.get("pull_request", {}).get("number") or event.get("number")
    if not pr_number:
        print("Could not determine PR number from event payload — skipping comment post.")
        print(body)
        return

    url = f"https://api.github.com/repos/{repo}/issues/{pr_number}/comments"
    resp = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
        },
        json={"body": body},
    )
    if resp.ok:
        print(f"Posted comment to PR #{pr_number}")
    else:
        print(f"Failed to post comment: {resp.status_code} {resp.text}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description="API Guardian GitHub Action comparison")
    parser.add_argument("--old", required=True, help="Path to the base/old spec file")
    parser.add_argument("--new", required=True, help="Path to the head/new spec file")
    parser.add_argument("--format", choices=["json", "yaml", "auto"], default="auto")
    args = parser.parse_args()

    fmt = detect_format(args.old) if args.format == "auto" else args.format

    old_spec = load_spec(args.old, fmt)
    new_spec = load_spec(args.new, fmt)

    changes = diff_specs(old_spec, new_spec)
    risk = overall_risk_score(changes)

    change_dicts = [
        {
            "path": c.path,
            "method": c.method,
            "change_type": c.change_type.value,
            "severity": c.severity.value,
            "description": c.description,
        }
        for c in changes
    ]

    ai_content = try_generate_ai_content(change_dicts) if change_dicts else None
    comment = build_comment(change_dicts, risk.value, ai_content)
    post_pr_comment(comment)

    print(f"\nOverall risk: {risk.value}")
    if risk.value in ("critical", "high"):
        print("::error::Breaking change detected — failing this check.")
        sys.exit(2)


if __name__ == "__main__":
    main()