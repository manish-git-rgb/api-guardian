"""
Authentication routes: email/password signup+login, and Google OAuth.

Google OAuth flow:
  1. Frontend links to GET /api/auth/google/login
  2. That redirects the browser to Google's consent screen
  3. Google redirects back to GET /api/auth/google/callback with a `code`
  4. We exchange that code for Google's tokens, fetch the user's email,
     find-or-create a User row, issue our own JWT, and redirect to the
     frontend with the token as a query param.
"""
import os

import requests
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import (
    hash_password, verify_password, create_access_token, get_current_user
)
from app.models.models import User
from app.schemas.schemas import UserCreate, UserLogin, Token, UserOut

router = APIRouter()

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"


@router.post("/auth/signup", response_model=Token)
def signup(payload: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Email already registered")

    user = User(
        email=payload.email,
        hashed_password=hash_password(payload.password),
        auth_provider="email",
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id)
    return Token(access_token=token)


@router.post("/auth/login", response_model=Token)
def login(payload: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not user.hashed_password or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password")

    token = create_access_token(user.id)
    return Token(access_token=token)


@router.get("/auth/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.get("/auth/google/login")
def google_login():
    params = (
        f"client_id={GOOGLE_CLIENT_ID}"
        f"&redirect_uri={GOOGLE_REDIRECT_URI}"
        f"&response_type=code"
        f"&scope=openid%20email%20profile"
        f"&access_type=offline"
        f"&prompt=consent"
    )
    return RedirectResponse(f"{GOOGLE_AUTH_URL}?{params}")


@router.get("/auth/google/callback")
def google_callback(code: str, db: Session = Depends(get_db)):
    # Exchange the authorization code for Google's tokens
    token_response = requests.post(GOOGLE_TOKEN_URL, data={
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": GOOGLE_REDIRECT_URI,
    })
    if not token_response.ok:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Failed to exchange code with Google")

    google_access_token = token_response.json().get("access_token")

    # Fetch the user's Google profile (we only need the email)
    userinfo_response = requests.get(
        GOOGLE_USERINFO_URL,
        headers={"Authorization": f"Bearer {google_access_token}"},
    )
    if not userinfo_response.ok:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Failed to fetch Google user info")

    email = userinfo_response.json().get("email")
    if not email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Google account has no email")

    # Find or create the user
    user = db.query(User).filter(User.email == email).first()
    if not user:
        user = User(email=email, hashed_password=None, auth_provider="google")
        db.add(user)
        db.commit()
        db.refresh(user)

    our_token = create_access_token(user.id)

    # Redirect back to the frontend with our JWT as a query param —
    # the frontend's /auth/callback page picks this up and stores it.
    return RedirectResponse(f"{FRONTEND_URL}/auth/callback?token={our_token}")