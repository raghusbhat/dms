"""
Quick DB connection test — run before migrations.
Delete this file after confirming the connection works.
"""
import asyncio
import asyncpg
from app.config import settings


async def test() -> None:
    # Strip the SQLAlchemy driver prefix — asyncpg connects directly
    url = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")

    print(f"Connecting to: {url.split('@')[-1]}")  # host/db only, no credentials in output

    try:
        conn = await asyncpg.connect(url)
        row = await conn.fetchrow("SELECT current_database(), current_user, version()")
        await conn.close()

        print(f"  database : {row['current_database']}")
        print(f"  user     : {row['current_user']}")
        print(f"  pg ver   : {row['version'].split(',')[0]}")
        print("\nConnection OK — safe to run migrations.")

    except Exception as e:
        print(f"\nConnection FAILED: {e}")
        raise SystemExit(1)


asyncio.run(test())
