"""
LibreOffice headless conversion service.

Converts Office documents (DOCX, XLSX, PPTX, etc.) to PDF using
LibreOffice's --headless mode. Converted PDFs are cached in
data/converted/ so repeated views don't re-convert.
"""
import asyncio
import logging
import shutil
import subprocess
from pathlib import Path

from app.config import settings

logger = logging.getLogger(__name__)

# One conversion at a time — LibreOffice on Windows uses a shared lock file
# and concurrent runs cause silent failures or GUI popups.
_conversion_lock = asyncio.Semaphore(1)

# MIME types that require conversion to PDF before viewing
CONVERTIBLE_MIME_TYPES = {
    "application/msword",                                                         # .doc
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",   # .docx
    "application/vnd.ms-excel",                                                   # .xls
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",         # .xlsx
    "application/vnd.ms-powerpoint",                                              # .ppt
    "application/vnd.openxmlformats-officedocument.presentationml.presentation", # .pptx
    "application/vnd.oasis.opendocument.text",                                   # .odt
    "application/vnd.oasis.opendocument.spreadsheet",                            # .ods
    "application/vnd.oasis.opendocument.presentation",                           # .odp
}

# MIME types the browser can display natively — no conversion needed
NATIVE_MIME_TYPES = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "image/svg+xml",
    "video/mp4",
    "video/webm",
}

CONVERSION_TIMEOUT_SECONDS = 120


def needs_conversion(mime_type: str) -> bool:
    return mime_type in CONVERTIBLE_MIME_TYPES


def is_natively_viewable(mime_type: str) -> bool:
    return mime_type in NATIVE_MIME_TYPES


async def convert_to_pdf(source_path: Path, version_id: str, file_name: str = "") -> Path:
    """
    Convert a file to PDF using LibreOffice headless.

    source_path  — path to the stored file (no extension, just UUID)
    version_id   — used for cache file naming
    file_name    — original filename including extension (e.g. "report.xlsx").
                   Required so LibreOffice can detect the file format.

    Returns the path to the converted PDF.
    Raises RuntimeError if conversion fails.
    """
    # Use absolute paths — LibreOffice subprocess may have a different CWD
    cache_dir = Path(settings.converted_files_dir).resolve()
    cache_dir.mkdir(parents=True, exist_ok=True)

    output_pdf = cache_dir / f"{version_id}.pdf"

    if output_pdf.exists():
        logger.debug("Cache hit for version %s", version_id)
        return output_pdf

    ext = Path(file_name).suffix.lower() if file_name else ""
    if not ext:
        raise RuntimeError(
            "Cannot determine file format: original filename has no extension."
        )

    # Create a temp copy with the correct extension so LibreOffice can detect the format.
    # Files are stored as bare UUIDs with no extension.
    source_abs = source_path.resolve()
    temp_src = cache_dir / f"{version_id}_src{ext}"

    logger.debug("cache_dir  : %s  (exists=%s)", cache_dir, cache_dir.exists())
    logger.debug("source_abs : %s  (exists=%s)", source_abs, source_abs.exists())
    logger.debug("temp_src   : %s", temp_src)

    try:
        shutil.copy2(source_abs, temp_src)
    except OSError as e:
        logger.error("Failed to copy source file '%s': %s", source_abs, e)
        raise RuntimeError(f"Failed to prepare file for conversion: {e}") from e

    logger.info("Converting '%s' → PDF (version %s)", file_name, version_id)

    async with _conversion_lock:
        await _run_libreoffice(temp_src, cache_dir, version_id, file_name)

    # LibreOffice names the output after the source file stem
    converted = cache_dir / (temp_src.stem + ".pdf")
    logger.debug("Expected converted file: %s  (exists=%s)", converted, converted.exists())
    if not converted.exists():
        raise RuntimeError(
            "Conversion produced no output. The file may be corrupted or password-protected."
        )

    converted.rename(output_pdf)
    logger.info("Conversion complete → %s", output_pdf.name)
    return output_pdf


def _run_libreoffice_sync(temp_src: Path, cache_dir: Path, version_id: str, file_name: str) -> None:
    """
    Run soffice synchronously (called via asyncio.to_thread).

    Using subprocess.run in a thread avoids ProactorEventLoop subprocess
    issues on Windows under uvicorn --reload.
    """
    cmd = [
        settings.libreoffice_path,
        "--headless",
        "--norestore",
        "--nofirststartwizard",
        "--nologo",
        "--convert-to", "pdf",
        "--outdir", str(cache_dir),
        str(temp_src),
    ]
    logger.debug("LibreOffice command: %s", " ".join(cmd))

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            timeout=CONVERSION_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError(
            f"Document conversion timed out after {CONVERSION_TIMEOUT_SECONDS}s. "
            "The file may be too large or complex."
        )
    except OSError as exc:
        raise RuntimeError(f"Could not start LibreOffice: {exc}") from exc

    logger.debug("LibreOffice exited (returncode=%s)", result.returncode)
    logger.debug("LibreOffice stdout: %s", result.stdout.decode(errors="replace").strip())
    logger.debug("LibreOffice stderr: %s", result.stderr.decode(errors="replace").strip())

    if result.returncode != 0:
        err_output = result.stderr.decode(errors="replace").strip()
        logger.error(
            "LibreOffice failed for '%s' (version %s) rc=%s: %s",
            file_name, version_id, result.returncode, err_output,
        )
        raise RuntimeError(
            "Document conversion failed. The file may be corrupted, "
            "password-protected, or in an unsupported format."
        )


async def _run_libreoffice(temp_src: Path, cache_dir: Path, version_id: str, file_name: str) -> None:
    """Dispatch to the synchronous runner in a thread pool."""
    try:
        await asyncio.to_thread(_run_libreoffice_sync, temp_src, cache_dir, version_id, file_name)
    finally:
        if temp_src.exists():
            temp_src.unlink()
