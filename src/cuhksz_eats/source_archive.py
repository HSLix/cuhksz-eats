"""Local, content-addressed archive of the private source-image tree."""

from __future__ import annotations

import hashlib
import os
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path


ARCHIVE_COMMENT_PREFIX = b"CUHKSZ_EATS_SOURCE_SHA256="


@dataclass(frozen=True)
class SourceArchiveResult:
    digest: str
    status: str


def _source_files(source: Path) -> list[Path]:
    return sorted(path for path in source.rglob("*") if path.is_file())


def source_tree_digest(source: Path) -> tuple[str, list[Path]]:
    files = _source_files(source)
    digest = hashlib.sha256()
    for path in files:
        relative = path.relative_to(source).as_posix().encode("utf-8")
        digest.update(len(relative).to_bytes(8, "big"))
        digest.update(relative)
        with path.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
    return digest.hexdigest(), files


def _archived_digest(archive: Path) -> str | None:
    try:
        with zipfile.ZipFile(archive) as existing:
            comment = existing.comment
    except (OSError, zipfile.BadZipFile):
        return None
    if not comment.startswith(ARCHIVE_COMMENT_PREFIX):
        return None
    candidate = comment.removeprefix(ARCHIVE_COMMENT_PREFIX).decode("ascii", errors="ignore")
    return candidate if len(candidate) == 64 else None


def update_source_archive(source: Path, archive: Path) -> SourceArchiveResult:
    digest, files = source_tree_digest(source)
    if _archived_digest(archive) == digest:
        return SourceArchiveResult(digest=digest, status="unchanged")

    status = "updated" if archive.exists() else "created"
    archive.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        dir=archive.parent,
        prefix=f".{archive.name}-",
        suffix=".tmp",
    )
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        with zipfile.ZipFile(
            temporary,
            mode="w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=6,
            allowZip64=True,
        ) as output:
            for path in files:
                relative = path.relative_to(source).as_posix()
                output.write(path, arcname=f"images/{relative}")
            output.comment = ARCHIVE_COMMENT_PREFIX + digest.encode("ascii")
        temporary.replace(archive)
    finally:
        temporary.unlink(missing_ok=True)

    return SourceArchiveResult(digest=digest, status=status)
