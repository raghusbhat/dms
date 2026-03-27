from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str
    secret_key: str
    environment: str = "development"
    libreoffice_path: str = r"C:\Program Files\LibreOffice\program\soffice.exe"
    converted_files_dir: str = "data/converted"
    storage_files_dir: str = "data/files"
    redis_url: str = "redis://localhost:6379/0"
    storage_backend: str = "local"
    ai_enabled: bool = True
    ai_provider: str = "gemini"
    ai_model: str = "gemini-2.5-flash"
    gemini_api_key: str = ""
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5"
    meilisearch_url: str = "http://localhost:7700"
    meilisearch_api_key: str = "dev-master-key-change-in-production"
    base_dir: str = str(Path(__file__).resolve().parent.parent)


settings = Settings()
