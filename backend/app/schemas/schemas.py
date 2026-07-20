from pydantic import BaseModel
from datetime import datetime


class ProjectCreate(BaseModel):
    name: str
    description: str | None = None
    repo_url: str | None = None


class ProjectOut(BaseModel):
    id: str
    name: str
    description: str | None
    created_at: datetime

    class Config:
        from_attributes = True


class SpecVersionCreate(BaseModel):
    version_label: str
    format: str  # "yaml" | "json"
    raw_spec: str


class ChangeOut(BaseModel):
    path: str
    method: str | None
    change_type: str
    severity: str
    field: str | None
    old_value: object | None
    new_value: object | None
    description: str
    ai_explanation: str | None = None


class ComparisonOut(BaseModel):
    id: str
    risk_score: str
    created_at: datetime
    changes: list[ChangeOut]

    class Config:
        from_attributes = True


class UserCreate(BaseModel):
    email: str
    password: str


class UserLogin(BaseModel):
    email: str
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: str
    email: str
    auth_provider: str

    class Config:
        from_attributes = True
