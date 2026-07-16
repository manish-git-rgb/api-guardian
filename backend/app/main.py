from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.core.database import engine, SessionLocal
from app.models.models import Base, User

app = FastAPI(title="API Guardian", version="0.1.0")

DEV_USER_ID = "00000000-0000-0000-0000-000000000000"


@app.on_event("startup")
def create_tables():
    # Creates any tables that don't exist yet. Safe to run every startup —
    # it only adds missing tables, never touches ones that already exist.
    # Fine for local dev; once this project needs real migrations (schema
    # changes on existing data), switch to Alembic instead.
    Base.metadata.create_all(bind=engine)

    # TEMPORARY: get_current_user_id() in routes.py is a hardcoded stub
    # (real auth isn't built yet — see README). That stub returns this
    # fixed ID, but nothing creates the matching row, so any insert that
    # references it fails on the owner_id foreign key. Seed it once here
    # so local dev works. Delete this block once real auth lands.
    db = SessionLocal()
    try:
        if not db.query(User).filter(User.id == DEV_USER_ID).first():
            db.add(User(id=DEV_USER_ID, email="dev@local.test", auth_provider="email"))
            db.commit()
    finally:
        db.close()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten this before deploying publicly
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")


@app.get("/health")
def health():
    return {"status": "ok"}