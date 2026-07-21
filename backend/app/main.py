from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.api.auth_routes import router as auth_router
from app.core.database import engine
from app.models.models import Base

app = FastAPI(title="API Guardian", version="0.1.0")


@app.on_event("startup")
def create_tables():
    # Creates any tables that don't exist yet. Safe to run every startup —
    # it only adds missing tables, never touches ones that already exist.
    # Fine for local dev; once this project needs real migrations (schema
    # changes on existing data), switch to Alembic instead.
    Base.metadata.create_all(bind=engine)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")
app.include_router(auth_router, prefix="/api")


@app.get("/health")
def health():
    return {"status": "ok"}