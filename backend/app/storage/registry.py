from app.storage.base import StorageAdapter
from app.storage.local import LocalStorageAdapter

# Single instance used across the app.
# Swap this for S3Adapter / R2Adapter when ready.
storage: StorageAdapter = LocalStorageAdapter(base_dir="data/files")
