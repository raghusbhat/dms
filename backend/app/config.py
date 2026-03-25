from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str
    secret_key: str
    environment: str = "development"
    libreoffice_path: str = r"C:\Program Files\LibreOffice\program\soffice.exe"
    converted_files_dir: str = "data/converted"


settings = Settings()
