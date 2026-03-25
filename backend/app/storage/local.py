import os
from collections.abc import AsyncIterator
from pathlib import Path

import aiofiles

from app.storage.base import StorageAdapter

CHUNK_SIZE = 1024 * 64  # 64 KB


class LocalStorageAdapter(StorageAdapter):
    def __init__(self, base_dir: str) -> None:
        self.base_path = Path(base_dir)
        self.base_path.mkdir(parents=True, exist_ok=True)

    async def save(self, file_id: str, data: bytes) -> str:
        # Shard into subdirectories by first 2 chars of file_id to avoid
        # large flat directories (e.g. aa/aabbcc...)
        shard = file_id[:2]
        dest_dir = self.base_path / shard
        dest_dir.mkdir(exist_ok=True)
        dest = dest_dir / file_id
        async with aiofiles.open(dest, "wb") as f:
            await f.write(data)
        return str(dest.relative_to(self.base_path))

    async def stream(self, storage_path: str) -> AsyncIterator[bytes]:
        full_path = self.base_path / storage_path
        async with aiofiles.open(full_path, "rb") as f:
            while chunk := await f.read(CHUNK_SIZE):
                yield chunk

    async def delete(self, storage_path: str) -> None:
        full_path = self.base_path / storage_path
        if full_path.exists():
            os.remove(full_path)
