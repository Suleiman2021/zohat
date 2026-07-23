"""المصادقة والصلاحيات (JWT + RBAC)."""
from datetime import datetime
from typing import Optional
import jwt
import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlmodel import Session, select

from .config import SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE
from .database import get_session
from ..models import (User, ROLE_ADMIN, ROLE_SUPERVISOR, ROLE_ACCOUNTANT,
                      ROLE_COLLECTOR, ROLE_BROKER, ROLE_BRANCH, ALL_ROLES)

oauth2 = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def hash_pw(p: str) -> str:
    return bcrypt.hashpw(p.encode()[:72], bcrypt.gensalt()).decode()

def verify_pw(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode()[:72], h.encode())
    except Exception:
        return False


def make_token(user: User) -> str:
    payload = {"sub": user.username, "role": user.role, "branch": user.branch,
               "exp": datetime.utcnow() + ACCESS_TOKEN_EXPIRE}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def current_user(token: str = Depends(oauth2),
                 db: Session = Depends(get_session)) -> User:
    cred_err = HTTPException(status.HTTP_401_UNAUTHORIZED, "بيانات الدخول غير صحيحة")
    try:
        data = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = data.get("sub")
    except jwt.PyJWTError:
        raise cred_err
    user = db.exec(select(User).where(User.username == username)).first()
    if not user or not user.is_active:
        raise cred_err
    return user


def require(*roles):
    """ديكوريتر صلاحيات: يمنع فعلياً على مستوى الـAPI."""
    def dep(user: User = Depends(current_user)) -> User:
        if roles and user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "لا تملك صلاحية لهذا الإجراء")
        return user
    return dep


# اختصارات الصلاحيات
admin_only = require(ROLE_ADMIN)
# الإدارة + المشرف الإداري (صاحب الشركة): تعديل/حذف سجلات الشحنات
admin_or_supervisor = require(ROLE_ADMIN, ROLE_SUPERVISOR)
# حساب الجمارك والفواتير والحسابات: الإدارة + المشرف الإداري + المحاسب
admin_or_accountant = require(ROLE_ADMIN, ROLE_SUPERVISOR, ROLE_ACCOUNTANT)
# من يسجّل/يصدّر الشحنات: مسؤول التجميع + الإدارة + المشرف + الفرع
can_register = require(ROLE_ADMIN, ROLE_SUPERVISOR, ROLE_COLLECTOR, ROLE_BRANCH)
any_role = require(*ALL_ROLES)
