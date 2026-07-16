"""
SQLAlchemy models for API Guardian.

Design note: Change rows are written by the deterministic diff engine only.
AIReport rows are written by the (separate, async) AI layer. This keeps the
"what changed" logic independently correct from "how it's explained."
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Column, String, Text, ForeignKey, DateTime, Enum as SAEnum, JSON
)
from sqlalchemy.orm import relationship, declarative_base

Base = declarative_base()

# Deliberately a plain String(36) rather than the Postgres-specific UUID type:
# it behaves identically across Postgres (production) and SQLite (tests/local
# dev), which matters because the Postgres UUID type silently misbehaves under
# other dialects instead of failing loudly.
UUIDType = String(36)


def gen_uuid():
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    id = Column(UUIDType, primary_key=True, default=gen_uuid)
    email = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=True)  # nullable: OAuth users won't have one
    auth_provider = Column(String, default="email")  # "email" | "google"
    created_at = Column(DateTime, default=datetime.utcnow)

    projects = relationship("Project", back_populates="owner", cascade="all, delete-orphan")


class Project(Base):
    __tablename__ = "projects"

    id = Column(UUIDType, primary_key=True, default=gen_uuid)
    owner_id = Column(UUIDType, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    repo_url = Column(String, nullable=True)
    spec_format = Column(String, default="openapi")  # "openapi" | "graphql" (later)
    created_at = Column(DateTime, default=datetime.utcnow)

    owner = relationship("User", back_populates="projects")
    versions = relationship("SpecVersion", back_populates="project", cascade="all, delete-orphan")


class SpecVersion(Base):
    __tablename__ = "spec_versions"

    id = Column(UUIDType, primary_key=True, default=gen_uuid)
    project_id = Column(UUIDType, ForeignKey("projects.id"), nullable=False)
    version_label = Column(String, nullable=False)  # user-supplied, e.g. "v1", "2024-06-10"
    raw_spec = Column(Text, nullable=False)          # original YAML/JSON as uploaded
    format = Column(String, default="yaml")          # "yaml" | "json"
    source = Column(String, default="upload")        # "upload" | "git"
    created_at = Column(DateTime, default=datetime.utcnow)

    project = relationship("Project", back_populates="versions")


class Comparison(Base):
    __tablename__ = "comparisons"

    id = Column(UUIDType, primary_key=True, default=gen_uuid)
    project_id = Column(UUIDType, ForeignKey("projects.id"), nullable=False)
    from_version_id = Column(UUIDType, ForeignKey("spec_versions.id"), nullable=False)
    to_version_id = Column(UUIDType, ForeignKey("spec_versions.id"), nullable=False)
    risk_score = Column(SAEnum("safe", "medium", "high", "critical", name="risk_severity"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    changes = relationship("ChangeRow", back_populates="comparison", cascade="all, delete-orphan")
    ai_reports = relationship("AIReport", back_populates="comparison", cascade="all, delete-orphan")


class ChangeRow(Base):
    """Persisted version of diff.engine.Change — one row per detected change."""
    __tablename__ = "changes"

    id = Column(UUIDType, primary_key=True, default=gen_uuid)
    comparison_id = Column(UUIDType, ForeignKey("comparisons.id"), nullable=False)
    path = Column(String, nullable=False)
    method = Column(String, nullable=True)
    change_type = Column(String, nullable=False)
    severity = Column(SAEnum("safe", "medium", "high", "critical", name="change_severity"), nullable=False)
    field = Column(String, nullable=True)
    old_value = Column(JSON, nullable=True)
    new_value = Column(JSON, nullable=True)
    description = Column(Text, nullable=False)
    ai_explanation = Column(Text, nullable=True)  # filled in async by the AI layer, can stay null

    comparison = relationship("Comparison", back_populates="changes")


class AIReport(Base):
    __tablename__ = "ai_reports"

    id = Column(UUIDType, primary_key=True, default=gen_uuid)
    comparison_id = Column(UUIDType, ForeignKey("comparisons.id"), nullable=False)
    report_type = Column(String, nullable=False)  # "migration_guide" | "release_notes"
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    comparison = relationship("Comparison", back_populates="ai_reports")
