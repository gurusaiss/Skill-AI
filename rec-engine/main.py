"""
main.py — SkillForge AI Recommendation Engine
==============================================
FastAPI microservice exposing:
  POST /recommend   → ranked skill list for a user
  GET  /metrics     → Precision@5, NDCG@10, Coverage
  GET  /health      → service status
  POST /interaction → log a user-skill interaction
  POST /exclude     → mark a skill as "Not Interested"

Runs independently from Node.js backend.
Node.js calls this via internal HTTP; it is NOT exposed publicly.
"""

import os
import asyncio
import logging
from datetime import datetime, timezone
from typing import List, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel
from dotenv import load_dotenv
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from recommender import HybridRecommender
from metrics import evaluate
from database import (
    fetch_interactions, fetch_skills, fetch_market_demand,
    save_metrics, get_latest_metrics, get_exclusions,
    log_recommendation, upsert_interaction, add_exclusion,
)

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Global state ───────────────────────────────────────────────────────────────
recommender     = HybridRecommender(n_factors=50)
latest_metrics  = {}
last_trained_at = None
skill_catalog   = []


# ── Startup / Shutdown ─────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("[RecEngine] Starting — training initial model...")
    await retrain_model()

    # Schedule daily retraining + metrics recalculation at 02:00
    scheduler = AsyncIOScheduler()
    scheduler.add_job(retrain_model, "cron", hour=2, minute=0, id="daily_retrain")
    scheduler.start()
    logger.info("[RecEngine] Scheduler started — daily retrain at 02:00")

    yield

    scheduler.shutdown()
    logger.info("[RecEngine] Shutdown")


app = FastAPI(
    title="SkillForge AI — Recommendation Engine",
    description="Hybrid SVD + TF-IDF skill recommendation microservice",
    version="1.0.0",
    lifespan=lifespan,
)


# ── Models ─────────────────────────────────────────────────────────────────────
class RecommendRequest(BaseModel):
    user_id: str
    top_k: int = 5


class InteractionRequest(BaseModel):
    user_id: str
    skill_id: str
    engagement_score: float  # 0.0 – 1.0
    interaction_type: str = "view"  # view | complete | score


class ExcludeRequest(BaseModel):
    user_id: str
    skill_id: str


# ── Core: train / retrain ──────────────────────────────────────────────────────
async def retrain_model():
    global latest_metrics, last_trained_at, skill_catalog
    logger.info("[RecEngine] Retraining model...")

    try:
        interactions  = await fetch_interactions()
        skills        = await fetch_skills()
        market_demand = await fetch_market_demand()

        skill_catalog = [s["id"] for s in skills]

        if len(interactions) < 5:
            logger.warning(f"[RecEngine] Only {len(interactions)} interactions — using synthetic seed")
            interactions = _synthetic_interactions(skills)

        # 80/20 split for evaluation
        train_data, test_data = recommender.train_test_split(interactions, test_ratio=0.2)

        # Train on 80%
        recommender.fit(train_data, skills, market_demand)

        # Evaluate on 20%
        m = evaluate(recommender, test_data, skill_catalog)
        m["total_skills"]  = len(skill_catalog)
        m["calculated_at"] = datetime.now(timezone.utc).isoformat()

        latest_metrics  = m
        last_trained_at = datetime.now(timezone.utc).isoformat()

        # Persist to Supabase
        await save_metrics(m)

        logger.info(
            f"[RecEngine] Model trained — "
            f"P@5={m['precision_at_5']:.3f} "
            f"NDCG@10={m['ndcg_at_10']:.3f} "
            f"Coverage={m['coverage']:.3f}"
        )
    except Exception as e:
        logger.error(f"[RecEngine] Retrain failed: {e}")


# ── Routes ─────────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {
        "status"        : "ok",
        "trained"       : recommender.is_trained,
        "last_trained"  : last_trained_at,
        "skill_count"   : len(skill_catalog),
        "user_count"    : len(recommender.user_index),
    }


@app.post("/recommend")
async def recommend(req: RecommendRequest, background_tasks: BackgroundTasks):
    """
    Returns top-k recommended skills for a user.
    Results are computed in-process — caller (Node.js) caches for 6h.
    """
    if not recommender.is_trained:
        raise HTTPException(status_code=503, detail="Model not yet trained")

    top_k  = max(1, min(req.top_k, 20))
    exclude = await get_exclusions(req.user_id)

    recs = recommender.recommend(req.user_id, top_k=top_k, exclude_ids=exclude)

    # Log in background — non-blocking
    background_tasks.add_task(
        log_recommendation,
        req.user_id,
        [r["skill_id"] for r in recs],
    )

    return {
        "user_id"        : req.user_id,
        "recommendations": recs,
        "generated_at"   : datetime.now(timezone.utc).isoformat(),
        "model_version"  : last_trained_at,
    }


@app.get("/metrics")
async def metrics():
    """Latest Precision@5, Recall@5, NDCG@10, Coverage."""
    if latest_metrics:
        return latest_metrics

    # Try DB if in-memory cache is empty (e.g. cold restart)
    db_metrics = await get_latest_metrics()
    if db_metrics:
        return db_metrics

    return {
        "precision_at_5": 0.0,
        "recall_at_5"   : 0.0,
        "ndcg_at_10"    : 0.0,
        "coverage"      : 0.0,
        "user_count"    : 0,
        "total_skills"  : len(skill_catalog),
        "note"          : "Metrics not yet calculated",
    }


@app.post("/interaction")
async def log_interaction(req: InteractionRequest):
    """Log a user-skill interaction and trigger background incremental update."""
    score = max(0.0, min(1.0, req.engagement_score))
    await upsert_interaction(req.user_id, req.skill_id, score, req.interaction_type)
    return {"success": True}


@app.post("/exclude")
async def exclude_skill(req: ExcludeRequest):
    """Mark a skill as Not Interested for a user."""
    await add_exclusion(req.user_id, req.skill_id)
    return {"success": True}


@app.post("/retrain")
async def trigger_retrain(background_tasks: BackgroundTasks):
    """Manually trigger a model retrain (admin use)."""
    background_tasks.add_task(retrain_model)
    return {"message": "Retraining started in background"}


# ── Synthetic seed data ────────────────────────────────────────────────────────
def _synthetic_interactions(skills: List) -> List:
    """
    Generate synthetic interaction data to bootstrap the model
    when real interaction data is insufficient.
    """
    import random
    rng = random.Random(42)  # isolated RNG — doesn't affect global random state
    skill_ids = [s["id"] for s in skills]
    interactions = []
    for user_num in range(30):
        uid = f"synthetic_user_{user_num}"
        n_engaged = rng.randint(2, min(8, len(skill_ids)))
        engaged   = rng.sample(skill_ids, n_engaged)
        for sid in engaged:
            interactions.append({
                "user_id"         : uid,
                "skill_id"        : sid,
                "engagement_score": round(rng.uniform(0.4, 1.0), 2),
                "interaction_type": rng.choice(["complete", "score", "view"]),
                "created_at"      : "2026-01-01T00:00:00Z",
            })
    return interactions
