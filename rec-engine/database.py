"""
database.py — Supabase data access for the recommendation engine
"""

import os
import logging
from typing import List, Dict, Optional
import httpx

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")


def _headers() -> Dict[str, str]:
    return {
        "apikey"       : SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type" : "application/json",
        "Prefer"       : "return=representation",
    }


async def fetch_interactions(limit: int = 50000) -> List[Dict]:
    """Pull user_skill_interactions from Supabase."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        logger.warning("[DB] No Supabase credentials — using empty interactions")
        return []
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            url = f"{SUPABASE_URL}/rest/v1/user_skill_interactions"
            params = {
                "select": "user_id,skill_id,engagement_score,interaction_type,created_at",
                "limit" : str(limit),
                "order" : "created_at.desc",
            }
            r = await client.get(url, headers=_headers(), params=params)
            if r.status_code == 200:
                return r.json() or []
            logger.warning(f"[DB] interactions fetch {r.status_code}: {r.text[:200]}")
            return []
    except Exception as e:
        logger.error(f"[DB] fetch_interactions error: {e}")
        return []


async def fetch_skills() -> List[Dict]:
    """Pull skill catalog from Supabase (from existing modules/DataStore tables)."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return _synthetic_skills()
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            # Try rec_skills table first (new), fall back to modules
            url = f"{SUPABASE_URL}/rest/v1/rec_skills"
            params = {"select": "id,name,description,domain", "limit": "500"}
            r = await client.get(url, headers=_headers(), params=params)
            if r.status_code == 200 and r.json():
                return r.json()

            # Fall back: pull from generic data store
            url2 = f"{SUPABASE_URL}/rest/v1/modules"
            params2 = {"select": "id,data", "limit": "500"}
            r2 = await client.get(url2, headers=_headers(), params=params2)
            if r2.status_code == 200 and r2.json():
                skills = []
                for row in r2.json():
                    d = row.get("data") or {}
                    skills.append({
                        "id"         : row["id"],
                        "name"       : d.get("title", row["id"]),
                        "description": d.get("description", ""),
                        "domain"     : d.get("domain", "general"),
                    })
                return skills or _synthetic_skills()
            return _synthetic_skills()
    except Exception as e:
        logger.error(f"[DB] fetch_skills error: {e}")
        return _synthetic_skills()


async def fetch_market_demand() -> Dict[str, float]:
    """Return market demand scores per skill (0-1). Reads from DB; no LLM call."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return {}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            url = f"{SUPABASE_URL}/rest/v1/rec_market_demand"
            params = {"select": "skill_id,demand_score"}
            r = await client.get(url, headers=_headers(), params=params)
            if r.status_code == 200 and r.json():
                return {row["skill_id"]: float(row["demand_score"]) for row in r.json()}
            return {}
    except Exception:
        return {}


async def save_metrics(metrics: Dict) -> None:
    """Insert a metrics snapshot into rec_metrics table."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            url = f"{SUPABASE_URL}/rest/v1/rec_metrics"
            payload = {
                "precision_at_5": metrics.get("precision_at_5", 0),
                "recall_at_5"   : metrics.get("recall_at_5", 0),
                "ndcg_at_10"    : metrics.get("ndcg_at_10", 0),
                "coverage"      : metrics.get("coverage", 0),
                "total_users"   : metrics.get("user_count", 0),
                "total_skills"  : metrics.get("total_skills", 0),
            }
            await client.post(url, headers=_headers(), json=payload)
    except Exception as e:
        logger.error(f"[DB] save_metrics error: {e}")


async def get_latest_metrics() -> Optional[Dict]:
    """Fetch the most recent metrics row."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return None
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            url = f"{SUPABASE_URL}/rest/v1/rec_metrics"
            params = {"select": "*", "order": "calculated_at.desc", "limit": "1"}
            r = await client.get(url, headers=_headers(), params=params)
            if r.status_code == 200 and r.json():
                return r.json()[0]
            return None
    except Exception:
        return None


async def get_exclusions(user_id: str) -> List[str]:
    """Skills the user marked as Not Interested."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return []
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            url = f"{SUPABASE_URL}/rest/v1/rec_exclusions"
            params = {
                "select"  : "skill_id",
                "user_id" : f"eq.{user_id}",
            }
            r = await client.get(url, headers=_headers(), params=params)
            if r.status_code == 200:
                return [row["skill_id"] for row in (r.json() or [])]
            return []
    except Exception:
        return []


async def log_recommendation(user_id: str, skill_ids: List[str]) -> None:
    """Write to recommendations_log table."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            url = f"{SUPABASE_URL}/rest/v1/recommendations_log"
            payload = {
                "user_id"           : user_id,
                "recommended_skills": skill_ids,
                "clicked_skills"    : [],
            }
            await client.post(url, headers=_headers(), json=payload)
    except Exception:
        pass


async def upsert_interaction(
    user_id: str, skill_id: str, engagement_score: float, interaction_type: str = "view"
) -> None:
    """Write or update a user-skill interaction."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            url = f"{SUPABASE_URL}/rest/v1/user_skill_interactions"
            payload = {
                "user_id"         : user_id,
                "skill_id"        : skill_id,
                "engagement_score": engagement_score,
                "interaction_type": interaction_type,
            }
            await client.post(url, headers={**_headers(), "Prefer": "resolution=merge-duplicates"}, json=payload)
    except Exception:
        pass


def _synthetic_skills() -> List[Dict]:
    """Fallback skill catalog when DB is unavailable."""
    return [
        {"id": "react",           "name": "React",             "description": "Frontend UI library components hooks state", "domain": "frontend"},
        {"id": "node_js",         "name": "Node.js",           "description": "Server-side JavaScript runtime express API", "domain": "backend"},
        {"id": "python",          "name": "Python",            "description": "Programming language data science automation scripting", "domain": "programming"},
        {"id": "machine_learning","name": "Machine Learning",  "description": "ML algorithms models training neural networks", "domain": "ai"},
        {"id": "sql",             "name": "SQL",               "description": "Database queries joins aggregation PostgreSQL", "domain": "data"},
        {"id": "typescript",      "name": "TypeScript",        "description": "Typed JavaScript frontend backend safety", "domain": "programming"},
        {"id": "docker",          "name": "Docker",            "description": "Containers deployment devops infrastructure", "domain": "devops"},
        {"id": "system_design",   "name": "System Design",     "description": "Architecture scalability distributed systems design patterns", "domain": "engineering"},
        {"id": "data_structures", "name": "Data Structures",   "description": "Arrays trees graphs algorithms complexity", "domain": "cs_fundamentals"},
        {"id": "deep_learning",   "name": "Deep Learning",     "description": "Neural networks CNN RNN transformers PyTorch", "domain": "ai"},
        {"id": "aws",             "name": "AWS Cloud",         "description": "Cloud services S3 EC2 Lambda deployment infrastructure", "domain": "devops"},
        {"id": "git",             "name": "Git & GitHub",      "description": "Version control collaboration branching merging", "domain": "tools"},
        {"id": "agile",           "name": "Agile & Scrum",     "description": "Project management sprints planning retrospectives", "domain": "management"},
        {"id": "communication",   "name": "Communication",     "description": "Presentation writing public speaking soft skills", "domain": "soft_skills"},
        {"id": "statistics",      "name": "Statistics",        "description": "Probability distributions hypothesis testing regression", "domain": "data"},
    ]
