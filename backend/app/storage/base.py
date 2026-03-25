from abc import ABC, abstractmethod
from collections.abc import AsyncIterator


class StorageAdapter(ABC):
    @abstractmethod
    async def save(self, file_id: str, data: bytes) -> str:
        """Persist file bytes. Returns the storage path."""

    @abstractmethod
    async def stream(self, storage_path: str) -> AsyncIterator[bytes]:
        """Stream file contents by storage path."""

    @abstractmethod
    async def delete(self, storage_path: str) -> None:
        """Delete a stored file."""
