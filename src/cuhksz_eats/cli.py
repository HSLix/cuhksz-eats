#!/usr/bin/env python3
"""Public maintenance entry point for CUHKSZ Eats."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path

from PIL import Image, UnidentifiedImageError
from pillow_heif import register_heif_opener
from src.cuhksz_eats.image_derivatives import ImageDerivativeCache
from src.cuhksz_eats.source_archive import update_source_archive


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = REPOSITORY_ROOT / "images"
DEVELOPMENT_OUTPUT = REPOSITORY_ROOT / ".generated" / "dev" / "public"
DEVELOPMENT_IMAGE_CACHE = REPOSITORY_ROOT / ".generated" / "cache" / "images"
PUBLISH_OUTPUT = REPOSITORY_ROOT / ".generated" / "publish" / "public"
PUBLISH_IMAGE_CACHE = REPOSITORY_ROOT / ".generated" / "cache" / "images"
PRODUCTION_BUILD = REPOSITORY_ROOT / "dist"
SOURCE_ARCHIVE = REPOSITORY_ROOT / "images.zip"
SUPPORTED_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"}
IGNORED_NAMES = {".ds_store", "thumbs.db", "desktop.ini"}
PRICE_PATTERN = re.compile(r"(?:0|[1-9]\d*)(?:\.\d{1,2})?\Z")
CAMERA_TIME_PATTERN = re.compile(r"IMG_(\d{8})_(\d{6})", re.IGNORECASE)
MMEXPORT_TIME_PATTERN = re.compile(r"mmexport(\d{13}|\d{10})(?!\d)", re.IGNORECASE)
LEGACY_MARKERS = ("_菜单", "_门面", "－", "—", "–")
PUBLIC_DATE_FIELDS = {
    "capturedAt",
    "latestCapturedAt",
    "coverCapturedAt",
    "latestPriceCapturedAt",
}
PUBLIC_PHOTO_TITLES = {
    "photo": "普通照片",
    "menu": "菜单照片",
    "storefront": "门面照片",
}

register_heif_opener()


@dataclass(frozen=True)
class Photo:
    source: Path
    filename: str

    @property
    def fields(self) -> list[str]:
        return self.source.stem.split("-", 3)

    @property
    def kind(self) -> str:
        if len(self.fields) == 1:
            return "photo"
        if self.fields[1] == "菜单":
            return "menu"
        if self.fields[1] == "门面":
            return "storefront"
        return "dish"

    @property
    def title(self) -> str:
        return self.fields[1] if self.kind == "dish" else self.filename

    @property
    def price(self) -> str | None:
        if self.kind != "dish" or len(self.fields) < 3:
            return None
        return self.fields[2] or None

    @property
    def note(self) -> str | None:
        if self.kind != "dish" or len(self.fields) < 4:
            return None
        return self.fields[3] or None

    @property
    def captured_at(self) -> str | None:
        camera_match = CAMERA_TIME_PATTERN.match(self.fields[0])
        if camera_match:
            try:
                return dt.datetime.strptime(
                    "".join(camera_match.groups()), "%Y%m%d%H%M%S"
                ).isoformat()
            except ValueError:
                return None
        export_match = MMEXPORT_TIME_PATTERN.match(self.fields[0])
        if export_match:
            raw_timestamp = int(export_match.group(1))
            if len(export_match.group(1)) == 13:
                raw_timestamp //= 1000
            try:
                return dt.datetime.fromtimestamp(raw_timestamp, tz=dt.UTC).isoformat()
            except (OverflowError, OSError, ValueError):
                return None
        return None


@dataclass(frozen=True)
class Stall:
    name: str
    slug: str
    photos: tuple[Photo, ...]


@dataclass(frozen=True)
class DiningPlace:
    name: str
    slug: str
    photos: tuple[Photo, ...]
    stalls: tuple[Stall, ...] = ()

    @property
    def all_photos(self) -> tuple[Photo, ...]:
        return self.photos + tuple(photo for stall in self.stalls for photo in stall.photos)


@dataclass(frozen=True)
class Diagnostic:
    severity: str
    location: str
    reason: str
    example: str

    def render(self) -> str:
        label = "错误" if self.severity == "error" else "警告"
        return f"{label}：[{self.location}] {self.reason}。修正示例：{self.example}"


@dataclass(frozen=True)
class ValidationResult:
    places: tuple[DiningPlace, ...]
    diagnostics: tuple[Diagnostic, ...]

    @property
    def errors(self) -> tuple[Diagnostic, ...]:
        return tuple(item for item in self.diagnostics if item.severity == "error")

    @property
    def warnings(self) -> tuple[Diagnostic, ...]:
        return tuple(item for item in self.diagnostics if item.severity == "warning")


def publicize_content(value: object) -> None:
    """Remove build-only photo metadata from the final public content tree."""
    if isinstance(value, list):
        for item in value:
            publicize_content(item)
        return

    if not isinstance(value, dict):
        return

    photo_title = PUBLIC_PHOTO_TITLES.get(value.get("kind"))
    if photo_title is not None and "title" in value:
        value["title"] = photo_title

    for key, item in value.items():
        if key in PUBLIC_DATE_FIELDS and isinstance(item, str):
            value[key] = item[:10]
        else:
            publicize_content(item)


def relative_location(path: Path, source: Path) -> str:
    relative = path.relative_to(source).as_posix()
    return relative or "."


def ignored_path(path: Path) -> bool:
    return path.name.lower() in IGNORED_NAMES or path.name.startswith("._")


def diagnostic(
    diagnostics: list[Diagnostic],
    severity: str,
    path: Path,
    source: Path,
    reason: str,
    example: str,
) -> None:
    diagnostics.append(
        Diagnostic(
            severity=severity,
            location=relative_location(path, source),
            reason=reason,
            example=example,
        )
    )


def prefix_has_parseable_time(prefix: str) -> bool:
    camera_match = CAMERA_TIME_PATTERN.match(prefix)
    if camera_match:
        try:
            dt.datetime.strptime("".join(camera_match.groups()), "%Y%m%d%H%M%S")
            return True
        except ValueError:
            return False

    export_match = MMEXPORT_TIME_PATTERN.match(prefix)
    if export_match:
        raw_timestamp = int(export_match.group(1))
        if len(export_match.group(1)) == 13:
            raw_timestamp //= 1000
        try:
            dt.datetime.fromtimestamp(raw_timestamp, tz=dt.UTC)
            return True
        except (OverflowError, OSError, ValueError):
            return False
    return False


def valid_price(value: str) -> bool:
    if not PRICE_PATTERN.fullmatch(value):
        return False
    try:
        return value == "0" or Decimal(value) > 0
    except InvalidOperation:
        return False


def validate_structured_name(
    photo: Path,
    source: Path,
    diagnostics: list[Diagnostic],
) -> str:
    stem = photo.stem
    fields = stem.split("-", 3)
    prefix = fields[0]

    if not prefix:
        diagnostic(
            diagnostics,
            "error",
            photo,
            source,
            "源前缀不能为空",
            f"IMG_20260907_120000-{fields[1] or '菜品'}{photo.suffix}",
        )

    if len(fields) == 1:
        if any(marker in stem for marker in LEGACY_MARKERS):
            corrected_stem = stem.replace("_菜单", "-菜单").replace("_门面", "-门面")
            for marker in ("－", "—", "–"):
                corrected_stem = corrected_stem.replace(marker, "-")
            diagnostic(
                diagnostics,
                "warning",
                photo,
                source,
                "疑似使用旧结构命名",
                f"{corrected_stem}{photo.suffix}",
            )
        elif re.search(r"(?:\d+(?:\.\d+)?\s*元|\s\d+(?:\.\d+)?\s*)", stem):
            diagnostic(
                diagnostics,
                "warning",
                photo,
                source,
                "疑似想表达结构化内容，但无法确定菜名与价格字段",
                f"IMG_20260907_120000-菜品-18{photo.suffix}",
            )
        return prefix

    dish_name = fields[1]
    if any(field != field.strip() for field in fields[:2]):
        diagnostic(
            diagnostics,
            "warning",
            photo,
            source,
            "结构化名称字段包含首尾空格",
            f"{'-'.join(field.strip() for field in fields)}{photo.suffix}",
        )
    if not dish_name:
        diagnostic(
            diagnostics,
            "error",
            photo,
            source,
            "菜品名称不能为空",
            f"{prefix or 'IMG_20260907_120000'}-菜品-18{photo.suffix}",
        )

    if dish_name in {"菜单", "门面"} and len(fields) > 2:
        diagnostic(
            diagnostics,
            "error",
            photo,
            source,
            f"保留类型“{dish_name}”不能包含价格或附言字段",
            f"{prefix}-{dish_name}{photo.suffix}",
        )

    if len(fields) == 3:
        price = fields[2]
        if not price:
            diagnostic(
                diagnostics,
                "error",
                photo,
                source,
                "结构化字段为空；没有价格时应省略该字段，有附言时应保留空价格并填写附言",
                f"{prefix}-菜品--记录者随记{photo.suffix}",
            )
        elif not valid_price(price):
            diagnostic(
                diagnostics,
                "error",
                photo,
                source,
                f"菜品价格“{price}”非法；应为 0 或最多两位小数的正数",
                f"{prefix}-菜品-18.50{photo.suffix}",
            )
    elif len(fields) == 4:
        price, note = fields[2], fields[3]
        if not note:
            diagnostic(
                diagnostics,
                "error",
                photo,
                source,
                "结构化字段为空；附言分隔符后必须填写内容",
                f"{prefix}-菜品--记录者随记{photo.suffix}",
            )
        if price and not valid_price(price):
            diagnostic(
                diagnostics,
                "error",
                photo,
                source,
                f"菜品价格“{price}”非法；应为 0 或最多两位小数的正数",
                f"{prefix}-菜品-18.50-{note or '记录者随记'}{photo.suffix}",
            )
    return prefix


def validate_content(source: Path) -> ValidationResult:
    diagnostics: list[Diagnostic] = []
    places: list[DiningPlace] = []

    if not source.is_dir():
        return ValidationResult(
            places=(),
            diagnostics=(
                Diagnostic(
                    severity="error",
                    location=str(source),
                    reason="源图片目录不存在",
                    example="创建 images/ 目录并把照片放入约定层级",
                ),
            ),
        )

    directories = sorted(path for path in source.rglob("*") if path.is_dir())
    invalid_directories: set[Path] = set()
    for directory in directories:
        relative = directory.relative_to(source)
        if len(relative.parts) > 2:
            invalid_directories.add(directory)
            diagnostic(
                diagnostics,
                "error",
                directory,
                source,
                "非法目录深度；图片目录最多为餐饮地点/档口或 _校园补充/相册两层",
                "测试餐饮地点/测试档口/IMG_20260907_120000.jpg",
            )
            continue
        if directory.name != directory.name.strip():
            diagnostic(
                diagnostics,
                "warning",
                directory,
                source,
                "名称包含首尾空格",
                directory.name.strip() or "测试餐饮地点",
            )

    prefixes_by_owner: dict[Path, dict[str, Path]] = {}

    for candidate in sorted(source.rglob("*")):
        if candidate.is_dir() or ignored_path(candidate):
            continue
        if any(parent in invalid_directories for parent in candidate.parents):
            continue
        if candidate.suffix.lower() not in SUPPORTED_IMAGE_SUFFIXES:
            diagnostic(
                diagnostics,
                "error",
                candidate,
                source,
                "不支持的文件类型；仅支持 JPEG、PNG、WebP、HEIC 和 HEIF",
                f"{candidate.stem}.jpg",
            )
            continue
        try:
            with Image.open(candidate) as image:
                image.verify()
        except (OSError, SyntaxError, UnidentifiedImageError):
            diagnostic(
                diagnostics,
                "error",
                candidate,
                source,
                "图片已损坏或无法解码",
                "从原始相册重新导出该图片后替换此文件",
            )

        if candidate.stem != candidate.stem.strip():
            diagnostic(
                diagnostics,
                "warning",
                candidate,
                source,
                "名称包含首尾空格",
                f"{candidate.stem.strip() or 'IMG_20260907_120000'}{candidate.suffix}",
            )

        relative_parts = candidate.relative_to(source).parts
        structured_owner = (
            len(relative_parts) > 1 and relative_parts[0] != "_校园补充"
        )
        if structured_owner:
            prefix = validate_structured_name(candidate, source, diagnostics)
        else:
            prefix = candidate.stem.split("-", 1)[0]

        owner_prefixes = prefixes_by_owner.setdefault(candidate.parent, {})
        previous = owner_prefixes.get(prefix)
        if previous is not None:
            diagnostic(
                diagnostics,
                "error",
                candidate,
                source,
                f"源前缀“{prefix}”在同一归属内重名",
                f"IMG_20260907_120001{candidate.suffix}",
            )
        else:
            owner_prefixes[prefix] = candidate

        if not prefix_has_parseable_time(prefix):
            diagnostic(
                diagnostics,
                "warning",
                candidate,
                source,
                f"无法从源前缀“{prefix}”解析拍摄时间",
                f"IMG_20260907_120000{candidate.suffix}",
            )

    for directory in sorted(path for path in source.iterdir() if path.is_dir()):
        if directory.name == "_校园补充":
            continue
        photos = tuple(
            Photo(source=photo, filename=photo.name)
            for photo in sorted(directory.iterdir())
            if photo.is_file()
            and not ignored_path(photo)
            and photo.suffix.lower() in SUPPORTED_IMAGE_SUFFIXES
        )
        stalls = tuple(
            Stall(
                name=stall_directory.name,
                slug=stall_directory.name,
                photos=tuple(
                    Photo(source=photo, filename=photo.name)
                    for photo in sorted(stall_directory.iterdir())
                    if photo.is_file()
                    and not ignored_path(photo)
                    and photo.suffix.lower() in SUPPORTED_IMAGE_SUFFIXES
                ),
            )
            for stall_directory in sorted(directory.iterdir())
            if stall_directory.is_dir()
            and any(
                photo.is_file()
                and not ignored_path(photo)
                and photo.suffix.lower() in SUPPORTED_IMAGE_SUFFIXES
                for photo in stall_directory.iterdir()
            )
        )
        if photos or stalls:
            places.append(DiningPlace(directory.name, directory.name, photos, stalls))

    if not places:
        diagnostic(
            diagnostics,
            "error",
            source,
            source,
            "没有找到包含普通照片的餐饮地点目录",
            "images/测试餐饮地点/IMG_20260907_120000.jpg",
        )

    return ValidationResult(places=tuple(places), diagnostics=tuple(diagnostics))


def run_check(source: Path) -> list[DiningPlace] | None:
    result = validate_content(source)
    for item in result.diagnostics:
        print(item.render(), file=sys.stderr)

    if result.errors:
        print(f"检查失败：发现 {len(result.errors)} 个错误。", file=sys.stderr)
        return None

    photo_count = sum(len(place.all_photos) for place in result.places)
    warning_summary = f"，{len(result.warnings)} 个警告" if result.warnings else ""
    print(
        f"检查通过：{len(result.places)} 个餐饮地点，{photo_count} 张图片{warning_summary}。"
    )
    return list(result.places)


def build_development_content(
    places: list[DiningPlace],
    source: Path,
    output: Path,
    cache_directory: Path = DEVELOPMENT_IMAGE_CACHE,
) -> tuple[int, int]:
    output.mkdir(parents=True, exist_ok=True)
    media_directory = output / "media"
    image_cache = ImageDerivativeCache(source, cache_directory, media_directory)

    def serialize_photo(photo: Photo) -> dict[str, object]:
        return {
            **image_cache.derive(photo.source, photo.kind),
            "title": photo.title,
            "kind": photo.kind,
            "capturedAt": photo.captured_at,
            "price": photo.price,
            "note": photo.note,
        }

    def latest_photo(photos: list[dict[str, object]]) -> dict[str, object]:
        return max(
            photos,
            key=lambda photo: (
                photo["capturedAt"] is not None,
                photo["capturedAt"] or "",
                photo["src"],
            ),
        )

    def latest_time(items: list[dict[str, object]]) -> str | None:
        return max(
            (str(item["capturedAt"]) for item in items if item["capturedAt"]),
            default=None,
        )

    def newest_first(
        items: list[dict[str, object]],
        time_key,
        secondary_key,
    ) -> list[dict[str, object]]:
        stable_items = sorted(items, key=secondary_key)
        return sorted(stable_items, key=lambda item: time_key(item) or "", reverse=True)

    def sort_photos(photos: list[dict[str, object]]) -> list[dict[str, object]]:
        return newest_first(
            photos,
            lambda photo: photo["capturedAt"],
            lambda photo: str(photo["src"]),
        )

    def cover_title(photo: dict[str, object]) -> str | None:
        labels = {
            "storefront": "门面照片",
            "menu": "菜单照片",
            "photo": "普通照片",
        }
        return labels.get(photo["kind"], photo["title"])

    def serialize_dishes(
        photos: list[dict[str, object]],
    ) -> list[dict[str, object]]:
        records_by_name: dict[str, list[dict[str, object]]] = {}
        for photo in photos:
            if photo["kind"] == "dish":
                records_by_name.setdefault(str(photo["title"]), []).append(photo)

        dishes = []
        for name, records in records_by_name.items():
            records.sort(
                key=lambda record: (
                    record["capturedAt"] is None,
                    record["capturedAt"] or "",
                    record["src"],
                )
            )
            dated_records = [record for record in records if record["capturedAt"]]
            cover = dated_records[-1] if dated_records else records[-1]
            priced_records = [record for record in records if record["price"] is not None]
            dated_priced_records = [
                record
                for record in priced_records
                if record["capturedAt"] is not None
            ]
            latest_price = (
                dated_priced_records[-1]
                if dated_priced_records
                else priced_records[-1] if priced_records else None
            )
            dishes.append(
                {
                    "name": name,
                    "slug": name,
                    "cover": cover["src"],
                    "coverImage": cover,
                    "coverCapturedAt": cover["capturedAt"],
                    "latestPrice": latest_price["price"] if latest_price else None,
                    "latestPriceCapturedAt": (
                        latest_price["capturedAt"] if latest_price else None
                    ),
                    "records": records,
                    "recordCount": len(records),
                }
            )
        return newest_first(
            dishes,
            lambda dish: dish["coverCapturedAt"],
            lambda dish: str(dish["name"]),
        )

    serialized_places = []
    for place in places:
        serialized_photos = sort_photos(
            [serialize_photo(photo) for photo in place.photos]
        )
        serialized_stalls = []
        for stall in place.stalls:
            stall_photos = sort_photos(
                [serialize_photo(photo) for photo in stall.photos]
            )
            stall_cover = None
            for kind in ("storefront", "menu"):
                candidates = [photo for photo in stall_photos if photo["kind"] == kind]
                if candidates:
                    stall_cover = latest_photo(candidates)
                    break
            if stall_cover is None:
                remaining_photos = [
                    photo
                    for photo in stall_photos
                    if photo["kind"] not in {"storefront", "menu"}
                ]
                if remaining_photos:
                    stall_cover = latest_photo(remaining_photos)
            serialized_stalls.append(
                {
                    "name": stall.name,
                    "slug": stall.slug,
                    "photos": stall_photos,
                    "dishes": serialize_dishes(stall_photos),
                    "photoCount": len(stall_photos),
                    "cover": stall_cover["src"] if stall_cover else None,
                    "coverImage": stall_cover,
                    "coverTitle": cover_title(stall_cover) if stall_cover else None,
                    "latestCapturedAt": latest_time(stall_photos),
                }
            )
        serialized_stalls = newest_first(
            serialized_stalls,
            lambda stall: stall["latestCapturedAt"],
            lambda stall: str(stall["name"]),
        )
        cover_photo = None
        for kind in ("storefront", "dish", "photo"):
            candidates = [photo for photo in serialized_photos if photo["kind"] == kind]
            if candidates:
                cover_photo = latest_photo(candidates)
                break
        serialized_places.append(
            {
                "name": place.name,
                "slug": place.slug,
                "cover": cover_photo["src"] if cover_photo else None,
                "coverImage": cover_photo,
                "coverTitle": (
                    cover_title(cover_photo) if cover_photo else None
                ),
                "photos": serialized_photos,
                "dishes": serialize_dishes(serialized_photos),
                "stalls": serialized_stalls,
                "photoCount": len(place.all_photos),
                "latestCapturedAt": latest_time(
                    serialized_photos
                    + [
                        photo
                        for stall in serialized_stalls
                        for photo in stall["photos"]
                    ]
                ),
            }
        )

    serialized_places = newest_first(
        serialized_places,
        lambda place: place["latestCapturedAt"],
        lambda place: str(place["name"]),
    )

    supplementary_photos = sort_photos(
        [
            serialize_photo(Photo(photo, photo.name))
            for photo in sorted(source.iterdir())
            if photo.is_file()
            and not ignored_path(photo)
            and photo.suffix.lower() in SUPPORTED_IMAGE_SUFFIXES
        ]
    )
    supplementary_root = source / "_校园补充"
    supplementary_albums = []
    if supplementary_root.is_dir():
        for album_directory in sorted(supplementary_root.iterdir()):
            if not album_directory.is_dir():
                continue
            album_photos = sort_photos(
                [
                    serialize_photo(Photo(photo, photo.name))
                    for photo in sorted(album_directory.iterdir())
                    if photo.is_file()
                    and not ignored_path(photo)
                    and photo.suffix.lower() in SUPPORTED_IMAGE_SUFFIXES
                ]
            )
            if album_photos:
                supplementary_albums.append(
                    {
                        "name": album_directory.name,
                        "photos": album_photos,
                        "latestCapturedAt": latest_time(album_photos),
                    }
                )
    supplementary_albums = newest_first(
        supplementary_albums,
        lambda album: album["latestCapturedAt"],
        lambda album: str(album["name"]),
    )

    search_index = []
    for place in serialized_places:
        place_path = f'/places/{place["slug"]}'
        search_index.append(
            {
                "id": f"place:{place_path}",
                "type": "place",
                "typeLabel": "餐饮地点",
                "name": place["name"],
                "ownerLabel": "餐饮地点",
                "path": place_path,
            }
        )
        for dish in place["dishes"]:
            search_index.append(
                {
                    "id": f'place-dish:{place_path}/dishes/{dish["slug"]}',
                    "type": "dish",
                    "typeLabel": "菜品",
                    "name": dish["name"],
                    "ownerLabel": f'未归档菜品 · {place["name"]}',
                    "path": f'{place_path}/dishes/{dish["slug"]}',
                }
            )
        for stall in place["stalls"]:
            stall_path = f'{place_path}/stalls/{stall["slug"]}'
            search_index.append(
                {
                    "id": f"stall:{stall_path}",
                    "type": "stall",
                    "typeLabel": "档口",
                    "name": stall["name"],
                    "ownerLabel": f'所属餐饮地点 · {place["name"]}',
                    "path": stall_path,
                }
            )
            for dish in stall["dishes"]:
                search_index.append(
                    {
                        "id": f'stall-dish:{stall_path}/dishes/{dish["slug"]}',
                        "type": "dish",
                        "typeLabel": "菜品",
                        "name": dish["name"],
                        "ownerLabel": f'{place["name"]} · {stall["name"]}',
                        "path": f'{stall_path}/dishes/{dish["slug"]}',
                    }
                )

    content = {
        "projectName": "CUHKSZ Eats",
        "places": serialized_places,
        "searchIndex": search_index,
        "campusSupplementary": {
            "photos": supplementary_photos,
            "albums": supplementary_albums,
        },
    }
    publicize_content(content)
    (output / "content.json").write_text(
        json.dumps(content, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    image_cache.finish()
    return image_cache.generated, image_cache.reused


def run_dev(source: Path, host: str, port: int) -> int:
    places = run_check(source)
    if places is None:
        return 1

    generated, reused = build_development_content(places, source, DEVELOPMENT_OUTPUT)
    print(f"已生成一次性本地内容：{DEVELOPMENT_OUTPUT.relative_to(REPOSITORY_ROOT)}")
    print(f"图片派生：新生成 {generated} 个，复用 {reused} 个。")
    print(f"正在启动本地预览：http://{host}:{port}", flush=True)

    vite = REPOSITORY_ROOT / "node_modules" / ".bin" / "vite"
    if not vite.exists():
        print("错误：前端依赖尚未安装，请先运行 npm install。", file=sys.stderr)
        return 1

    environment = os.environ.copy()
    environment["CUHKSZ_EATS_PUBLIC_DIR"] = str(DEVELOPMENT_OUTPUT)
    os.execve(
        vite,
        [str(vite), "--host", host, "--port", str(port), "--strictPort"],
        environment,
    )
    return 0


def publish_base_path(value: str) -> str:
    if not value.startswith("/") or not value.endswith("/"):
        raise argparse.ArgumentTypeError("发布基路径必须以 / 开头并以 / 结尾")
    return value


def run_publish(source: Path, base_path: str | None = None) -> int:
    configured_base_path = base_path or os.environ.get("CUHKSZ_EATS_BASE_PATH")
    if configured_base_path:
        try:
            configured_base_path = publish_base_path(configured_base_path)
        except argparse.ArgumentTypeError as error:
            print(f"错误：{error}", file=sys.stderr)
            return 1

    places = run_check(source)
    if places is None:
        return 1

    try:
        archive = update_source_archive(source, SOURCE_ARCHIVE)
    except (OSError, RuntimeError, zipfile.LargeZipFile) as error:
        print(f"错误：无法更新本地原图归档：{error}", file=sys.stderr)
        return 1
    print(f"内容哈希：sha256:{archive.digest}")
    archive_messages = {
        "created": "已创建本地原图归档：images.zip",
        "updated": "已更新本地原图归档：images.zip",
        "unchanged": "原图内容未变化，保留本地归档：images.zip",
    }
    print(archive_messages[archive.status])

    npm = shutil.which("npm")
    git = shutil.which("git")
    if npm is None:
        print("错误：找不到 npm，请先安装 Node.js 20+。", file=sys.stderr)
        return 1
    if git is None:
        print("错误：找不到 Git，无法更新 gh-pages。", file=sys.stderr)
        return 1

    try:
        repository_check = subprocess.run(
            [git, "rev-parse", "--show-toplevel"],
            cwd=REPOSITORY_ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
        if Path(repository_check.stdout.strip()).resolve() != REPOSITORY_ROOT:
            raise RuntimeError("manage.py 必须从项目 Git 仓库运行")
        remote_url = subprocess.run(
            [git, "remote", "get-url", "--push", "origin"],
            cwd=REPOSITORY_ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    except (subprocess.CalledProcessError, RuntimeError) as error:
        detail = error.stderr.strip() if isinstance(error, subprocess.CalledProcessError) and error.stderr else str(error)
        print(f"错误：发布仓库配置无效：{detail}", file=sys.stderr)
        return 1

    print("已通过校验，正在生成去敏公开内容。")
    shutil.rmtree(PUBLISH_OUTPUT, ignore_errors=True)
    generated, reused = build_development_content(
        places,
        source,
        PUBLISH_OUTPUT,
        PUBLISH_IMAGE_CACHE,
    )
    (PUBLISH_OUTPUT / ".nojekyll").touch()
    print(f"图片派生：新生成 {generated} 个，复用 {reused} 个。")

    environment = os.environ.copy()
    environment["CUHKSZ_EATS_PUBLIC_DIR"] = str(PUBLISH_OUTPUT)
    if configured_base_path:
        environment["CUHKSZ_EATS_BASE_PATH"] = configured_base_path
    else:
        repository_name = remote_url.rstrip("/").rsplit("/", 1)[-1]
        if ":" in repository_name:
            repository_name = repository_name.rsplit(":", 1)[-1]
        if repository_name.endswith(".git"):
            repository_name = repository_name[:-4]
        environment["CUHKSZ_EATS_BASE_PATH"] = (
            "/" if repository_name.lower().endswith(".github.io") else f"/{repository_name}/"
        )
    try:
        subprocess.run(
            [npm, "run", "build"],
            cwd=REPOSITORY_ROOT,
            env=environment,
            check=True,
        )

        with tempfile.TemporaryDirectory(prefix="cuhksz-eats-publish-") as temporary:
            git_environment = environment.copy()
            git_environment["GIT_INDEX_FILE"] = str(Path(temporary) / "index")
            git_base = [
                git,
                f"--git-dir={REPOSITORY_ROOT / '.git'}",
                f"--work-tree={PRODUCTION_BUILD}",
            ]
            subprocess.run(
                [*git_base, "add", "--all", "--force", "."],
                cwd=REPOSITORY_ROOT,
                env=git_environment,
                check=True,
            )
            tree = subprocess.run(
                [*git_base, "write-tree"],
                cwd=REPOSITORY_ROOT,
                env=git_environment,
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
            commit = subprocess.run(
                [git, "commit-tree", tree, "-m", "Deploy CUHKSZ Eats"],
                cwd=REPOSITORY_ROOT,
                env=git_environment,
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
            subprocess.run(
                [git, "push", "--force", "origin", f"{commit}:refs/heads/gh-pages"],
                cwd=REPOSITORY_ROOT,
                env=git_environment,
                check=True,
            )
    except subprocess.CalledProcessError as error:
        print(f"错误：发布失败（命令退出码 {error.returncode}），gh-pages 未完成更新。", file=sys.stderr)
        return 1

    print("发布完成：gh-pages 已替换为本次完整静态站点。")
    return 0


def create_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="CUHKSZ Eats 内容维护工具")
    subparsers = parser.add_subparsers(dest="command", required=True)

    check_parser = subparsers.add_parser("check", help="检查本地源图片")
    check_parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)

    dev_parser = subparsers.add_parser("dev", help="检查内容并启动本地预览")
    dev_parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    dev_parser.add_argument("--host", default="127.0.0.1")
    dev_parser.add_argument("--port", type=int, default=5173)

    publish_parser = subparsers.add_parser("publish", help="检查内容并进入发布流程")
    publish_parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    publish_parser.add_argument(
        "--base-path",
        type=publish_base_path,
        help="覆盖生产站点基路径（必须以 / 开头并以 / 结尾）",
    )
    return parser


def main() -> int:
    arguments = create_parser().parse_args()
    source = arguments.source.expanduser().resolve()
    if arguments.command == "check":
        return 0 if run_check(source) is not None else 1
    if arguments.command == "dev":
        return run_dev(source, arguments.host, arguments.port)
    return run_publish(source, arguments.base_path)


if __name__ == "__main__":
    raise SystemExit(main())
