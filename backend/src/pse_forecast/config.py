from datetime import date
from functools import lru_cache
from zoneinfo import ZoneInfo

from pydantic_settings import BaseSettings, SettingsConfigDict

TZ = ZoneInfo("Europe/Warsaw")

# PSE switched from gross to net demand on 2024-06-14; the v2 `kse-load` entity starts here.
DATA_START = date(2024, 6, 14)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://pse:pse@db:5432/pse"
    mlflow_tracking_uri: str = "http://mlflow:5000"
    mlflow_public_url: str = "http://localhost:5000"
    mlflow_experiment: str = "pse-demand"
    registered_model_name: str = "pse-demand-lgbm"
    test_days: int = 60
    # Browser origins allowed to call the API, comma-separated (add your Vercel URL in production).
    cors_origins: str = "http://localhost:3000,http://localhost:5173"
    # Public database that `cli publish` promotes the local model and data to (e.g. Neon).
    publish_database_url: str = ""
    # --- Public API protection (see security.py) ---
    # Read the client address from proxy headers. Enable only behind a proxy (Render).
    trust_proxy_headers: bool = False
    rate_limit_per_minute: int = 120  # per client, all endpoints
    whatif_rate_limit_per_minute: int = 30  # per client, model runs
    global_rate_limit_per_minute: int = 3000  # all clients together
    whatif_max_concurrent: int = 2
    max_body_bytes: int = 8192
    # Create missing tables on startup. Disable for a read-only database user (production API).
    manage_schema: bool = True
    pse_base_url: str = "https://api.raporty.pse.pl/api"
    http_timeout: float = 60.0

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
