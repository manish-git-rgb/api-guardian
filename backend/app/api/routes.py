"""
Route layer. Kept thin on purpose — parsing lives in app.parser,
diffing lives in app.diff, persistence is plain SQLAlchemy calls here.
Auth is now real: every route depends on get_current_user (JWT-verified),
and project-scoped routes check ownership before acting.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.models import Project, SpecVersion, Comparison, ChangeRow, AIReport, User
from app.schemas.schemas import (
    ProjectCreate, ProjectOut, SpecVersionCreate, ComparisonOut
)
from app.parser.openapi_parser import parse_spec, SpecParseError
from app.diff.engine import diff_specs, overall_risk_score
from app.ai.tasks import explain_change_task, generate_ai_reports_task

router = APIRouter()


def _get_owned_project(project_id: str, current_user: User, db: Session) -> Project:
    """Fetch a project and verify it belongs to current_user, or 404."""
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.owner_id == current_user.id,
    ).first()
    if not project:
        raise HTTPException(404, "Project not found")
    return project


@router.post("/projects", response_model=ProjectOut)
def create_project(
    payload: ProjectCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = Project(
        owner_id=current_user.id,
        name=payload.name,
        description=payload.description,
        repo_url=payload.repo_url,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.get("/projects", response_model=list[ProjectOut])
def list_projects(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return db.query(Project).filter(Project.owner_id == current_user.id).all()


@router.post("/projects/{project_id}/versions")
def upload_spec_version(
    project_id: str,
    payload: SpecVersionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_owned_project(project_id, current_user, db)

    try:
        parse_spec(payload.raw_spec, payload.format)
    except SpecParseError as e:
        raise HTTPException(400, str(e))

    version = SpecVersion(
        project_id=project_id,
        version_label=payload.version_label,
        raw_spec=payload.raw_spec,
        format=payload.format,
    )
    db.add(version)
    db.commit()
    db.refresh(version)
    return {"id": version.id, "version_label": version.version_label}


@router.get("/projects/{project_id}/versions")
def list_spec_versions(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_owned_project(project_id, current_user, db)
    versions = db.query(SpecVersion).filter(
        SpecVersion.project_id == project_id
    ).order_by(SpecVersion.created_at).all()
    return [
        {"id": v.id, "version_label": v.version_label}
        for v in versions
    ]


@router.post("/projects/{project_id}/compare", response_model=ComparisonOut)
def compare_versions(
    project_id: str,
    from_version_id: str,
    to_version_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_owned_project(project_id, current_user, db)

    from_v = db.query(SpecVersion).filter(
        SpecVersion.id == from_version_id, SpecVersion.project_id == project_id
    ).first()
    to_v = db.query(SpecVersion).filter(
        SpecVersion.id == to_version_id, SpecVersion.project_id == project_id
    ).first()
    if not from_v or not to_v:
        raise HTTPException(404, "One or both spec versions not found in this project")

    old_spec = parse_spec(from_v.raw_spec, from_v.format)
    new_spec = parse_spec(to_v.raw_spec, to_v.format)

    changes = diff_specs(old_spec, new_spec)
    risk = overall_risk_score(changes)

    comparison = Comparison(
        project_id=project_id,
        from_version_id=from_version_id,
        to_version_id=to_version_id,
        risk_score=risk.value,
    )
    db.add(comparison)
    db.flush()

    change_rows = []
    for c in changes:
        row = ChangeRow(
            comparison_id=comparison.id,
            path=c.path,
            method=c.method,
            change_type=c.change_type.value,
            severity=c.severity.value,
            field=c.field,
            old_value=c.old_value,
            new_value=c.new_value,
            description=c.description,
        )
        db.add(row)
        change_rows.append(row)

    db.commit()
    db.refresh(comparison)

    for row in change_rows:
        explain_change_task.delay(row.id)

    if change_rows:
        generate_ai_reports_task.delay(comparison.id)

    return comparison


@router.get("/comparisons/{comparison_id}", response_model=ComparisonOut)
def get_comparison(
    comparison_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    comparison = db.query(Comparison).join(Project).filter(
        Comparison.id == comparison_id,
        Project.owner_id == current_user.id,
    ).first()
    if not comparison:
        raise HTTPException(404, "Comparison not found")
    return comparison


@router.get("/comparisons/{comparison_id}/ai-reports")
def get_ai_reports(
    comparison_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    comparison = db.query(Comparison).join(Project).filter(
        Comparison.id == comparison_id,
        Project.owner_id == current_user.id,
    ).first()
    if not comparison:
        raise HTTPException(404, "Comparison not found")

    reports = db.query(AIReport).filter(
        AIReport.comparison_id == comparison_id
    ).all()
    return [
        {"report_type": r.report_type, "content": r.content, "created_at": r.created_at}
        for r in reports
    ]


@router.delete("/comparisons/{comparison_id}")
def delete_comparison(
    comparison_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    comparison = db.query(Comparison).join(Project).filter(
        Comparison.id == comparison_id,
        Project.owner_id == current_user.id,
    ).first()
    if not comparison:
        raise HTTPException(404, "Comparison not found")

    db.delete(comparison)
    db.commit()
    return {"deleted": True}


@router.delete("/projects/{project_id}/versions/{version_id}")
def delete_spec_version(
    project_id: str,
    version_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_owned_project(project_id, current_user, db)

    version = db.query(SpecVersion).filter(
        SpecVersion.id == version_id,
        SpecVersion.project_id == project_id,
    ).first()
    if not version:
        raise HTTPException(404, "Spec version not found")

    in_use = db.query(Comparison).filter(
        (Comparison.from_version_id == version_id) | (Comparison.to_version_id == version_id)
    ).first()
    if in_use:
        raise HTTPException(
            400,
            "This version is used in an existing comparison. Delete that comparison first."
        )

    db.delete(version)
    db.commit()
    return {"deleted": True}


@router.delete("/projects/{project_id}")
def delete_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get_owned_project(project_id, current_user, db)

    version_ids = [
        v.id for v in db.query(SpecVersion.id).filter(SpecVersion.project_id == project_id).all()
    ]

    comparisons = db.query(Comparison).filter(
        (Comparison.project_id == project_id)
        | (Comparison.from_version_id.in_(version_ids))
        | (Comparison.to_version_id.in_(version_ids))
    ).all()
    for comp in comparisons:
        db.delete(comp)
    db.flush()

    db.delete(project)
    db.commit()
    return {"deleted": True}