import logging
from fastapi import APIRouter, HTTPException, Depends, Response, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.schemas.auth import RegisterRequest, LoginRequest, TokenResponse, UserResponse, ApiKeyRequest, UpdateProfileRequest
from app.services.auth import hash_password, verify_password, create_access_token
from app.config import get_settings
from typing import Optional
from app.api.deps import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()


def _user_response(user: User) -> UserResponse:
    return UserResponse(
        id=user.id,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        has_api_key=user.anthropic_api_key is not None,
        created_at=user.created_at,
    )


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(request: RegisterRequest, db: Session = Depends(get_db)) -> TokenResponse:
    existing = db.query(User).filter(User.email == request.email).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    user = User(
        email=request.email,
        password_hash=hash_password(request.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    logger.info("New user registered: %s (id=%s)", user.email, user.id)

    token = create_access_token(user.id)
    return TokenResponse(access_token=token)


@router.post("/login", response_model=TokenResponse)
async def login(request: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = db.query(User).filter(User.email == request.email).first()
    if not user or not verify_password(request.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    logger.info("User logged in: %s (id=%s)", user.email, user.id)
    token = create_access_token(user.id)
    return TokenResponse(access_token=token)


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)) -> UserResponse:
    return _user_response(current_user)


@router.put("/api-key", response_model=UserResponse)
async def save_api_key(
    request: ApiKeyRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserResponse:
    if not request.api_key.startswith("sk-ant-"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Anthropic API key format")

    from app.services.encryption import encrypt
    current_user.anthropic_api_key = encrypt(request.api_key)
    db.commit()
    db.refresh(current_user)
    logger.info("API key updated for user: %s (id=%s)", current_user.email, current_user.id)
    return _user_response(current_user)


@router.put("/profile", response_model=UserResponse)
async def update_profile(
    request: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserResponse:
    # Password change requires current password verification
    if request.new_password:
        if not request.current_password:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password required to set a new password")
        if not verify_password(request.current_password, current_user.password_hash):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
        current_user.password_hash = hash_password(request.new_password)

    if request.email and request.email != current_user.email:
        existing = db.query(User).filter(User.email == request.email).first()
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already in use")
        current_user.email = request.email

    if request.first_name is not None:
        current_user.first_name = request.first_name or None
    if request.last_name is not None:
        current_user.last_name = request.last_name or None

    db.commit()
    db.refresh(current_user)
    logger.info("Profile updated for user: %s (id=%s)", current_user.email, current_user.id)
    return _user_response(current_user)


@router.post("/web-login")
async def web_login(
    request: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> dict:
    user = db.query(User).filter(User.email == request.email).first()
    if not user or not verify_password(request.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    token = create_access_token(user.id)
    settings = get_settings()
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=settings.environment == "production",
        samesite="lax",
        max_age=60 * 60 * 24 * 7,  # 7 days
    )
    logger.info("Web login for user: %s (id=%s)", user.email, user.id)
    return {"ok": True}


@router.post("/web-logout")
async def web_logout(response: Response) -> dict:
    response.delete_cookie(key="access_token")
    return {"ok": True}
