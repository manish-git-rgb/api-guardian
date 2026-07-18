"""
Celery tasks for the AI explanation layer.

Two tasks:
  - explain_change_task: fills in ChangeRow.ai_explanation for one change.
  - generate_ai_reports_task: creates two AIReport rows for a comparison
    (migration_guide, release_notes) covering all its changes.

Both are triggered from routes.compare_versions after the Comparison
and ChangeRow rows are committed.
"""
import logging

from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.models.models import ChangeRow, Comparison, AIReport
from app.ai.explain import explain_change, generate_migration_guide, generate_release_notes

logger = logging.getLogger(__name__)


def _change_to_dict(change: ChangeRow) -> dict:
    return {
        "change_type": change.change_type,
        "severity": change.severity,
        "path": change.path,
        "method": change.method,
        "description": change.description,
    }


@celery_app.task(
    name="app.ai.tasks.explain_change_task",
    bind=True,
    max_retries=3,
    default_retry_delay=10,
)
def explain_change_task(self, change_id: str):
    """Fetch one ChangeRow, call Gemini, write ai_explanation."""
    db = SessionLocal()
    try:
        change = db.query(ChangeRow).filter(ChangeRow.id == change_id).first()
        if not change:
            logger.warning("explain_change_task: change %s not found", change_id)
            return

        try:
            explanation = explain_change(_change_to_dict(change))
        except Exception as exc:
            logger.warning(
                "Gemini call failed for change %s (attempt %s): %s",
                change_id, self.request.retries, exc,
            )
            raise self.retry(exc=exc)

        change.ai_explanation = explanation
        db.commit()
        logger.info("explain_change_task: wrote explanation for change %s", change_id)
    finally:
        db.close()


@celery_app.task(
    name="app.ai.tasks.generate_ai_reports_task",
    bind=True,
    max_retries=3,
    default_retry_delay=10,
)
def generate_ai_reports_task(self, comparison_id: str):
    """
    Fetch all ChangeRows for a comparison, generate a migration guide
    and release notes, and persist each as an AIReport row.
    """
    db = SessionLocal()
    try:
        comparison = db.query(Comparison).filter(Comparison.id == comparison_id).first()
        if not comparison:
            logger.warning("generate_ai_reports_task: comparison %s not found", comparison_id)
            return

        changes = db.query(ChangeRow).filter(ChangeRow.comparison_id == comparison_id).all()
        change_dicts = [_change_to_dict(c) for c in changes]

        try:
            migration_guide = generate_migration_guide(change_dicts)
            release_notes = generate_release_notes(change_dicts)
        except Exception as exc:
            logger.warning(
                "Gemini call failed for comparison %s (attempt %s): %s",
                comparison_id, self.request.retries, exc,
            )
            raise self.retry(exc=exc)

        db.add(AIReport(
            comparison_id=comparison_id,
            report_type="migration_guide",
            content=migration_guide,
        ))
        db.add(AIReport(
            comparison_id=comparison_id,
            report_type="release_notes",
            content=release_notes,
        ))
        db.commit()
        logger.info("generate_ai_reports_task: wrote reports for comparison %s", comparison_id)
    finally:
        db.close()