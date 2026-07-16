"""
Route layer. Kept thin on purpose — parsing lives in app.parser,
diffing lives in app.diff, persistence is plain SQLAlchemy calls here.
Auth dependency (get_current_user) is stubbed for now; wire up JWT/OAuth
before deploying this publicly.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.models import Project, SpecVersion, Comparison, ChangeRow
from app.schemas.schemas import (
    ProjectCreate, ProjectOut, SpecVersionCreate, ComparisonOut
)
from app.parser.openapi_parser import parse_spec, SpecParseError
from app.diff.engine import diff_specs, overall_risk_score

router = APIRouter()


def get_current_user_id() -> str:
    # TODO: replace with real JWT-decoded user id once auth is wired up.
    return "00000000-0000-0000-0000-000000000000"


@router.post("/projects", response_model=ProjectOut)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db)):
    project = Project(
        owner_id=get_current_user_id(),
        name=payload.name,
        description=payload.description,
        repo_url=payload.repo_url,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.get("/projects", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db)):
    return db.query(Project).filter(Project.owner_id == get_current_user_id()).all()


@router.post("/projects/{project_id}/versions")
def upload_spec_version(project_id: str, payload: SpecVersionCreate, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")

    try:
        parse_spec(payload.raw_spec, payload.format)  # validate it's parseable before saving
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


@router.post("/projects/{project_id}/compare", response_model=ComparisonOut)
def compare_versions(
    project_id: str,
    from_version_id: str,
    to_version_id: str,
    db: Session = Depends(get_db),
):
    from_v = db.query(SpecVersion).filter(SpecVersion.id == from_version_id).first()
    to_v = db.query(SpecVersion).filter(SpecVersion.id == to_version_id).first()
    if not from_v or not to_v:
        raise HTTPException(404, "One or both spec versions not found")

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
    db.flush()  # get comparison.id before inserting children

    for c in changes:
        db.add(ChangeRow(
            comparison_id=comparison.id,
            path=c.path,
            method=c.method,
            change_type=c.change_type.value,
            severity=c.severity.value,
            field=c.field,
            old_value=c.old_value,
            new_value=c.new_value,
            description=c.description,
        ))

    db.commit()
    db.refresh(comparison)
    return comparison


@router.get("/comparisons/{comparison_id}", response_model=ComparisonOut)
def get_comparison(comparison_id: str, db: Session = Depends(get_db)):
    comparison = db.query(Comparison).filter(Comparison.id == comparison_id).first()
    if not comparison:
        raise HTTPException(404, "Comparison not found")
    return comparison
