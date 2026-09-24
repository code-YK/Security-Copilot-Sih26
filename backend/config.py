"""
Application configuration.

All runtime configuration is sourced from environment variables (via a
`.env` file in development) so that no secrets are ever hardcoded in
source control. See `.env.example` for the full list of supported
variables. This is the one place to look when tuning a threshold or
swapping a model name — nothing here is duplicated elsewhere.
"""
from functools import lru_cache
from typing import List

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Strongly typed application settings, loaded from environment variables."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- General -----------------------------------------------------
    APP_NAME: str = "security-copilot"
    ENVIRONMENT: str = Field(default="development", description="development | production")
    DEBUG: bool = True
    LOG_LEVEL: str = "INFO"

    # --- CORS ------------------------------------------------------------
    # Lock this down to the extension's specific chrome-extension://<id>
    # origin once it has one (spec section 10) — "*" is fine for the POC.
    CORS_ORIGINS: str | List[str] = Field(
        default_factory=lambda: ["chrome-extension://*", "http://localhost", "http://127.0.0.1"]
    )

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _split_cors(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    # --- LLM (agent) — OpenRouter (OpenAI-compatible API) -----------------
    # OpenRouter exposes many providers behind one OpenAI-compatible endpoint;
    # agent/llm_client.py talks to it via langchain_openai.ChatOpenAI pointed
    # at OPENROUTER_BASE_URL.
    OPENROUTER_API_KEY: str = Field(
        default="",
        description="Required. Get one at https://openrouter.ai/keys",
    )
    OPENROUTER_MODEL: str = Field(
        default="openai/gpt-oss-120b",
        description="Must support tool calling (the agent binds tools). Browse models at https://openrouter.ai/models",
    )
    OPENROUTER_BASE_URL: str = Field(
        default="https://openrouter.ai/api/v1",
        description="OpenAI-compatible base URL for OpenRouter.",
    )
    # LangGraph's recursion_limit counts every node hop, not just agent<->tools
    # round trips — router + (agent, tools) per tool call + a final agent
    # response + output. 15 comfortably covers spec's "~5 loop iterations"
    # while still bounding a runaway agent (verified empirically: a limit of
    # 5 cut off a normal 2-tool-call investigation before it could conclude).
    AGENT_RECURSION_LIMIT: int = Field(default=15, description="Max LangGraph super-steps before failing safe")
    # A multi-link email needs real headroom beyond the single-URL budget
    # above — investigating each extracted link costs its own inspect_website
    # + domain_reputation round trip (~4 hops), on top of the base budget.
    # graph.py adds `len(email_links) * this` to AGENT_RECURSION_LIMIT for
    # email cases only; link cases are unaffected.
    EMAIL_LINK_RECURSION_BUDGET: int = Field(default=5, description="Extra recursion hops budgeted per email link")

    # --- Router fast path (spec section 2) ---------------------------------
    CACHE_DB_PATH: str = "data/cache.db"
    CACHE_TTL_HOURS: int = 24
    BLOCKLIST_PATH: str = "data/blocklist.txt"

    # --- Tool: inspect_website (Playwright sandbox) -------------------------
    SANDBOX_TIMEOUT_SECONDS: float = 12.0
    SANDBOX_MAX_PAGE_TEXT_CHARS: int = 5000
    SANDBOX_MAX_NETWORK_REQUESTS: int = 50
    SANDBOX_MAX_LINKS: int = 30
    # The screenshot itself never goes back through the LLM's context (see
    # tools/inspect_website.py's content_and_artifact split) — this is where
    # callers that want the actual image (cli.py, later the API) save it.
    SCREENSHOT_DIR: str = "data/screenshots"

    # --- Per-case investigation reports (report.py) --------------------------
    REPORT_DIR: str = "data/reports"

    # --- Run history, for the UI (history.py) ---------------------------------
    HISTORY_DB_PATH: str = "data/history.db"

    # --- Tool: domain_reputation (WHOIS + VirusTotal) -----------------------
    VT_API_KEY: str = Field(default="", description="Optional. VirusTotal v3 API key — degrades gracefully if unset")
    THREAT_INTEL_TIMEOUT_SECONDS: float = 8.0

    # --- Tool: geolocate_ip (tools/geolocate.py) ------------------------------
    # MaxMind GeoLite2 databases (free account, offline). If absent, falls
    # back to ip-api.com (free, keyless, 45 req/min).
    INTEL_DIR: str = "data/intel"
    GEOIP_CITY_DB_PATH: str = "data/intel/GeoLite2-City.mmdb"
    GEOIP_ASN_DB_PATH: str = "data/intel/GeoLite2-ASN.mmdb"
    TOR_EXIT_LIST_URL: str = "https://check.torproject.org/torbulkexitlist"
    TOR_LIST_MAX_AGE_HOURS: float = 6.0
    ABUSEIPDB_API_KEY: str = Field(default="", description="Optional. AbuseIPDB free tier (1,000 checks/day)")

    # --- Tool: content_classifier (pirocheto ONNX / ealvaradob BERT) --------
    CONTENT_CLASSIFIER_URL_MODEL: str = "pirocheto/phishing-url-detection"
    CONTENT_CLASSIFIER_TEXT_MODEL: str = "ealvaradob/bert-finetuned-phishing"

    # --- Tool: web_search (keyless DuckDuckGo via ddgs) ----------------------
    WEB_SEARCH_MAX_RESULTS: int = 5

    # SecureBERT — embeds past cases for memory/case_index.py.
    SECUREBERT_MODEL: str = "ehsanaghaei/SecureBERT"

    # --- Privacy / retention (utils/privacy.py, history.py) ---------------------
    # Presidio masks PII in stored email bodies; headers are kept as evidence.
    PII_MASKING_ENABLED: bool = True
    PII_SPACY_MODEL: str = "en_core_web_sm"
    # Runs older than this are deleted by the periodic sweep; 0 keeps them forever.
    RETENTION_DAYS: int = 90
    RETENTION_SWEEP_HOURS: float = 6.0

    # memory/case_index.py — a growing similarity index over past investigations.
    CASE_MEMORY_DIR: str = "data/case_memory"
    CASE_MEMORY_TOP_K: int = 3
    # tools/correlation_graph.py — DBSCAN cosine-distance radius over mean-centered
    # case embeddings. Tuned on a handful of cases; raise it to merge more loosely.
    CAMPAIGN_DBSCAN_EPS: float = 0.65

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    """Return a cached singleton instance of application settings."""
    return Settings()
