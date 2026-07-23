from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import Session, select

from ..core.database import get_session
from ..core.security import verify_pw, make_token, current_user
from ..models import User

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login")
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_session)):
    user = db.exec(select(User).where(User.username == form.username)).first()
    if not user or not verify_pw(form.password, user.hashed_password):
        raise HTTPException(400, "اسم المستخدم أو كلمة المرور غير صحيحة")
    return {"access_token": make_token(user), "token_type": "bearer",
            "role": user.role, "branch": user.branch, "full_name": user.full_name}


@router.get("/me")
def me(user: User = Depends(current_user)):
    return {"username": user.username, "full_name": user.full_name,
            "role": user.role, "branch": user.branch}
