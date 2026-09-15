"""비밀번호 해시, 세션 쿠키, CSRF(double-submit + Origin 확인), 로그인 시도 제한."""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone

from fastapi import Request, Response

from . import config
from .db import new_id, now_iso
from .errors import ApiError

SESSION_COOKIE = "lf_session"
CSRF_COOKIE = "lf_csrf"
CSRF_HEADER = "x-csrf-token"

_N, _R, _P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${_R}${_P}${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt_b64, dk_b64 = stored.split("$")
        dk = hashlib.scrypt(
            password.encode(), salt=base64.b64decode(salt_b64), n=int(n), r=int(r), p=int(p), dklen=32
        )
        return hmac.compare_digest(dk, base64.b64decode(dk_b64))
    except Exception:
        return False


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(conn, user_id: str, response: Response) -> None:
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(days=config.SESSION_DAYS)
    conn.execute(
        "INSERT INTO auth_sessions(id,user_id,token_hash,created_at,expires_at) VALUES(?,?,?,?,?)",
        (new_id(), user_id, _token_hash(token), now_iso(), expires.isoformat(timespec="seconds")),
    )
    response.set_cookie(
        SESSION_COOKIE, token, httponly=True, samesite="lax", secure=config.COOKIE_SECURE,
        max_age=config.SESSION_DAYS * 86400, path="/",
    )
    rotate_csrf(response)


def rotate_csrf(response: Response) -> str:
    token = secrets.token_urlsafe(24)
    response.set_cookie(CSRF_COOKIE, token, httponly=False, samesite="lax", secure=config.COOKIE_SECURE, path="/")
    return token


def revoke_session(conn, request: Request, response: Response) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        conn.execute(
            "UPDATE auth_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL", (now_iso(), _token_hash(token))
        )
    response.delete_cookie(SESSION_COOKIE, path="/")


def session_user(conn, request: Request):
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise ApiError(401, "AUTH_REQUIRED", "로그인이 필요합니다.")
    row = conn.execute(
        "SELECT u.* , s.expires_at FROM auth_sessions s JOIN users u ON u.id=s.user_id "
        "WHERE s.token_hash=? AND s.revoked_at IS NULL",
        (_token_hash(token),),
    ).fetchone()
    if not row or row["expires_at"] <= now_iso():
        raise ApiError(401, "SESSION_EXPIRED", "로그인 세션이 만료되었습니다. 다시 로그인해 주세요.")
    return row


def check_csrf(request: Request) -> None:
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return
    origin = request.headers.get("origin")
    if origin and origin not in config.ALLOWED_ORIGINS:
        raise ApiError(403, "ORIGIN_REJECTED", "허용되지 않은 출처의 요청입니다.")
    header = request.headers.get(CSRF_HEADER) or ""
    cookie = request.cookies.get(CSRF_COOKIE) or ""
    if not header or not cookie or not hmac.compare_digest(header, cookie):
        raise ApiError(403, "CSRF_FAILED", "보안 토큰이 맞지 않습니다. 페이지를 새로고침해 주세요.")


class LoginLimiter:
    """이메일+IP 기준 1분에 실패 5회 초과 시 잠시 차단(메모리, 단일 프로세스 데모 범위)."""

    def __init__(self, limit: int = 5, window: float = 60.0):
        self.limit = limit
        self.window = window
        self._fails: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            fails = [t for t in self._fails.get(key, []) if now - t < self.window]
            self._fails[key] = fails
            if len(fails) >= self.limit:
                raise ApiError(429, "TOO_MANY_ATTEMPTS", "로그인 시도가 많습니다. 1분 뒤 다시 시도해 주세요.")

    def fail(self, key: str) -> None:
        with self._lock:
            self._fails.setdefault(key, []).append(time.monotonic())

    def reset(self, key: str) -> None:
        with self._lock:
            self._fails.pop(key, None)


login_limiter = LoginLimiter()
