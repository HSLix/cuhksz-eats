"""Incremental, metadata-safe responsive image generation."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
from pathlib import Path

from PIL import Image, ImageOps


DEFAULT_IMAGE_WIDTHS = (360, 720, 1200)
MENU_IMAGE_WIDTHS = (720, 1440, 2400)
IMAGE_CREDIT = "CUHKSZ Eats 提供"
IMAGE_COPYRIGHT = "版权仍属于原摄影者。"
PIPELINE_VERSION = 3
IMAGE_XMP = f"""<?xpacket begin='\ufeff'?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/">
      <photoshop:Credit>{IMAGE_CREDIT}</photoshop:Credit>
      <dc:creator><rdf:Seq><rdf:li>{IMAGE_CREDIT}</rdf:li></rdf:Seq></dc:creator>
      <dc:rights><rdf:Alt><rdf:li xml:lang="x-default">{IMAGE_COPYRIGHT}</rdf:li></rdf:Alt></dc:rights>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end='w'?>""".encode("utf-8")


class ImageDerivativeCache:
    def __init__(self, source_root: Path, cache_directory: Path, media_directory: Path):
        self.source_root = source_root
        self.cache_directory = cache_directory
        self.media_directory = media_directory
        self.manifest_path = cache_directory / "manifest.json"
        self.entries = self._load_manifest()
        self.updated_entries: dict[str, dict[str, object]] = {}
        self.expected_public_files: set[Path] = set()
        self.generated = 0
        self.reused = 0
        cache_directory.mkdir(parents=True, exist_ok=True)
        media_directory.mkdir(parents=True, exist_ok=True)

    def _load_manifest(self) -> dict[str, dict[str, object]]:
        try:
            manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))
            if manifest.get("version") == PIPELINE_VERSION:
                return manifest.get("sources", {})
        except (OSError, ValueError, TypeError):
            pass
        return {}

    def _fingerprint(self, source: Path) -> str:
        key = str(source.resolve())
        stat = source.stat()
        previous = self.entries.get(key, {})
        if (
            previous.get("size") == stat.st_size
            and previous.get("mtimeNs") == stat.st_mtime_ns
            and isinstance(previous.get("fingerprint"), str)
        ):
            fingerprint = str(previous["fingerprint"])
        else:
            digest = hashlib.sha256()
            with source.open("rb") as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(block)
            fingerprint = digest.hexdigest()
        self.updated_entries[key] = {
            "size": stat.st_size,
            "mtimeNs": stat.st_mtime_ns,
            "fingerprint": fingerprint,
        }
        return fingerprint

    @staticmethod
    def _write_derivative(image: Image.Image, target: Path, width: int, quality: int) -> None:
        height = max(1, round(image.height * width / image.width))
        resized = image.resize((width, height), Image.Resampling.LANCZOS)
        clean = Image.new(resized.mode, resized.size)
        clean.paste(resized)
        temporary = target.with_suffix(".tmp")
        clean.save(temporary, format="WEBP", quality=quality, method=6, xmp=IMAGE_XMP)
        temporary.replace(target)

    @staticmethod
    def _link_or_copy(source: Path, target: Path) -> None:
        if target.exists() and source.stat().st_ino == target.stat().st_ino:
            return
        temporary = target.with_suffix(".tmp")
        temporary.unlink(missing_ok=True)
        try:
            os.link(source, temporary)
        except OSError:
            shutil.copy2(source, temporary)
        temporary.replace(target)

    def derive(self, source: Path, kind: str) -> dict[str, object]:
        fingerprint = self._fingerprint(source)
        relative_path = source.relative_to(self.source_root).as_posix()
        public_id = hashlib.sha256(relative_path.encode("utf-8")).hexdigest()[:16]
        widths_requested = MENU_IMAGE_WIDTHS if kind == "menu" else DEFAULT_IMAGE_WIDTHS
        quality = 90 if kind == "menu" else 82

        with Image.open(source) as source_image:
            oriented = ImageOps.exif_transpose(source_image)
            mode = "RGBA" if "A" in oriented.getbands() else "RGB"
            pixels = oriented.convert(mode)
            widths = sorted({min(pixels.width, width) for width in widths_requested})
            sources = []
            for width in widths:
                cache_key = hashlib.sha256(
                    f"{PIPELINE_VERSION}:{fingerprint}:{kind}:{width}:{quality}".encode()
                ).hexdigest()
                cached = self.cache_directory / f"{cache_key}.webp"
                if cached.exists():
                    self.reused += 1
                else:
                    self._write_derivative(pixels, cached, width, quality)
                    self.generated += 1

                public = self.media_directory / f"photo-{public_id}-{width}w.webp"
                self._link_or_copy(cached, public)
                self.expected_public_files.add(public)
                height = max(1, round(pixels.height * width / pixels.width))
                sources.append({"src": f"/media/{public.name}", "width": width, "height": height})

        largest = sources[-1]
        return {
            "src": largest["src"],
            "srcset": ", ".join(f'{item["src"]} {item["width"]}w' for item in sources),
            "sources": sources,
            "width": largest["width"],
            "height": largest["height"],
            "creditText": IMAGE_CREDIT,
            "copyrightNotice": IMAGE_COPYRIGHT,
        }

    def finish(self) -> None:
        for public in self.media_directory.iterdir():
            if public not in self.expected_public_files:
                public.unlink()
        existing_entries = {
            key: value for key, value in self.entries.items() if Path(key).is_file()
        }
        existing_entries.update(self.updated_entries)
        manifest = {"version": PIPELINE_VERSION, "sources": existing_entries}
        temporary = self.manifest_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(self.manifest_path)
