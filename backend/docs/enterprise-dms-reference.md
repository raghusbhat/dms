# Enterprise Document Management Systems: Comprehensive Technical Reference

> Research compiled: February 2026. Covers storage architecture, document conversion, retrieval/streaming, browser viewing, error handling, upload handling, and known issues.

---

## Table of Contents

1. [Document Storage Architecture](#1-document-storage-architecture)
2. [Document Format Conversion](#2-document-format-conversion)
3. [Document Retrieval and Streaming](#3-document-retrieval-and-streaming)
4. [Document Viewing in Browser](#4-document-viewing-in-browser)
5. [Error Handling Patterns](#5-error-handling-patterns)
6. [Upload Handling](#6-upload-handling)
7. [Known Issues and Solutions](#7-known-issues-and-solutions)

---

## 1. Document Storage Architecture

### 1.1 How Major Systems Store Files

#### SharePoint (Microsoft)

SharePoint has one of the most complex storage architectures in the enterprise space. It has evolved significantly across versions.

**Default Architecture (pre-2013):**
- All Binary Large Objects (BLOBs) stored in SQL Server content database
- Files stored in the `AllDocStreams` table as `image` data type
- Metadata stored in the `AllDocs` table
- Tables linked via GUIDs (Globally Unique Identifiers)
- Hard 2 GB per-file limit due to SQL Server `image` type constraint
- SQL Server I/O for BLOBs is inefficient because it must walk root node → intermediate nodes → data pages

**Shredded Storage (SharePoint 2013+):**
- Files are split into "shreds" (chunks)
  - Office files: 64 KB chunks
  - Other file types: 1 MB chunks
- Shreds stored in `DocStreams` table in the SQL content database
- A pointer table reconstructs the complete BLOB from shreds
- **Key benefit for versioning:** Only differential shreds are stored for each new version, not full file copies
- Independent of Remote BLOB Storage (RBS) — can use both together

**Remote BLOB Storage (RBS):**
- BLOB data moved out of SQL Server content database to an external store
- Can be: Content-Addressable Storage (CAS), an SMB file server, or a separate SQL database
- Metadata stays in SQL Server; only BLOBs are externalized
- RBS providers connect via the RBS API
- When using the FILESTREAM provider, data stored in a file-system folder linked to the database (not in the `.mdf` file)
- SQL Server and SharePoint jointly manage data integrity between database and RBS store

**Key tables:**
```
AllDocs         — document metadata (title, author, modified, GUID, etc.)
AllDocStreams    — legacy: full BLOB content column (image type)
DocStreams       — shredded storage: individual 64K/1MB shreds
```

#### Dropbox (Magic Pocket)

Dropbox originally used Amazon S3 + HDFS (2007–2015), then migrated to its own system called "Magic Pocket."

**Chunking strategy:**
- Files are split into blocks of up to **4 MB** each
- Blocks are compressed and encrypted before storage
- Each block is keyed by its **SHA-256 hash** — this is content-addressed storage (CAS)
- If a block with the same SHA-256 already exists, no re-upload is needed (deduplication at block level)

**Dropbox content hash (for whole-file deduplication):**
```
1. Split file into 4 MB blocks
2. Compute SHA-256 of each block
3. Concatenate all block hashes
4. Compute SHA-256 of the concatenated result
= Dropbox Content Hash
```

**Block Index:** A giant sharded MySQL cluster fronted by an RPC service layer. Maps `SHA-256 hash → cell → bucket → checksum`.

**Magic Pocket zones:** Multi-zone architecture (West, Central, East US). Each block stored in at least 2 separate zones and replicated within zones. Cross-zone replication daemon handles async replication.

**Object Store abstraction layer:** Built on top of Magic Pocket; API is a simplified S3-like interface (`PUT`, `GET`, `DELETE`, `LIST`). Access segregated by "pails" (analogous to S3 buckets). Routes PUTs to cost-efficient store and GETs to correct store — transparently shuffles data between AWS, GCP, IBM, Azure depending on pricing/compliance.

#### Box

**Infrastructure:**
- Proprietary Box Infra: combination of private data centers + third-party cloud (AWS, GCP, IBM, Azure)
- Active-active data center model: content simultaneously available from multiple data centers
- Box Zones: optional in-region data storage for compliance

**File encryption:**
- Every file encrypted with a unique **256-bit AES** data encryption key
- Uses FIPS 140-2 validated Level 1 cryptographic module
- Data encryption key (DEK) is itself encrypted with a key encryption key (KEK) — "key wrapping"

**Storage redundancy:** Files redundantly stored in multiple data centers; synchronized copies on user devices.

#### Google Drive

- Cloud-native, tightly coupled with Google Docs/Sheets/Slides
- Google Drive natively stores files in Google's distributed object storage (Colossus)
- Google Workspace documents (Docs, Sheets, Slides) are **not** stored as files — they are stored as a structured data format in Google's internal databases, converted to/from Office formats on export
- Binary files (PDFs, images, Office files) stored as opaque blobs in Colossus

#### OpenText Documentum

- Designed for extreme scale: manages over 80 billion documents, imports 20 million items/hour
- Supports multi-language, zero-trust governance, encryption, records lifecycle, retention policies, unit-level policy management
- Typically uses external content storage separate from the metadata database
- Metadata in a relational database (Oracle, SQL Server); file blobs on a content server or object storage

#### DocuWare

**Architecture overview:**
- Requires several databases + at least one **file cabinet** (file storage)
- Documents stored on "DocuWare disks" — directories identified by DocuWare-assigned names
- Version 7+: metadata automatically stored in the file cabinet database
- Optional: copies saved as **ZIP-based `.DWX` files** in the file cabinet storage location
- Database support: MS SQL Server, Oracle, MySQL — can be on separate servers from DocuWare
- Full-text index stored separately for search performance
- Identity Service + Authentication Server handle SSO and DocuWare authentication

#### M-Files

**Metadata-driven architecture:**
- Everything is metadata — files are not stored in folders; they are stored by object type + properties
- Metadata stored in SQL Server (on-premises) or Azure SQL Database (M-Files Cloud)
- File data stored either in the SQL database or in the file system (configurable per vault)
- Default lightweight database: Firebird (built-in, no separate install required)
- Enterprise option: Microsoft SQL Server or Azure SQL Managed Instance
- "Vault" = a single document repository with its own database

---

### 1.2 File Naming Conventions

| Strategy | Description | Used By |
|----------|-------------|---------|
| UUID v4 (random) | `3f2504e0-4f89-11d3-9a0c-0305e82c3301` | Most modern systems — no collision risk, no info leakage |
| UUID v5 (name-based SHA-1) | Deterministic from namespace + content hash | Content-addressed stores, deduplication systems |
| SHA-256 content hash | `e3b0c44298fc1c149afb...` | Dropbox Magic Pocket, Git objects, CAS systems |
| Sequential / surrogate key | `00000001`, `DOC-2024-001234` | Legacy systems, ERP integrations |
| Original filename (sanitized) | `quarterly_report_2024.pdf` | User-facing storage (risky for production backend) |
| Hierarchical path | `/{tenantId}/{year}/{month}/{uuid}` | Multi-tenant SaaS, S3-based storage |

**Best practice for enterprise systems:**
```
/{tenant_id}/{yyyy}/{mm}/{uuid_v4_no_extension}
```
- No file extension in stored object name (prevents MIME confusion)
- Extension + MIME type stored in metadata
- UUID prevents path traversal, enumeration attacks
- Date prefix enables efficient archival, lifecycle policies, and S3 prefix-based sharding

**Characters to avoid in filenames:** `! ? @ # $ ~ ^ & % * ` ; < > , ' " | [ ] ( )`

---

### 1.3 Directory Sharding for Large File Counts

**Problem:** Filesystems and some object stores degrade with very large numbers of files in a single directory.

**Traditional filesystem sharding (2-level hex prefix):**
```
/store/ab/cd/abcd1234ef567890.dat
```
- Take first 2 hex chars of hash → first directory level
- Next 2 chars → second level
- Distributes 2^16 = 65,536 leaf directories
- Used by Git object store, many legacy DMS systems

**S3 prefix-based sharding:**
S3 is a key-value store — there are no real directories. However, S3 internally partitions based on key prefixes at high request rates.

- Below ~100 req/s: no special effort needed
- Above 100 req/s: Amazon auto-creates internal partitions per prefix
- **Best practice:** Use randomized prefixes (UUID prefix, hashed prefix) to prevent hot spots
- S3 supports 3,500 PUT/COPY/POST/DELETE and 5,500 GET/HEAD requests per second per prefix
- For multi-tenant: `/{prefix_shard}/{tenant_id}/{object_id}` distributes load

**S3 prefix partitioning strategy:**
```
# Bad (sequential - creates hot spot on single partition):
uploads/2024/01/01/file1.pdf
uploads/2024/01/01/file2.pdf

# Good (randomized prefix):
uploads/a3/f2/a3f2b1c4-9d8e-4a5b-b6c7-d8e9f0a1b2c3
uploads/7e/1d/7e1d2c3b-4a5f-6e7d-8c9b-0a1f2e3d4c5b
```

---

### 1.4 Metadata vs. File Blob Separation

Enterprise DMS universally separates metadata from file content. This is foundational to scalable document management.

**Typical separation:**

| Store | What It Contains |
|-------|-----------------|
| Relational DB (PostgreSQL, SQL Server, MySQL) | Document ID, filename, MIME type, size, checksum, upload timestamp, uploader ID, version history, tags, permissions, conversion status, custom metadata fields |
| Object Store (S3, Azure Blob, GCS) or filesystem | Raw binary content, keyed by UUID or content hash |
| Search Index (Elasticsearch, Solr, Azure Search) | Extracted text content, OCR output, metadata fields |
| Cache (Redis) | Presigned URL cache, conversion status, thumbnail URLs |

**Why separate?**
- Metadata queries (search, filter, list) don't need to touch large blobs
- Blobs can be stored in cheaper, high-throughput object storage
- Metadata can be indexed, versioned, replicated independently
- Enables content deduplication without metadata duplication

**Example metadata schema (PostgreSQL):**
```sql
CREATE TABLE documents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    original_name   VARCHAR(500) NOT NULL,
    storage_key     VARCHAR(1000) NOT NULL UNIQUE, -- path/key in object store
    mime_type       VARCHAR(200) NOT NULL,
    detected_mime   VARCHAR(200),                  -- magic-byte detected MIME
    size_bytes      BIGINT NOT NULL,
    sha256_checksum CHAR(64) NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1,
    conversion_status VARCHAR(50) DEFAULT 'pending', -- pending/processing/done/failed
    converted_key   VARCHAR(1000),                 -- PDF version key in object store
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by      UUID NOT NULL,
    is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_documents_tenant ON documents(tenant_id);
CREATE INDEX idx_documents_checksum ON documents(tenant_id, sha256_checksum);
```

---

### 1.5 MIME Type Detection

**The problem:** Users can upload files with incorrect extensions or Content-Type headers. Trusting the client-provided MIME type is a security vulnerability.

**Three sources of MIME information (in order of trustworthiness):**

1. **Magic bytes (most reliable)** — Read the first N bytes of the file and compare against known file signatures
2. **Content-Type header (unreliable)** — Can be set to anything by the client
3. **File extension (unreliable)** — Trivial to spoof

**Common magic byte signatures:**
```
PDF:  25 50 44 46 2D       (%PDF-)
DOCX: 50 4B 03 04           (PK.. — ZIP-based format)
XLSX: 50 4B 03 04           (PK.. — ZIP-based format)
PPTX: 50 4B 03 04           (PK.. — ZIP-based format)
PNG:  89 50 4E 47 0D 0A 1A 0A
JPEG: FF D8 FF
GIF:  47 49 46 38           (GIF8)
ZIP:  50 4B 03 04
GZIP: 1F 8B
```

Note: DOCX, XLSX, PPTX all start with `PK` because they are ZIP archives. Distinguishing them requires inspecting the ZIP contents (e.g., `[Content_Types].xml` inside the ZIP).

**Server-side detection libraries:**
- Python: `python-magic` (libmagic bindings), `filetype`
- Java: Apache Tika
- Node.js: `file-type` npm package
- .NET: `MimeKit`, custom magic byte inspection

**Python example:**
```python
import magic

def detect_mime(file_bytes: bytes) -> str:
    mime = magic.from_buffer(file_bytes[:8192], mime=True)
    return mime

# Cross-check with declared MIME
def validate_mime(file_bytes: bytes, declared_mime: str) -> bool:
    detected = detect_mime(file_bytes)
    # Allow some flexibility (e.g., application/zip vs application/vnd.openxmlformats...)
    MIME_ALIASES = {
        'application/zip': [
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        ]
    }
    if detected == declared_mime:
        return True
    if detected in MIME_ALIASES and declared_mime in MIME_ALIASES[detected]:
        return True
    return False
```

**Best practice: Store both detected and declared MIME types in the metadata table** (as shown in the schema above). Use detected MIME for serving files (`Content-Type` response header), use declared MIME for user display.

---

### 1.6 File Integrity (Checksums and Deduplication)

**Checksums:**
- Compute SHA-256 of the entire file at upload time
- Store in metadata table
- Re-verify on download if integrity checking is enabled
- SHA-256 recommended over MD5/SHA-1 (collision attacks exist for both)

**File-level deduplication (cross-tenant deduplication is usually disabled for privacy):**
```python
async def store_document(file_bytes: bytes, tenant_id: str) -> str:
    checksum = hashlib.sha256(file_bytes).hexdigest()

    # Check for existing file within same tenant
    existing = await db.query(
        "SELECT storage_key FROM documents WHERE tenant_id=$1 AND sha256_checksum=$2 AND NOT is_deleted",
        tenant_id, checksum
    )

    if existing:
        # Return reference to existing object, create new metadata record
        return existing.storage_key

    # New file — upload to object store
    storage_key = f"{tenant_id}/{datetime.now().year}/{uuid4()}"
    await object_store.put(storage_key, file_bytes)
    return storage_key
```

**Block-level deduplication (Dropbox/enterprise style):**
```python
CHUNK_SIZE = 4 * 1024 * 1024  # 4 MB

def chunk_file(file_bytes: bytes) -> list[tuple[str, bytes]]:
    chunks = []
    for i in range(0, len(file_bytes), CHUNK_SIZE):
        chunk = file_bytes[i:i + CHUNK_SIZE]
        chunk_hash = hashlib.sha256(chunk).hexdigest()
        chunks.append((chunk_hash, chunk))
    return chunks

def compute_content_hash(chunks: list[tuple[str, bytes]]) -> str:
    """Dropbox-style content hash."""
    block_hashes = b''.join(bytes.fromhex(h) for h, _ in chunks)
    return hashlib.sha256(block_hashes).hexdigest()
```

---

## 2. Document Format Conversion

### 2.1 The Conversion Landscape

**Why conversion is needed:**
- Users upload Word, Excel, PowerPoint, images, etc.
- Viewers in the browser need a consistent format (usually PDF)
- PDF is the lingua franca for read-only display

**Conversion tool comparison:**

| Tool | Type | Quality | Speed | Cost | Notes |
|------|------|---------|-------|------|-------|
| LibreOffice headless | Open source | Good | Slow | Free | Single-threaded, unstable under concurrency |
| Gotenberg | Docker wrapper around LibreOffice + Chromium | Good | Moderate | Free | Battle-tested, 70M+ Docker pulls |
| Aspose.Words / .Cells | Commercial SDK | Excellent | Fast | High (~$1000+/dev/year) | No external process, in-process conversion |
| GroupDocs | Commercial SDK | Very good | Fast | High | Similar to Aspose |
| Adobe PDF Services API | Cloud API | Excellent | Fast | Pay per use | $0.05–$0.08/document |
| Microsoft Graph API (Word/Excel conversion) | Cloud API | Excellent | Moderate | Included in M365 | Converts via OneDrive |
| Pandoc | Open source | Good for text | Fast | Free | Best for Markdown/HTML/text formats |
| Chromium headless | Open source | Excellent for HTML | Fast | Free | Used by Gotenberg for HTML→PDF |

**When to use each:**
- **LibreOffice/Gotenberg:** Self-hosted, privacy-sensitive deployments, budget-constrained; acceptable for low-to-moderate volume
- **Aspose:** High-volume production, need for format fidelity, .NET/Java environments, no external process
- **Adobe PDF Services:** Cloud-first, when conversion quality is paramount and cost is not a constraint
- **Chromium headless:** HTML→PDF conversion; excellent for reports generated as HTML

---

### 2.2 LibreOffice Headless: Architecture and Deployment

**Basic conversion command:**
```bash
libreoffice --headless --convert-to pdf:writer_pdf_Export \
    --outdir /output/dir \
    /input/document.docx
```

**Critical limitation: LibreOffice is NOT thread-safe.** Only one document can be converted at a time per LibreOffice instance. Concurrent conversion requests to the same instance will fail silently.

**Enterprise deployment pattern: one process per conversion:**
```python
import subprocess
import asyncio
import tempfile
import os
from pathlib import Path

async def convert_to_pdf(
    input_path: str,
    timeout_seconds: int = 60
) -> bytes:
    with tempfile.TemporaryDirectory() as outdir:
        try:
            proc = await asyncio.create_subprocess_exec(
                'libreoffice',
                '--headless',
                '--norestore',
                '--nofirststartwizard',
                '--convert-to', 'pdf:writer_pdf_Export',
                '--outdir', outdir,
                input_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            try:
                stdout, stderr = await asyncio.wait_for(
                    proc.communicate(),
                    timeout=timeout_seconds
                )
            except asyncio.TimeoutError:
                proc.kill()
                raise ConversionTimeoutError(f"Conversion timed out after {timeout_seconds}s")

            if proc.returncode != 0:
                raise ConversionError(f"LibreOffice exited {proc.returncode}: {stderr.decode()}")

            # Find the output PDF
            input_stem = Path(input_path).stem
            output_path = Path(outdir) / f"{input_stem}.pdf"

            if not output_path.exists():
                raise ConversionError("LibreOffice did not produce output file")

            return output_path.read_bytes()

        finally:
            # Clean up LibreOffice lock files
            lock_file = Path(input_path).parent / f".~lock.{Path(input_path).name}#"
            if lock_file.exists():
                lock_file.unlink()
```

**Using separate UserInstallation directories to allow parallelism:**
```bash
# Each conversion job gets its own UserInstallation
libreoffice -env:UserInstallation=file:///tmp/libreoffice-$JOB_ID \
    --headless --convert-to pdf file.docx
```

**Gotenberg (recommended for production):**
```yaml
# docker-compose.yml
services:
  gotenberg:
    image: gotenberg/gotenberg:8
    ports:
      - "3000:3000"
    command:
      - "gotenberg"
      - "--chromium-disable-javascript=true"
      - "--chromium-allow-list=file:///tmp/.*"
      - "--libreoffice-restart-after=10"   # restart LO after 10 conversions
      - "--api-timeout=60s"
      - "--libreoffice-start-timeout=30s"
    deploy:
      resources:
        limits:
          memory: 2G
```

**Gotenberg API call:**
```python
import httpx

async def convert_with_gotenberg(
    file_content: bytes,
    filename: str,
    gotenberg_url: str = "http://gotenberg:3000"
) -> bytes:
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            f"{gotenberg_url}/forms/libreoffice/convert",
            files={"files": (filename, file_content, "application/octet-stream")},
        )
        response.raise_for_status()
        return response.content
```

---

### 2.3 Aspose: In-Process Commercial Conversion

**Aspose.Words .NET example:**
```csharp
using Aspose.Words;

public class DocumentConverter
{
    private static bool _licenseApplied = false;

    static DocumentConverter()
    {
        // Apply license once at startup
        var license = new Aspose.Words.License();
        license.SetLicense("Aspose.Words.NET.lic");
        _licenseApplied = true;
    }

    public byte[] ConvertToPdf(Stream inputStream, string inputFormat)
    {
        var loadOptions = new LoadOptions();
        // Handle password-protected documents
        // loadOptions.Password = "password"; // if known

        var doc = new Document(inputStream, loadOptions);

        using var outputStream = new MemoryStream();
        doc.Save(outputStream, SaveFormat.Pdf);
        return outputStream.ToArray();
    }
}
```

**Aspose advantages:**
- No external process (in-process, thread-safe)
- Supports Word, Excel, PowerPoint, Visio, HTML, Images, PDF, and 100+ formats
- Consistent behavior across Windows and Linux
- No LibreOffice dependency

**Aspose licensing (as of 2024):**
- Per-developer license required
- OEM/site licenses available
- Each product (Words, Cells, Slides) licensed separately
- Aspose.Total bundles all products

---

### 2.4 Conversion Queue Architecture

**Pattern: async job queue with status polling**

```
Upload API → Queue Job → Return job_id
Client polls /conversion-status/{job_id}
Worker processes job → Updates status in DB
Client gets redirect to PDF when status = 'done'
```

**BullMQ (Node.js) example:**
```typescript
import { Queue, Worker, QueueEvents } from 'bullmq';
import Redis from 'ioredis';

const connection = new Redis({ host: 'localhost', port: 6379 });

// Producer
const conversionQueue = new Queue('document-conversion', { connection });

export async function queueConversion(documentId: string): Promise<string> {
    const job = await conversionQueue.add(
        'convert-to-pdf',
        { documentId },
        {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 5000, // 5s, 10s, 20s
            },
            removeOnComplete: { count: 1000 },
            removeOnFail: { count: 5000 },
        }
    );
    return job.id!;
}

// Worker
const worker = new Worker(
    'document-conversion',
    async (job) => {
        const { documentId } = job.data;

        await updateConversionStatus(documentId, 'processing');

        try {
            const fileBytes = await downloadFromStorage(documentId);
            const pdfBytes = await convertWithGotenberg(fileBytes, documentId);
            const pdfKey = await uploadPdfToStorage(documentId, pdfBytes);
            await updateConversionStatus(documentId, 'done', pdfKey);
        } catch (error) {
            // BullMQ will retry based on attempts config
            await updateConversionStatus(documentId, 'failed', null, error.message);
            throw error; // re-throw so BullMQ handles retry
        }
    },
    {
        connection,
        concurrency: 2, // max 2 concurrent conversions
        limiter: {
            max: 10,
            duration: 60000, // max 10 conversions per minute
        },
    }
);

worker.on('failed', async (job, err) => {
    if (job?.attemptsMade >= (job?.opts.attempts ?? 1)) {
        // Move to dead letter state
        await updateConversionStatus(job.data.documentId, 'permanently_failed');
        await notifyAdmins(job.data.documentId, err);
    }
});
```

**Celery (Python) example:**
```python
from celery import Celery
from celery.utils.log import get_task_logger

app = Celery('tasks', broker='redis://localhost:6379/0', backend='redis://localhost:6379/1')
logger = get_task_logger(__name__)

@app.task(
    bind=True,
    max_retries=3,
    default_retry_delay=5,
    autoretry_for=(ConversionError,),
    retry_backoff=True,         # exponential backoff
    retry_backoff_max=300,      # max 5 minutes between retries
    retry_jitter=True,
)
def convert_document(self, document_id: str):
    try:
        file_bytes = download_from_storage(document_id)
        pdf_bytes = convert_to_pdf(file_bytes, timeout=60)
        pdf_key = upload_pdf(document_id, pdf_bytes)
        update_status(document_id, 'done', pdf_key)
    except PasswordProtectedError as e:
        # Non-retryable — don't retry password errors
        update_status(document_id, 'failed', error='password_protected')
        return  # Do NOT raise
    except CorruptedFileError as e:
        update_status(document_id, 'failed', error='corrupted')
        return  # Do NOT raise
    except ConversionTimeoutError as e:
        update_status(document_id, 'failed', error='timeout')
        raise self.retry(exc=e)  # Retryable
    except Exception as e:
        logger.error(f"Conversion failed for {document_id}: {e}")
        raise  # Retryable — celery handles it
```

---

### 2.5 Conversion Caching

**Never re-convert a file that has already been converted.** Cache the PDF output keyed by the source file's SHA-256 hash.

```python
async def get_or_convert_pdf(document_id: str) -> str:
    doc = await db.get_document(document_id)

    # Check if PDF already exists (same source hash)
    cached = await db.query(
        "SELECT converted_key FROM documents WHERE sha256_checksum=$1 AND conversion_status='done' LIMIT 1",
        doc.sha256_checksum
    )
    if cached:
        return cached.converted_key

    # Queue conversion if not already processing
    if doc.conversion_status not in ('processing', 'done'):
        job_id = await queue_conversion(document_id)
        await db.update_document(document_id, conversion_status='processing', job_id=job_id)

    return None  # Client must poll for completion
```

---

### 2.6 Handling Problematic File Types

| Problem | Symptoms | Solution |
|---------|----------|----------|
| Password-protected | Conversion tool hangs or exits with error | Detect before conversion; return `password_required` error; do not retry |
| Corrupted file | Process hangs at 100% CPU, timeout | Set conversion timeout (30–60s); on timeout, mark as corrupted; do not retry |
| Unsupported format | LibreOffice outputs empty PDF or errors | Maintain allowlist of supported MIME types; reject at upload time |
| Large file (>100 MB) | Conversion OOM, timeout | Enforce size limit at upload; use streaming conversion if supported |
| Encrypted ZIP | LibreOffice fails silently | Detect encrypted ZIPs separately; return specific error |
| Embedded macros | Security risk | Strip macros before conversion; some tools do this automatically |

**Detecting password-protected files:**
```python
def is_password_protected(file_bytes: bytes, mime_type: str) -> bool:
    if mime_type == 'application/pdf':
        # Look for /Encrypt in PDF structure
        return b'/Encrypt' in file_bytes[:8192]

    if mime_type in OFFICE_OOXML_MIMES:
        import zipfile
        import io
        try:
            with zipfile.ZipFile(io.BytesIO(file_bytes)) as z:
                # OOXML encrypted files are not valid ZIPs — they use CFB format
                return False
        except zipfile.BadZipFile:
            # Could be CFB-encrypted (legacy .doc/.xls or encrypted .docx)
            # CFB magic bytes: D0 CF 11 E0
            return file_bytes[:4] == b'\xD0\xCF\x11\xE0'

    return False
```

---

### 2.7 Conversion Timeouts

**Recommended timeouts by format:**

| Format | Recommended Timeout |
|--------|---------------------|
| Word (.docx, .doc) | 30–60 seconds |
| Excel (.xlsx, .xls) | 60–120 seconds (can have complex formulas) |
| PowerPoint (.pptx, .ppt) | 60–120 seconds (media-heavy) |
| PDF → PDF (re-process) | 30 seconds |
| HTML → PDF (Chromium) | 30 seconds |
| Large files (>50 MB) | 180–300 seconds |

**Always set process-level timeout AND HTTP-level timeout separately.**

---

## 3. Document Retrieval and Streaming

### 3.1 HTTP Range Requests (Byte Serving)

HTTP/1.1 `Range` requests allow clients to request specific byte ranges of a file. This is critical for large PDF files and video streaming.

**Server-side required headers:**
```
HTTP/1.1 206 Partial Content
Accept-Ranges: bytes
Content-Range: bytes 0-1023/146515
Content-Length: 1024
Content-Type: application/pdf
```

**How PDF.js uses range requests:**
- PDF.js sends a `HEAD` request first to get `Content-Length` and `Accept-Ranges`
- If the server supports range requests AND the PDF is linearized, PDF.js requests only the first chunk (hint tables + first page)
- Subsequent page navigation triggers additional range requests for those pages
- This enables rendering page 1 of a 100-page, 50 MB PDF in ~200ms

**Node.js range request implementation:**
```javascript
import { createReadStream, statSync } from 'fs';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

async function streamDocument(req, res, storageKey) {
    const s3 = new S3Client({ region: process.env.AWS_REGION });

    // Get object metadata
    const headCmd = new HeadObjectCommand({ Bucket: BUCKET, Key: storageKey });
    const metadata = await s3.send(headCmd);
    const fileSize = metadata.ContentLength;
    const mimeType = metadata.ContentType;

    const rangeHeader = req.headers.range;

    if (rangeHeader) {
        const [start, end] = rangeHeader.replace('bytes=', '').split('-').map(Number);
        const chunkStart = start;
        const chunkEnd = end || fileSize - 1;
        const chunkSize = chunkEnd - chunkStart + 1;

        res.writeHead(206, {
            'Content-Range': `bytes ${chunkStart}-${chunkEnd}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize,
            'Content-Type': mimeType,
        });

        const getCmd = new GetObjectCommand({
            Bucket: BUCKET,
            Key: storageKey,
            Range: `bytes=${chunkStart}-${chunkEnd}`,
        });
        const response = await s3.send(getCmd);
        response.Body.pipe(res);
    } else {
        res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': mimeType,
            'Accept-Ranges': 'bytes',
        });

        const getCmd = new GetObjectCommand({ Bucket: BUCKET, Key: storageKey });
        const response = await s3.send(getCmd);
        response.Body.pipe(res);
    }
}
```

**S3 presigned URLs and range requests:**
S3 presigned GET URLs do support `Range` headers — you can make a presigned URL then send multiple parallel `Range` requests against it.

---

### 3.2 Presigned URLs and Authentication

**Presigned URL pattern (recommended for file downloads):**

1. Client requests file from your API (authenticated request)
2. API validates permissions, generates short-lived presigned URL to S3/GCS
3. API returns presigned URL to client
4. Client fetches directly from object store using presigned URL (bypasses your server)
5. Server saves bandwidth and compute

```python
import boto3
from datetime import timedelta

def generate_presigned_url(
    storage_key: str,
    expiry_seconds: int = 3600,  # 1 hour
    content_disposition: str = None
) -> str:
    s3 = boto3.client('s3')

    params = {
        'Bucket': BUCKET_NAME,
        'Key': storage_key,
    }

    if content_disposition:
        params['ResponseContentDisposition'] = content_disposition

    url = s3.generate_presigned_url(
        'get_object',
        Params=params,
        ExpiresIn=expiry_seconds,
    )
    return url
```

**When presigned URLs are NOT suitable:**
- When you need to log every access (presigned URL accesses bypass your server)
- When you need to invalidate access mid-request
- When the client browser would expose the URL (e.g., `<img src="...">` in a shared page)
- For PDF.js viewers: CORS issues may arise since the URL points to a different origin (S3/GCS)

**Alternative: Proxy streaming (more control, more server load):**
```python
# Your API acts as a transparent proxy
@router.get("/documents/{document_id}/content")
async def serve_document(document_id: str, user=Depends(get_current_user)):
    doc = await verify_access(document_id, user)

    # Stream from S3 through your server
    s3_object = s3.get_object(Bucket=BUCKET, Key=doc.storage_key)

    return StreamingResponse(
        s3_object['Body'],
        media_type=doc.mime_type,
        headers={
            'Content-Disposition': f'inline; filename="{doc.original_name}"',
            'Content-Length': str(doc.size_bytes),
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'private, max-age=3600',
        }
    )
```

**Token-in-cookie pattern (for embedded viewers):**
When the document URL is embedded in an `<iframe>` or used as the `src` of a PDF viewer, browser cookie-based auth avoids CORS and URL exposure:
```javascript
// Set HttpOnly, Secure cookie on login
Set-Cookie: session_token=...; HttpOnly; Secure; SameSite=Lax

// Document endpoint reads cookie automatically
// No Authorization header needed — good for <iframe src="...">
```

---

### 3.3 CDN Integration Patterns

**CloudFront with S3:**

```
Client → CloudFront Edge → S3 Origin
```

**Key considerations:**
- Presigned S3 URLs do NOT work with CloudFront (CloudFront has its own signing mechanism)
- Use **CloudFront Signed URLs** for private content, not S3 presigned URLs
- Or: make S3 bucket completely private, CloudFront Origin Access Identity (OAI) has access

**Cache control for documents:**
```
# For converted PDFs (immutable once created):
Cache-Control: private, max-age=86400, immutable

# For original files (may be updated/versioned):
Cache-Control: private, max-age=3600, no-cache

# For thumbnails (can be public):
Cache-Control: public, max-age=604800
```

**CloudFront signed URL pattern:**
```python
from botocore.signers import CloudFrontSigner
import rsa

def generate_cloudfront_signed_url(
    resource_url: str,
    expiry_seconds: int = 3600
) -> str:
    with open('cloudfront_private_key.pem', 'rb') as f:
        key = rsa.PrivateKey.load_pkcs1(f.read())

    signer = CloudFrontSigner(CLOUDFRONT_KEY_ID, lambda msg: rsa.sign(msg, key, 'SHA-1'))

    signed_url = signer.generate_presigned_url(
        resource_url,
        date_less_than=datetime.utcnow() + timedelta(seconds=expiry_seconds)
    )
    return signed_url
```

---

### 3.4 Concurrent Access

- Object stores (S3, GCS, Azure Blob) handle concurrent reads natively — no locking needed
- Concurrent writes: use idempotency keys; object store PUT is atomic
- For version conflicts: use optimistic locking with version numbers or ETags
- S3 provides strong read-after-write consistency (since December 2020)

---

## 4. Document Viewing in Browser

### 4.1 PDF.js Architecture

**Core components:**
- `pdf.js` — main library (runs in main thread or worker)
- `pdf.worker.js` — computationally intensive parsing runs in a Web Worker
- `pdf.sandbox.js` — optional sandbox for PDF JavaScript
- Rendering pipeline: PDF parser → Canvas renderer / SVG renderer / DOM renderer

**Why the worker matters:**
PDF parsing and decoding is CPU-intensive. Without the worker, it blocks the main thread and freezes the UI. The worker communicates with the main thread via `postMessage`.

**Correct initialization pattern (pdfjs-dist v4.x / react-pdf v9+):**

```javascript
// Option 1: Using import.meta.url (Vite-friendly)
import * as pdfjs from 'pdfjs-dist';
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
).toString();

// Option 2: CDN (simplest, works everywhere, but CDN dependency)
import * as pdfjs from 'pdfjs-dist';
pdfjs.GlobalWorkerOptions.workerSrc =
    `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// Option 3: Serve worker from your own static files
// Copy pdf.worker.min.mjs to /public/pdf.worker.min.mjs
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
```

**Vite-specific config to avoid worker bundling issues:**
```javascript
// vite.config.ts
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
    plugins: [
        viteStaticCopy({
            targets: [
                {
                    src: 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
                    dest: '',
                }
            ]
        })
    ],
    optimizeDeps: {
        exclude: ['pdfjs-dist'],  // Don't pre-bundle pdfjs-dist
    },
});
```

**pnpm users:** Add to `.npmrc`:
```
public-hoist-pattern[]=pdfjs-dist
```

---

### 4.2 react-pdf (wojtekmaj) — Best Practices and Known Issues

**react-pdf v9 setup (current stable as of early 2026):**
```typescript
// pdfConfig.ts — configure ONCE before any <Document> renders
import { pdfjs } from 'react-pdf';

// CRITICAL: Set workerSrc in the same file where you use Document/Page
// NOT in main.tsx or a separate config file — module execution order matters
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
).toString();
```

```typescript
// PDFViewer.tsx
import { useState, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';  // v10: no /esm/ prefix
import 'react-pdf/dist/Page/TextLayer.css';

// Set workerSrc HERE, in this same module
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
).toString();

interface PDFViewerProps {
    url: string;
    onError?: (error: Error) => void;
}

export function PDFViewer({ url, onError }: PDFViewerProps) {
    const [numPages, setNumPages] = useState<number>(0);
    const [pageNumber, setPageNumber] = useState(1);
    const [loadError, setLoadError] = useState<string | null>(null);

    const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
        setNumPages(numPages);
        setLoadError(null);
    }, []);

    const onDocumentLoadError = useCallback((error: Error) => {
        console.error('PDF load error:', error);
        setLoadError(error.message);
        onError?.(error);
    }, [onError]);

    if (loadError) {
        return (
            <div className="pdf-error">
                <p>Unable to display this document.</p>
                <a href={url} download>Download file instead</a>
            </div>
        );
    }

    return (
        <Document
            file={url}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={onDocumentLoadError}
            loading={<div>Loading document...</div>}
            error={<div>Failed to load document.</div>}
            options={{
                cMapUrl: 'https://unpkg.com/pdfjs-dist@4/cmaps/',
                cMapPacked: true,
                standardFontDataUrl: 'https://unpkg.com/pdfjs-dist@4/standard_fonts/',
            }}
        >
            <Page
                pageNumber={pageNumber}
                renderTextLayer={true}   // Enable for text selection
                renderAnnotationLayer={true}  // Enable for links/annotations
                width={800}
                loading={<div>Loading page...</div>}
            />
        </Document>
    );
}
```

**react-pdf v10 breaking changes:**
- ESM-only: CommonJS build removed
- CSS import paths changed: `react-pdf/dist/esm/Page/AnnotationLayer.css` → `react-pdf/dist/Page/AnnotationLayer.css`
- Jest will fail with "SyntaxError: Unexpected token 'export'" — migrate to Vitest
- PDF.js updated to v5.3.31 with memory optimizations
- Next.js: must skip SSR (`dynamic(() => import('./PDFViewer'), { ssr: false })`)

**Known issues and solutions:**

| Issue | Solution |
|-------|----------|
| Worker version mismatch ("API version X does not match Worker version Y") | Ensure both react-pdf and pdfjs-dist are the same version; check pnpm hoisting |
| `workerSrc` overwritten at runtime | Set `GlobalWorkerOptions.workerSrc` in the same file as `<Document>` |
| PDF not rendering, no errors | Check browser console for CORS errors; check that worker is accessible |
| Flickering on page change after v9 upgrade | Known regression, workaround: use `key={pageNumber}` on `<Page>` to force remount |
| Production build works in dev but fails in prod | Worker file not being copied to dist; use vite-plugin-static-copy or CDN fallback |
| `pdf.worker.js?url` error with Vite | Use `import.meta.url` pattern instead of `?url` import |
| Performance with large PDFs (100+ pages) | Virtualize page list; only render 3–5 pages around current position; use IntersectionObserver |

**Performance virtualization pattern:**
```typescript
import { useVirtualizer } from '@tanstack/react-virtual';

function VirtualizedPDFViewer({ url }: { url: string }) {
    const [numPages, setNumPages] = useState(0);
    const parentRef = useRef<HTMLDivElement>(null);

    const virtualizer = useVirtualizer({
        count: numPages,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 1100, // estimated page height
        overscan: 2, // render 2 extra pages above/below viewport
    });

    return (
        <Document file={url} onLoadSuccess={({ numPages }) => setNumPages(numPages)}>
            <div ref={parentRef} style={{ height: '100vh', overflowY: 'auto' }}>
                <div style={{ height: virtualizer.getTotalSize() }}>
                    {virtualizer.getVirtualItems().map(virtualRow => (
                        <div
                            key={virtualRow.index}
                            style={{
                                position: 'absolute',
                                top: 0,
                                transform: `translateY(${virtualRow.start}px)`,
                            }}
                        >
                            <Page
                                pageNumber={virtualRow.index + 1}
                                renderTextLayer={false}   // Disable for perf on large docs
                                renderAnnotationLayer={false}
                            />
                        </div>
                    ))}
                </div>
            </div>
        </Document>
    );
}
```

---

### 4.3 Text Layer and Annotation Layer

**Text layer (`renderTextLayer`):**
- Renders invisible text over the canvas that allows text selection and copying
- Enables browser's Find (Ctrl+F) for PDFs when embedded in page
- Adds significant rendering time for text-heavy documents
- **Enable when:** Users need to copy text, accessibility is required
- **Disable when:** Performance is critical, document is scanned image-only

**Annotation layer (`renderAnnotationLayer`):**
- Renders clickable links, form fields, interactive elements
- Required for `@layer pdf-annotation` CSS from `AnnotationLayer.css`
- **Enable when:** PDFs have hyperlinks or forms
- **Disable when:** Pure document display, no interactivity needed

---

### 4.4 How Box and Google Drive Handle Viewing

**Box:**
- Uses its own proprietary viewer ("Box Preview")
- Converts documents server-side (Aspose or similar commercial SDK) before viewing
- Streams converted PDF/image representation to the browser
- API: `GET https://api.box.com/2.0/files/{file_id}/content` with `Accept: application/pdf`
- Box Preview supports 120+ file formats
- Falls back gracefully: shows download link if format cannot be rendered

**Google Drive:**
- Google Workspace native formats (Docs/Sheets/Slides) are rendered natively
- Non-Google formats (Office, PDF) are rendered through Google's conversion service
- New interface (Dec 2025): left rail with table of contents + page thumbnails for PDFs
- Uses Google Docs Viewer for third-party embeds: `https://docs.google.com/viewer?url=...`
- Google Docs Viewer supports: PDF, DOCX, XLSX, PPTX, TIFF, etc.

**Dropbox:**
- Shows preview for PDFs, images, common Office formats
- For Office files: converts to a preview image/PDF server-side
- Has dedicated office preview using Microsoft Office Online via WOPI for editing

---

### 4.5 WOPI Protocol for Office Document Viewing

WOPI (Web Application Open Platform Interface) is a REST-based protocol that allows web applications to view and edit Office documents without conversion to PDF.

**How it works:**
1. Your application serves as a **WOPI Host** — implements the WOPI REST endpoints
2. The document editor (OnlyOffice, Collabora, Microsoft 365 Online) acts as the **WOPI Client** — loads in an iframe
3. Editor calls your WOPI Host endpoints to read/write the document

**Required WOPI endpoints:**
```
GET  /wopi/files/{file_id}                    → CheckFileInfo (file metadata)
GET  /wopi/files/{file_id}/contents           → GetFile (download document)
POST /wopi/files/{file_id}/contents           → PutFile (save document)
POST /wopi/files/{file_id}?X-WOPI-Override=LOCK    → Lock
POST /wopi/files/{file_id}?X-WOPI-Override=UNLOCK  → Unlock
POST /wopi/files/{file_id}?X-WOPI-Override=REFRESH_LOCK → RefreshLock
POST /wopi/files/{file_id}?X-WOPI-Override=RENAME_FILE  → RenameFile
```

**WOPI Host implementation (FastAPI example):**
```python
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import StreamingResponse

@router.get("/wopi/files/{file_id}")
async def check_file_info(file_id: str, token: str = Query(...)):
    # Validate WOPI access token
    user = validate_wopi_token(token)
    doc = await db.get_document(file_id)

    return {
        "BaseFileName": doc.original_name,
        "Size": doc.size_bytes,
        "Version": str(doc.version),
        "UserId": str(user.id),
        "UserFriendlyName": user.display_name,
        "UserCanWrite": user.can_edit,
        "UserCanRename": False,
        "SupportsUpdate": True,
        "SupportsLocks": True,
        "SHA256": doc.sha256_checksum,
    }

@router.get("/wopi/files/{file_id}/contents")
async def get_file(file_id: str, token: str = Query(...)):
    validate_wopi_token(token)
    doc = await db.get_document(file_id)
    file_bytes = await storage.get(doc.storage_key)

    return StreamingResponse(
        iter([file_bytes]),
        media_type=doc.mime_type,
        headers={"Content-Length": str(doc.size_bytes)}
    )
```

**Embed the editor in an iframe:**
```html
<form id="office-form"
      action="https://your-onlyoffice-server/hosting/wopi/word/view"
      method="POST"
      target="office-frame">
    <input type="hidden" name="access_token" value="{wopi_token}">
    <input type="hidden" name="access_token_ttl" value="{expiry_ms}">
</form>
<iframe id="office-frame" name="office-frame" allowfullscreen></iframe>
<script>document.getElementById('office-form').submit();</script>
```

**WOPI client options:**
| Client | License | Notes |
|--------|---------|-------|
| OnlyOffice Docs | Open-source Community / Commercial | Strong ODF support, good compatibility |
| Collabora Online | Open-source / Commercial | LibreOffice-based, excellent compatibility |
| Microsoft 365 for the web | Commercial (requires M365) | Best for Microsoft formats |

---

### 4.6 Graceful Fallback for Document Viewing

**Fallback hierarchy:**
```
1. Native PDF viewer (react-pdf / PDF.js) — best experience
2. Browser native PDF rendering (<embed> or <iframe> with PDF src) — works without JS
3. Google Docs Viewer — good for PDFs and Office files, requires internet
4. Download link — last resort, always available
```

```typescript
type ViewerState = 'pdf-js' | 'browser-native' | 'google-docs' | 'download-only';

function DocumentViewerWithFallback({ url, mimeType, filename }: Props) {
    const [viewerState, setViewerState] = useState<ViewerState>('pdf-js');
    const [error, setError] = useState<string | null>(null);

    const handlePdfJsError = () => {
        console.warn('PDF.js failed, falling back to browser native');
        setViewerState('browser-native');
    };

    const handleBrowserNativeError = () => {
        console.warn('Browser native failed, falling back to Google Docs Viewer');
        setViewerState('google-docs');
    };

    if (mimeType !== 'application/pdf') {
        // Non-PDF: use Google Docs Viewer or show download
        return (
            <div>
                <iframe
                    src={`https://docs.google.com/viewer?url=${encodeURIComponent(url)}&embedded=true`}
                    width="100%"
                    height="600px"
                    onError={() => setViewerState('download-only')}
                />
                {viewerState === 'download-only' && (
                    <a href={url} download={filename}>Download {filename}</a>
                )}
            </div>
        );
    }

    switch (viewerState) {
        case 'pdf-js':
            return (
                <ErrorBoundary onError={handlePdfJsError} fallback={null}>
                    <PDFJsViewer url={url} onError={handlePdfJsError} />
                </ErrorBoundary>
            );

        case 'browser-native':
            return (
                <embed
                    src={url}
                    type="application/pdf"
                    width="100%"
                    height="600px"
                    onError={handleBrowserNativeError}
                />
            );

        case 'google-docs':
            return (
                <iframe
                    src={`https://docs.google.com/viewer?url=${encodeURIComponent(url)}&embedded=true`}
                    width="100%"
                    height="600px"
                    onError={() => setViewerState('download-only')}
                />
            );

        case 'download-only':
            return (
                <div className="document-download-fallback">
                    <p>Unable to display this document in the browser.</p>
                    <a href={url} download={filename} className="btn btn-primary">
                        Download {filename}
                    </a>
                </div>
            );
    }
}
```

---

## 5. Error Handling Patterns

### 5.1 Error Classification Matrix

| Error Type | Category | Retryable? | User Message | Technical Log |
|------------|----------|-----------|--------------|---------------|
| Corrupted file | Content error | No | "This file appears to be damaged and cannot be opened. Please try re-uploading the original file." | Full error + stack + file metadata |
| Password protected | Content error | No | "This file is password-protected. Please remove the password and re-upload." | MIME type, file size, detection method |
| Unsupported format | Validation error | No | "This file type is not supported. Supported formats: PDF, DOCX, XLSX, PPTX, TXT, JPG, PNG." | Detected MIME, declared MIME, extension |
| Conversion timeout | Infrastructure | Yes (3x) | "Document processing is taking longer than expected. We'll notify you when it's ready." | Timeout duration, file size, format |
| Conversion failure (unknown) | Infrastructure | Yes (3x) | "Document processing failed. Our team has been notified." | Full error, LibreOffice/Gotenberg stderr |
| Storage write failure | Infrastructure | Yes (5x) | "Upload failed due to a temporary issue. Please try again." | S3 error code, region, key |
| Storage read failure | Infrastructure | Yes (3x) | "Document temporarily unavailable. Please try again in a moment." | S3 error code, response |
| Auth/permission error | Security | No | "You don't have permission to access this document." | User ID, document ID, action |
| File too large | Validation | No | "File exceeds the maximum size of {MAX_SIZE}. Please compress or split the file." | File size, limit |
| Virus detected | Security | No | "This file has been blocked because it may be harmful." | File hash, scan result, AV signature |
| Network interruption | Client error | Yes (auto) | "Connection interrupted. Your upload will resume automatically." | N/A (client-side) |
| Rate limit | Infrastructure | Yes (with backoff) | "Too many requests. Please wait a moment and try again." | User ID, rate limit hit |

---

### 5.2 Frontend Error Boundary for Document Viewers

```typescript
import { Component, ReactNode } from 'react';

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: string | null;
}

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
    onError?: (error: Error, errorInfo: string) => void;
    documentId?: string;
}

export class DocumentViewerErrorBoundary extends Component<Props, State> {
    state: State = { hasError: false, error: null, errorInfo: null };

    static getDerivedStateFromError(error: Error): Partial<State> {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        const errorInfoStr = errorInfo.componentStack || '';
        this.setState({ errorInfo: errorInfoStr });

        // Log to your error tracking service (Sentry, DataDog, etc.)
        this.props.onError?.(error, errorInfoStr);

        // Send to telemetry
        fetch('/api/telemetry/error', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                error: error.message,
                stack: error.stack,
                componentStack: errorInfoStr,
                documentId: this.props.documentId,
                userAgent: navigator.userAgent,
                timestamp: new Date().toISOString(),
            }),
        }).catch(console.error);
    }

    handleRetry = () => {
        this.setState({ hasError: false, error: null, errorInfo: null });
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="document-viewer-error">
                    <h3>Unable to display document</h3>
                    <p>Something went wrong while loading this document.</p>
                    <button onClick={this.handleRetry}>Try again</button>
                </div>
            );
        }

        return this.props.children;
    }
}
```

---

### 5.3 Backend Retry Strategy

**Exponential backoff with jitter (recommended):**
```python
import asyncio
import random

async def retry_with_backoff(
    operation,
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 60.0,
    retryable_exceptions: tuple = (Exception,),
    non_retryable_exceptions: tuple = (),
):
    """
    Implements full jitter exponential backoff.
    delay = random(0, min(max_delay, base_delay * 2^attempt))
    """
    last_exception = None

    for attempt in range(max_retries + 1):
        try:
            return await operation()
        except non_retryable_exceptions as e:
            # Don't retry these
            raise
        except retryable_exceptions as e:
            last_exception = e
            if attempt == max_retries:
                break

            # Full jitter: random between 0 and exponential cap
            cap = min(max_delay, base_delay * (2 ** attempt))
            delay = random.uniform(0, cap)

            logger.warning(
                f"Attempt {attempt + 1}/{max_retries + 1} failed: {e}. "
                f"Retrying in {delay:.1f}s"
            )
            await asyncio.sleep(delay)

    raise last_exception

# Usage for document conversion
await retry_with_backoff(
    operation=lambda: convert_document(file_bytes),
    max_retries=3,
    base_delay=5.0,
    max_delay=120.0,
    non_retryable_exceptions=(PasswordProtectedError, CorruptedFileError, UnsupportedFormatError),
    retryable_exceptions=(ConversionTimeoutError, NetworkError, StorageError),
)
```

---

### 5.4 User-Facing vs. Technical Messages

**Never expose technical details to users:**
```python
# Bad:
raise HTTPException(status_code=500, detail=str(e))  # Exposes stack trace

# Good:
logger.error(f"Conversion failed for doc {document_id}: {str(e)}", exc_info=True)
raise HTTPException(status_code=500, detail={
    "code": "CONVERSION_FAILED",
    "message": "Document processing failed. Please try again or contact support.",
    "requestId": request_id,  # For correlation with server logs
})
```

**Correlation IDs:** Always generate a request ID at the API gateway level and propagate it through all logs. Include it in error responses so users can quote it to support.

```python
# FastAPI middleware
import uuid

@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request_id = str(uuid.uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response
```

---

## 6. Upload Handling

### 6.1 Resumable/Chunked Uploads

#### tus Protocol

tus is an open HTTP-based protocol for resumable file uploads. The tus client splits the file into chunks and uploads them sequentially. If the connection drops, the client queries the server for the offset and resumes from where it left off.

**tus endpoints:**
```
POST   /upload                      → Create upload (returns Location URL)
HEAD   /upload/{upload_id}          → Get current offset
PATCH  /upload/{upload_id}          → Upload chunk (sends bytes from offset)
DELETE /upload/{upload_id}          → Abort upload
```

**tus + S3 multipart integration:**
```python
# tusdotnet (Python equivalent concept)
class S3TusStore:
    def __init__(self, s3_client, bucket: str):
        self.s3 = s3_client
        self.bucket = bucket
        self.uploads = {}  # In production: store in Redis

    async def create_upload(self, upload_length: int, metadata: dict) -> str:
        upload_id = str(uuid.uuid4())

        # Initiate S3 multipart upload
        response = await self.s3.create_multipart_upload(
            Bucket=self.bucket,
            Key=f"uploads/{upload_id}",
            ContentType=metadata.get('filetype', 'application/octet-stream'),
        )

        self.uploads[upload_id] = {
            's3_upload_id': response['UploadId'],
            'parts': [],
            'offset': 0,
            'total_length': upload_length,
            'metadata': metadata,
        }
        return upload_id

    async def write_chunk(self, upload_id: str, data: bytes, offset: int):
        upload = self.uploads[upload_id]
        part_number = len(upload['parts']) + 1

        # S3 minimum part size is 5 MB (except last part)
        response = await self.s3.upload_part(
            Bucket=self.bucket,
            Key=f"uploads/{upload_id}",
            PartNumber=part_number,
            UploadId=upload['s3_upload_id'],
            Body=data,
        )

        upload['parts'].append({
            'PartNumber': part_number,
            'ETag': response['ETag'],
        })
        upload['offset'] += len(data)

        # If upload complete, finalize multipart
        if upload['offset'] >= upload['total_length']:
            await self._complete_upload(upload_id)

    async def _complete_upload(self, upload_id: str):
        upload = self.uploads[upload_id]
        await self.s3.complete_multipart_upload(
            Bucket=self.bucket,
            Key=f"uploads/{upload_id}",
            UploadId=upload['s3_upload_id'],
            MultipartUpload={'Parts': upload['parts']},
        )
        # Queue document processing
        await queue_conversion(upload_id)
```

**JavaScript tus client:**
```javascript
import * as tus from 'tus-js-client';

function uploadFile(file: File, onProgress: (percent: number) => void): Promise<string> {
    return new Promise((resolve, reject) => {
        const upload = new tus.Upload(file, {
            endpoint: '/api/uploads',
            retryDelays: [0, 3000, 5000, 10000, 20000], // Retry with backoff
            chunkSize: 5 * 1024 * 1024,  // 5 MB chunks (S3 minimum)
            metadata: {
                filename: file.name,
                filetype: file.type,
            },
            onError: reject,
            onProgress: (bytesUploaded, bytesTotal) => {
                onProgress(Math.round((bytesUploaded / bytesTotal) * 100));
            },
            onSuccess: () => resolve(upload.url!),
        });

        // Check for previous partial upload
        upload.findPreviousUploads().then(previousUploads => {
            if (previousUploads.length > 0) {
                upload.resumeFromPreviousUpload(previousUploads[0]);
            }
            upload.start();
        });
    });
}
```

#### S3 Direct Multipart Upload (without tus)

```python
# Create presigned URLs for each part
import boto3

s3 = boto3.client('s3')

def initiate_multipart_upload(key: str, content_type: str) -> dict:
    response = s3.create_multipart_upload(
        Bucket=BUCKET,
        Key=key,
        ContentType=content_type,
    )
    return {'uploadId': response['UploadId'], 'key': key}

def get_presigned_upload_url(key: str, upload_id: str, part_number: int) -> str:
    """Generate presigned URL for a specific part upload."""
    return s3.generate_presigned_url(
        'upload_part',
        Params={
            'Bucket': BUCKET,
            'Key': key,
            'UploadId': upload_id,
            'PartNumber': part_number,
        },
        ExpiresIn=3600,
    )

def complete_multipart_upload(key: str, upload_id: str, parts: list) -> str:
    """parts = [{'PartNumber': 1, 'ETag': '...'}, ...]"""
    s3.complete_multipart_upload(
        Bucket=BUCKET,
        Key=key,
        UploadId=upload_id,
        MultipartUpload={'Parts': parts},
    )
    return key
```

**S3 multipart constraints:**
- Minimum part size: **5 MB** (except the last part)
- Maximum parts: **10,000** per upload
- Maximum file size: **5 TB**
- Parts must be uploaded in order (but can be parallel)

---

### 6.2 Virus Scanning Integration

**Architecture: scan-before-store pattern (recommended):**
```
Upload → Temp Storage → AV Scan → [Pass: Move to permanent storage] / [Fail: Delete + notify]
```

**ClamAV integration (Node.js):**
```javascript
import NodeClam from 'clamscan';

const clamscan = await new NodeClam().init({
    clamdscan: {
        socket: '/var/run/clamav/clamd.ctl',  // Unix socket (faster)
        // host: 'localhost',                 // Or TCP
        // port: 3310,
        timeout: 60000,
        active: true,
    },
    preference: 'clamdscan',
});

async function scanFile(filePath: string): Promise<void> {
    const { isInfected, viruses } = await clamscan.scanFile(filePath);

    if (isInfected) {
        throw new VirusDetectedError(`File contains malware: ${viruses.join(', ')}`);
    }
}
```

**ClamAV Docker + REST API (for microservice architecture):**
```yaml
# docker-compose.yml
services:
  clamav:
    image: clamav/clamav:stable
    volumes:
      - clamav-data:/var/lib/clamav
    environment:
      - CLAMAV_NO_CLAMD=false
      - CLAMAV_NO_FRESHCLAMD=false

  clamav-rest:
    image: benzino77/clamav-rest-api:latest
    ports:
      - "8080:8080"
    environment:
      - APP_CLAMD_HOST=clamav
      - APP_CLAMD_PORT=3310
    depends_on:
      - clamav
```

```python
async def scan_with_clamav_api(file_bytes: bytes, filename: str) -> bool:
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            "http://clamav-rest:8080/api/v1/scan",
            files={"FILES": (filename, file_bytes)},
        )
        result = response.json()

        if result.get("Status") == "FOUND":
            raise VirusDetectedError(f"Virus found: {result.get('Description')}")

        return True
```

**Cloud-native scanning alternatives:**
- AWS GuardDuty Malware Protection for S3 (scans on PUT, triggers Lambda)
- Google Cloud Security Command Center
- Azure Defender for Storage

---

### 6.3 Complete Upload Validation Pipeline

```python
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100 MB
ALLOWED_MIME_TYPES = {
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'text/plain',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/tiff',
}

async def process_upload(
    file_content: bytes,
    filename: str,
    declared_mime: str,
    user_id: str,
    tenant_id: str,
) -> Document:

    # 1. Size check (fast, first)
    if len(file_content) > MAX_FILE_SIZE:
        raise FileTooLargeError(f"File size {len(file_content)} exceeds {MAX_FILE_SIZE}")

    if len(file_content) == 0:
        raise EmptyFileError("File is empty")

    # 2. MIME type detection (magic bytes)
    detected_mime = detect_mime(file_content)

    if detected_mime not in ALLOWED_MIME_TYPES:
        raise UnsupportedFormatError(f"File type {detected_mime} is not supported")

    # 3. Verify declared vs detected MIME
    if not validate_mime_compatibility(detected_mime, declared_mime):
        # Log mismatch but use detected MIME
        logger.warning(f"MIME mismatch: declared={declared_mime}, detected={detected_mime}")

    # 4. Check for password protection
    if is_password_protected(file_content, detected_mime):
        raise PasswordProtectedError("File is password-protected")

    # 5. Virus scan (before storing)
    await scan_with_clamav_api(file_content, filename)

    # 6. Compute checksum
    checksum = hashlib.sha256(file_content).hexdigest()

    # 7. Check for duplicate (within tenant)
    existing = await db.find_by_checksum(tenant_id, checksum)
    if existing and not existing.is_deleted:
        # Return existing document record (no re-upload needed)
        return existing

    # 8. Sanitize filename
    safe_filename = sanitize_filename(filename)

    # 9. Generate storage key (no extension!)
    storage_key = f"{tenant_id}/{datetime.now().year:04d}/{datetime.now().month:02d}/{uuid4()}"

    # 10. Upload to object store
    await object_store.put(
        key=storage_key,
        content=file_content,
        content_type=detected_mime,
        metadata={
            'original-name': safe_filename,
            'tenant-id': tenant_id,
            'uploaded-by': user_id,
            'checksum': checksum,
        }
    )

    # 11. Create metadata record
    document = await db.create_document(
        storage_key=storage_key,
        original_name=safe_filename,
        mime_type=detected_mime,
        size_bytes=len(file_content),
        sha256_checksum=checksum,
        tenant_id=tenant_id,
        created_by=user_id,
    )

    # 12. Queue conversion if needed
    if detected_mime != 'application/pdf':
        await queue_conversion(document.id)

    return document
```

---

### 6.4 Filename Sanitization

```python
import re
import unicodedata

def sanitize_filename(filename: str, max_length: int = 255) -> str:
    # Normalize unicode (convert accented chars, etc.)
    filename = unicodedata.normalize('NFKD', filename)
    filename = filename.encode('ascii', 'ignore').decode('ascii')

    # Split name and extension
    parts = filename.rsplit('.', 1)
    name = parts[0]
    ext = ('.' + parts[1]) if len(parts) > 1 else ''

    # Remove dangerous characters
    name = re.sub(r'[^\w\s\-_.]', '', name)
    name = re.sub(r'\s+', '_', name.strip())
    name = name.strip('._')

    # Prevent directory traversal
    name = name.replace('..', '')

    # Truncate if too long
    max_name_length = max_length - len(ext)
    name = name[:max_name_length]

    return (name or 'unnamed') + ext
```

---

## 7. Known Issues and Solutions

### 7.1 LibreOffice Headless Known Issues

#### Issue: Conversion hangs indefinitely on corrupted/certain DOCX files
- **Symptom:** `libreoffice --headless --convert-to pdf` process never exits; CPU at 100%
- **Root cause:** LibreOffice tries to repair corrupted files and loops
- **Solution:** Always wrap in a timeout; kill the process; mark file as `corrupted`
- **Bug reference:** LibreOffice Bug #122192 (open since 2018)

#### Issue: Concurrent conversions fail silently
- **Symptom:** Second conversion produces empty PDF or no output file
- **Root cause:** LibreOffice is single-threaded and not re-entrant
- **Solutions:**
  1. Run separate LibreOffice process per conversion with `--norestore`
  2. Use separate `UserInstallation` directories
  3. Use Gotenberg (handles queuing internally)
  4. Use commercial SDK (Aspose) — thread-safe

#### Issue: LibreOffice listener startup timeout in Gotenberg
- **Symptom:** `[FATAL] starting uno: context deadline exceeded exit status 1`
- **Solutions:**
  ```yaml
  # In Gotenberg, increase timeouts:
  --libreoffice-start-timeout=60s
  --api-timeout=120s
  ```
  - Increase container memory (minimum 2 GB recommended)
  - Check for port conflicts on the UNO socket

#### Issue: LibreOffice headless crashes on Windows 10
- **Symptom:** Intermittent crashes, lock files left behind
- **Root cause:** Windows-specific instability in headless mode
- **Solution:** Use Docker container on Linux (even on Windows host via WSL2/Docker Desktop); avoid running LibreOffice headless natively on Windows Server for production

#### Issue: LibreOffice version instability in Docker
- **Symptom:** Sudden stability degradation after Docker image pull
- **Root cause:** A broken LibreOffice release was published (e.g., October 2022)
- **Solution:** Pin Gotenberg to a specific image version in production:
  ```yaml
  image: gotenberg/gotenberg:8.5.0  # Pin exact version
  ```

#### Issue: Font rendering differences
- **Symptom:** PDF output looks different from Windows Word (missing fonts, wrong layout)
- **Solution:**
  - Install Windows core fonts on Linux: `apt-get install ttf-mscorefonts-installer`
  - Or use font embedding in LibreOffice config
  - Commercial solutions (Aspose) handle fonts better

---

### 7.2 PDF.js Known Issues

#### Issue: Worker version mismatch
- **Symptom:** `The API version "4.4.168" does not match the Worker version "4.6.82"`
- **Root cause:** Multiple versions of `pdfjs-dist` installed (pnpm deduplication issue, or react-pdf and direct pdfjs-dist at different versions)
- **Solution:**
  ```bash
  # In package.json, force exact version
  "pdfjs-dist": "4.4.168"

  # In pnpm, add to .npmrc:
  public-hoist-pattern[]=pdfjs-dist

  # Or use overrides in package.json:
  "overrides": {
      "pdfjs-dist": "4.4.168"
  }
  ```

#### Issue: `GlobalWorkerOptions.workerSrc` not set (no worker specified warning)
- **Symptom:** Console warning "No 'GlobalWorkerOptions.workerSrc' specified"
- **Root cause:** Worker not configured before PDF load
- **Solution:** Set `GlobalWorkerOptions.workerSrc` in the same module that imports/renders `<Document>`, not in a separate bootstrap file

#### Issue: Worker fails to load in Vite production build
- **Symptom:** Works in `vite dev`, fails in `vite build`; 404 on worker file
- **Root cause:** Vite hashes the worker file; the hardcoded path becomes invalid
- **Solutions:**
  1. Use `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()` — Vite handles this correctly
  2. Copy worker to `/public` and reference `/pdf.worker.min.mjs`
  3. Use CDN URL (but introduces CDN dependency)

#### Issue: Dynamic import warning from Vite for `pdfjs-dist`
- **Symptom:** Vite build warning about dynamic imports in pdfjs-dist
- **Root cause:** PDF.js uses `/* webpackIgnore: true */` comments but not `/* viteIgnore: true */`
- **Solution:** Add to `vite.config.ts`:
  ```javascript
  optimizeDeps: {
      exclude: ['pdfjs-dist'],
  }
  ```

#### Issue: CORS error when loading PDF from S3/different origin
- **Symptom:** "Loading chunk N failed" or "CORS policy" error in console
- **Root cause:** PDF.js fetches the PDF file itself; if the URL is cross-origin, CORS headers must be set
- **Solutions:**
  1. Add CORS headers to S3 bucket:
     ```json
     [{"AllowedHeaders": ["*"], "AllowedMethods": ["GET", "HEAD"], "AllowedOrigins": ["https://yourapp.com"], "ExposeHeaders": ["Content-Range", "Accept-Ranges", "Content-Length"]}]
     ```
  2. Proxy the file through your backend (adds `Access-Control-Allow-Origin`)
  3. Use the browser's native `<embed>` for PDFs hosted on S3 (no CORS needed for `<embed>`)

#### Issue: Large PDFs (100+ pages) cause memory issues / browser tab crash
- **Symptom:** Tab becomes unresponsive, eventual crash; especially on mobile
- **Solution:** Virtualize page list (render only visible pages), disable text layer for large docs
  ```typescript
  // Only render 5 pages around the current page
  const visiblePages = Array.from({ length: numPages }, (_, i) => i + 1)
      .filter(p => Math.abs(p - currentPage) <= 2);
  ```

---

### 7.3 react-pdf Specific Issues

#### Issue: PDF not rendering after v9 upgrade with no errors
- **GitHub:** Issue #1825
- **Root cause:** Worker configuration not being applied due to module import order
- **Solution:** Move `pdfjs.GlobalWorkerOptions.workerSrc = ...` into the component file itself

#### Issue: PDF flickering on page change in v9
- **GitHub:** Issue #1836
- **Root cause:** Canvas element replaced on each render
- **Workaround:** Add `key={pageNumber}` to the `<Page>` component to explicitly manage remounting

#### Issue: Jest tests fail after v9 upgrade
- **Symptom:** `SyntaxError: Unexpected token 'export'`
- **Root cause:** react-pdf v9 is ESM-only; Jest doesn't support ESM by default
- **Solutions:**
  1. Migrate test runner to Vitest (recommended)
  2. Configure Jest with `transform` for ESM:
     ```json
     // jest.config.js
     {
         "extensionsToTreatAsEsm": [".ts", ".tsx"],
         "transform": {
             "^.+\\.(t|j)sx?$": ["@swc/jest", { "jsc": { "parser": { "syntax": "typescript" } } }]
         },
         "transformIgnorePatterns": []
     }
     ```
  3. Mock react-pdf in Jest tests entirely:
     ```javascript
     // __mocks__/react-pdf.js
     module.exports = {
         Document: ({ children }) => children,
         Page: () => null,
         pdfjs: { GlobalWorkerOptions: {} },
     };
     ```

#### Issue: Next.js SSR fails with react-pdf v9/v10
- **Symptom:** `Error: Cannot use import statement in a module` or webpack errors during SSR
- **Solution:**
  ```javascript
  // pages/document-viewer.tsx (Pages Router)
  import dynamic from 'next/dynamic';
  const PDFViewer = dynamic(() => import('../components/PDFViewer'), { ssr: false });

  // app/document-viewer/page.tsx (App Router)
  'use client'; // Mark as client component
  import dynamic from 'next/dynamic';
  const PDFViewer = dynamic(() => import('../../components/PDFViewer'), { ssr: false });
  ```

#### Issue: CVE-2024-12905 (tar-fs vulnerability chain)
- Affects react-pdf dependency tree via `tar-fs`
- Update to latest react-pdf release which has patched the dependency
- Run `npm audit` or `pnpm audit` regularly

---

### 7.4 CORS Configuration for Document Preview

**Nginx configuration for serving documents with full range request support:**
```nginx
location /documents/ {
    # CORS headers
    add_header 'Access-Control-Allow-Origin' 'https://yourapp.com' always;
    add_header 'Access-Control-Allow-Methods' 'GET, HEAD, OPTIONS' always;
    add_header 'Access-Control-Allow-Headers' 'Range, Authorization, Content-Type' always;
    add_header 'Access-Control-Expose-Headers' 'Content-Range, Accept-Ranges, Content-Length, Content-Type' always;

    # Handle preflight
    if ($request_method = 'OPTIONS') {
        add_header 'Access-Control-Max-Age' 1728000;
        add_header 'Content-Type' 'text/plain charset=UTF-8';
        add_header 'Content-Length' 0;
        return 204;
    }

    # Range requests support
    add_header 'Accept-Ranges' 'bytes' always;

    # Proxy to your document service
    proxy_pass http://document-service:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;

    # Important for streaming large files
    proxy_buffering off;
    proxy_request_buffering off;
}
```

**S3 bucket CORS configuration:**
```json
[
    {
        "AllowedHeaders": ["*"],
        "AllowedMethods": ["GET", "HEAD", "PUT"],
        "AllowedOrigins": ["https://yourapp.com"],
        "ExposeHeaders": [
            "Content-Range",
            "Accept-Ranges",
            "Content-Length",
            "Content-Type",
            "ETag"
        ],
        "MaxAgeSeconds": 3600
    }
]
```

---

### 7.5 PDF Linearization for Fast Web Viewing

**What it is:** A linearized PDF has its structure reorganized so the first page and hint tables are at the beginning of the file, enabling page-at-a-time streaming.

**How to create linearized PDFs:**
```bash
# Using qpdf (open source)
qpdf --linearize input.pdf output_linearized.pdf

# Using Ghostscript
gs -dBATCH -dNOPAUSE -sDEVICE=pdfwrite \
   -dFastWebView=true \
   -sOutputFile=output_linearized.pdf input.pdf
```

**Gotenberg linearization:**
```python
# Gotenberg doesn't linearize by default but outputs a valid PDF
# Post-process with qpdf after conversion
async def convert_and_linearize(file_bytes: bytes, filename: str) -> bytes:
    pdf_bytes = await convert_with_gotenberg(file_bytes, filename)

    # Write to temp file and linearize
    with tempfile.TemporaryDirectory() as tmpdir:
        input_path = f"{tmpdir}/input.pdf"
        output_path = f"{tmpdir}/output.pdf"

        Path(input_path).write_bytes(pdf_bytes)

        proc = subprocess.run(
            ['qpdf', '--linearize', input_path, output_path],
            capture_output=True, timeout=30
        )

        if proc.returncode == 0:
            return Path(output_path).read_bytes()
        else:
            return pdf_bytes  # Fall back to non-linearized
```

**Verifying linearization:**
```bash
qpdf --check input.pdf
# Look for: "File is linearized"
```

---

## Appendix: Quick Reference

### Supported MIME Types for Common DMS Operations

```python
MIME_TO_CATEGORY = {
    # Documents
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word',
    'application/msword': 'word',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'excel',
    'application/vnd.ms-excel': 'excel',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'powerpoint',
    'application/vnd.ms-powerpoint': 'powerpoint',
    'application/rtf': 'document',
    'text/plain': 'text',
    'text/html': 'html',
    'text/csv': 'spreadsheet',

    # Images
    'image/jpeg': 'image',
    'image/png': 'image',
    'image/gif': 'image',
    'image/tiff': 'image',
    'image/bmp': 'image',
    'image/webp': 'image',
    'image/svg+xml': 'image',

    # Archives
    'application/zip': 'archive',
    'application/x-tar': 'archive',
    'application/gzip': 'archive',

    # Email
    'message/rfc822': 'email',
    'application/vnd.ms-outlook': 'email',
}

CONVERTIBLE_TO_PDF = {
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint',
    'application/rtf',
    'text/plain',
    'text/html',
    'image/jpeg',
    'image/png',
    'image/tiff',
}
```

### Conversion Status State Machine

```
PENDING → PROCESSING → DONE
            ↓
         FAILED (retryable) → PROCESSING (retry 1)
                           → PROCESSING (retry 2)
                           → PROCESSING (retry 3)
                           → PERMANENTLY_FAILED

PENDING → SKIPPED (password_protected, corrupted, unsupported)
```

### Version Summary: react-pdf / pdfjs-dist

| react-pdf | pdfjs-dist | CJS/ESM | CSS Import Path | Notes |
|-----------|-----------|---------|-----------------|-------|
| v7.x | 3.x | Both | `dist/esm/Page/...` | Legacy |
| v8.x | 4.0–4.3 | Both | `dist/esm/Page/...` | |
| v9.x | 4.4+ | Both | `dist/esm/Page/...` | Major PDF.js upgrade |
| v10.x | 5.x | ESM only | `dist/Page/...` | Breaking: no CJS; Jest issues |

---

*Sources and further reading:*
- [AWS S3 Performance Best Practices](https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance.html)
- [SharePoint RBS Overview](https://learn.microsoft.com/en-us/sharepoint/administration/rbs-overview)
- [Dropbox Magic Pocket](https://dropbox.tech/infrastructure/inside-the-magic-pocket)
- [Gotenberg Documentation](https://gotenberg.dev/)
- [react-pdf GitHub](https://github.com/wojtekmaj/react-pdf)
- [react-pdf v9→v10 Upgrade Guide](https://github.com/wojtekmaj/react-pdf/wiki/Upgrade-guide-from-version-9.x-to-10.x)
- [PDF.js GitHub Issues](https://github.com/mozilla/pdf.js/issues)
- [tus.io S3 Backend](https://tus.io/blog/2016/03/07/tus-s3-backend.html)
- [WOPI Protocol - Microsoft Learn](https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/online/)
- [AWS Presigned URL Best Practices](https://docs.aws.amazon.com/prescriptive-guidance/latest/presigned-url-best-practices/presigned-url-best-practices.pdf)
- [DocuWare Architecture White Paper](https://www.amsdocumentmanagement.co.uk/wp-content/uploads/2022/09/DocuWare-white-paper-7.4.pdf)
- [HTTP Range Requests - MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests)
- [PDF Linearization - Apryse](https://apryse.com/blog/pdf-format/what-is-pdf-linearization)
- [AWS Retry with Backoff](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/retry-backoff.html)
- [ClamAV REST API](https://github.com/benzino77/clamav-rest-api)
