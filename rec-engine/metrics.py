"""
metrics.py — RecSys Evaluation Metrics
======================================
Precision@K, Recall@K, NDCG@K, Coverage
All computed on 80/20 train-test split.
"""

import numpy as np
from typing import List, Dict, Set


def precision_at_k(recommended: List[str], relevant: Set[str], k: int = 5) -> float:
    """Fraction of top-k recommendations that are relevant."""
    if not recommended or not relevant:
        return 0.0
    top_k = recommended[:k]
    hits  = sum(1 for sid in top_k if sid in relevant)
    return hits / k


def recall_at_k(recommended: List[str], relevant: Set[str], k: int = 5) -> float:
    """Fraction of relevant items found in top-k recommendations."""
    if not recommended or not relevant:
        return 0.0
    top_k = recommended[:k]
    hits  = sum(1 for sid in top_k if sid in relevant)
    return hits / len(relevant)


def dcg_at_k(recommended: List[str], relevant: Set[str], k: int = 10) -> float:
    """Discounted Cumulative Gain at K."""
    dcg = 0.0
    for i, sid in enumerate(recommended[:k]):
        if sid in relevant:
            dcg += 1.0 / np.log2(i + 2)  # +2 because log2(1)=0
    return dcg


def ndcg_at_k(recommended: List[str], relevant: Set[str], k: int = 10) -> float:
    """Normalized DCG at K — accounts for ranking quality."""
    if not relevant:
        return 0.0
    ideal_hits = min(len(relevant), k)
    ideal_dcg  = sum(1.0 / np.log2(i + 2) for i in range(ideal_hits))
    if ideal_dcg == 0:
        return 0.0
    return dcg_at_k(recommended, relevant, k) / ideal_dcg


def coverage(all_recommendations: List[List[str]], skill_catalog: List[str]) -> float:
    """Fraction of skill catalog appearing in any recommendation."""
    if not skill_catalog:
        return 0.0
    recommended_set = set(sid for recs in all_recommendations for sid in recs)
    return len(recommended_set & set(skill_catalog)) / len(skill_catalog)


def evaluate(
    recommender,
    test_interactions: List[Dict],
    skill_catalog: List[str],
    k_precision: int = 5,
    k_ndcg: int = 10,
) -> Dict:
    """
    Compute all metrics on the test split.
    Returns dict with precision_at_5, recall_at_5, ndcg_at_10, coverage, user_count.
    """
    from collections import defaultdict

    # Group test interactions by user
    user_relevant: Dict[str, Set[str]] = defaultdict(set)
    for r in test_interactions:
        uid  = r["user_id"]
        sid  = r["skill_id"]
        score = float(r.get("engagement_score", 0))
        if score > 0.3:  # threshold: only count meaningful engagements as "relevant"
            user_relevant[uid].add(sid)

    if not user_relevant:
        return {
            "precision_at_5": 0.0,
            "recall_at_5"   : 0.0,
            "ndcg_at_10"    : 0.0,
            "coverage"      : 0.0,
            "user_count"    : 0,
        }

    precisions, recalls, ndcgs = [], [], []
    all_recs: List[List[str]] = []

    for uid, relevant in user_relevant.items():
        try:
            recs = recommender.recommend(uid, top_k=max(k_precision, k_ndcg))
            rec_ids = [r["skill_id"] for r in recs]

            precisions.append(precision_at_k(rec_ids, relevant, k_precision))
            recalls.append(recall_at_k(rec_ids, relevant, k_precision))
            ndcgs.append(ndcg_at_k(rec_ids, relevant, k_ndcg))
            all_recs.append(rec_ids)
        except Exception:
            pass

    return {
        "precision_at_5": round(float(np.mean(precisions)) if precisions else 0.0, 4),
        "recall_at_5"   : round(float(np.mean(recalls))    if recalls    else 0.0, 4),
        "ndcg_at_10"    : round(float(np.mean(ndcgs))      if ndcgs      else 0.0, 4),
        "coverage"      : round(coverage(all_recs, skill_catalog), 4),
        "user_count"    : len(user_relevant),
    }
