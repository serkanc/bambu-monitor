"""Authentication helpers for admin password hashing and verification."""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from typing import Tuple

DEFAULT_ITERATIONS = 200_000


def _encode_bytes(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _decode_bytes(value: str) -> bytes:
    padded = value + "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(padded.encode("ascii"))


def hash_password(password: str, *, iterations: int = DEFAULT_ITERATIONS) -> str:
    """Return a PBKDF2 hash string for the provided password."""

    if not password:
        raise ValueError("Password cannot be empty")
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("ascii"), iterations)
    return f"pbkdf2_sha256${iterations}${salt}${_encode_bytes(dk)}"


def _parse_hash(stored_hash: str) -> Tuple[int, str, bytes]:
    scheme, iter_str, salt, digest = stored_hash.split("$", 3)
    if scheme != "pbkdf2_sha256":
        raise ValueError("Unsupported password hash scheme")
    iterations = int(iter_str)
    return iterations, salt, _decode_bytes(digest)


def verify_password(password: str, stored_hash: str) -> bool:
    """Verify password against a stored PBKDF2 hash string."""

    if not password or not stored_hash:
        return False
    try:
        iterations, salt, digest = _parse_hash(stored_hash)
    except ValueError:
        return False
    computed = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("ascii"),
        iterations,
    )
    return hmac.compare_digest(computed, digest)
