"""
recommender.py — Hybrid Recommendation Engine
=============================================
Algorithm: SVD Collaborative Filtering + TF-IDF Content-Based Filtering

Weighting (adaptive):
  Cold-start (<3 interactions): 40% CF + 60% CB
  Active users (>=3):           70% CF + 30% CB
  + demand_boost from market demand score

All matrix operations use scipy / scikit-learn — no heavy ML frameworks.
"""

import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.linalg import svds
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from typing import List, Dict, Optional, Tuple
import logging

logger = logging.getLogger(__name__)


class HybridRecommender:
    def __init__(self, n_factors: int = 50):
        self.n_factors = n_factors

        # SVD components
        self.U: Optional[np.ndarray] = None       # users × factors
        self.sigma: Optional[np.ndarray] = None   # singular values
        self.Vt: Optional[np.ndarray] = None      # factors × skills
        self.predicted_ratings: Optional[np.ndarray] = None

        # Content-based components
        self.tfidf_matrix: Optional[np.ndarray] = None
        self.skill_similarity: Optional[np.ndarray] = None
        self.vectorizer = TfidfVectorizer(stop_words='english', max_features=500)

        # Index mappings
        self.user_index: Dict[str, int] = {}       # user_id → row index
        self.skill_index: Dict[str, int] = {}      # skill_id → col index
        self.index_to_skill: Dict[int, str] = {}   # col index → skill_id

        # Raw data
        self.interaction_matrix: Optional[np.ndarray] = None
        self.skill_metadata: Dict[str, Dict] = {}   # skill_id → {name, description, domain}
        self.market_demand: Dict[str, float] = {}   # skill_id → demand score 0-1

        self.is_trained = False

    # ── BUILD ──────────────────────────────────────────────────────────────────

    def fit(
        self,
        interactions: List[Dict],          # [{user_id, skill_id, engagement_score}]
        skills: List[Dict],                # [{id, name, description, domain}]
        market_demand: Dict[str, float],   # {skill_id: demand_score 0-1}
    ) -> None:
        """Train the hybrid model on interaction data."""
        if not interactions or not skills:
            logger.warning("[Recommender] Not enough data to train — using fallback")
            self._build_content_only(skills, market_demand)
            return

        # ── Build index mappings ───────────────────────────────────────────────
        user_ids  = sorted(set(r["user_id"]  for r in interactions))
        skill_ids = sorted(set(s["id"]       for s in skills))

        self.user_index    = {uid: i for i, uid in enumerate(user_ids)}
        self.skill_index   = {sid: j for j, sid in enumerate(skill_ids)}
        self.index_to_skill = {j: sid for sid, j in self.skill_index.items()}
        self.skill_metadata = {s["id"]: s for s in skills}
        self.market_demand  = market_demand

        n_users  = len(user_ids)
        n_skills = len(skill_ids)

        # ── Build interaction matrix ───────────────────────────────────────────
        mat = np.zeros((n_users, n_skills), dtype=np.float32)
        for r in interactions:
            ui = self.user_index.get(r["user_id"])
            si = self.skill_index.get(r["skill_id"])
            if ui is not None and si is not None:
                score = float(r.get("engagement_score", 0.5))
                mat[ui, si] = max(mat[ui, si], score)  # keep highest engagement

        self.interaction_matrix = mat

        # ── SVD collaborative filtering ────────────────────────────────────────
        try:
            k = min(self.n_factors, min(n_users, n_skills) - 1, 50)
            if k >= 1:
                sparse_mat = csr_matrix(mat)
                self.U, self.sigma, self.Vt = svds(sparse_mat, k=k)
                self.predicted_ratings = np.dot(
                    np.dot(self.U, np.diag(self.sigma)), self.Vt
                )
                # Clip to [0, 1]
                self.predicted_ratings = np.clip(self.predicted_ratings, 0, 1)
                logger.info(f"[Recommender] SVD trained — {n_users} users, {n_skills} skills, k={k}")
            else:
                logger.warning("[Recommender] Matrix too small for SVD — using content-only")
        except Exception as e:
            logger.error(f"[Recommender] SVD failed: {e}")
            self.predicted_ratings = mat  # fall back to raw scores

        # ── Content-based: TF-IDF on skill descriptions ───────────────────────
        self._build_tfidf(skills)

        self.is_trained = True
        logger.info("[Recommender] Training complete")

    def _build_tfidf(self, skills: List[Dict]) -> None:
        """Build TF-IDF skill similarity matrix."""
        try:
            skill_ids_ordered = [s["id"] for s in skills if s["id"] in self.skill_index]
            docs = []
            for sid in skill_ids_ordered:
                meta = self.skill_metadata.get(sid, {})
                text = f"{meta.get('name','')} {meta.get('description','')} {meta.get('domain','')}"
                docs.append(text.strip() or "general skill")

            if len(docs) >= 2:
                tfidf = self.vectorizer.fit_transform(docs)
                self.tfidf_matrix = tfidf.toarray()
                self.skill_similarity = cosine_similarity(self.tfidf_matrix)
                logger.info(f"[Recommender] TF-IDF built — {len(docs)} skills")
        except Exception as e:
            logger.error(f"[Recommender] TF-IDF failed: {e}")

    def _build_content_only(self, skills: List[Dict], market_demand: Dict[str, float]) -> None:
        """Minimal setup when interaction data is insufficient."""
        self.skill_metadata = {s["id"]: s for s in skills}
        self.market_demand = market_demand
        self.skill_index = {s["id"]: i for i, s in enumerate(skills)}
        self.index_to_skill = {i: s["id"] for i, s in enumerate(skills)}
        self._build_tfidf(skills)
        self.is_trained = True

    # ── RECOMMEND ──────────────────────────────────────────────────────────────

    def recommend(
        self,
        user_id: str,
        top_k: int = 5,
        exclude_ids: Optional[List[str]] = None,
    ) -> List[Dict]:
        """
        Return top-k recommended skills for a user.
        Each item: {skill_id, skill_name, score, reason, domain}
        """
        exclude = set(exclude_ids or [])

        if not self.is_trained:
            return self._popularity_fallback(top_k, exclude)

        # Determine if user is in training set
        user_row = self.user_index.get(user_id)
        n_interactions = 0
        if user_row is not None and self.interaction_matrix is not None:
            n_interactions = int(np.sum(self.interaction_matrix[user_row] > 0))

        # Already interacted skills — filter from recommendations
        seen_skills: set = set()
        if user_row is not None and self.interaction_matrix is not None:
            seen_idx = np.where(self.interaction_matrix[user_row] > 0)[0]
            seen_skills = {self.index_to_skill[i] for i in seen_idx if i in self.index_to_skill}

        # Choose weighting based on interaction count
        if n_interactions >= 3:
            cf_weight, cb_weight = 0.70, 0.30
        else:
            cf_weight, cb_weight = 0.40, 0.60

        # CF scores
        cf_scores = self._cf_scores(user_row, n_interactions)

        # CB scores (based on what user has already engaged with)
        cb_scores = self._cb_scores(user_row, seen_skills)

        # Combine
        all_skills = list(self.skill_index.keys())
        results = []
        for sid in all_skills:
            if sid in seen_skills or sid in exclude:
                continue
            j = self.skill_index[sid]
            cf  = float(cf_scores.get(j, 0))
            cb  = float(cb_scores.get(j, 0))
            dem = float(self.market_demand.get(sid, 0.5))

            hybrid = cf_weight * cf + cb_weight * cb + 0.1 * dem
            hybrid = round(min(hybrid, 1.0), 4)

            meta   = self.skill_metadata.get(sid, {})
            reason = self._derive_reason(sid, cb_scores, seen_skills, n_interactions)

            results.append({
                "skill_id"  : sid,
                "skill_name": meta.get("name", sid),
                "domain"    : meta.get("domain", ""),
                "score"     : hybrid,
                "match_pct" : round(hybrid * 100),
                "reason"    : reason,
            })

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:top_k]

    # ── SCORE HELPERS ─────────────────────────────────────────────────────────

    def _cf_scores(self, user_row: Optional[int], n_interactions: int) -> Dict[int, float]:
        """Collaborative filtering scores for all skills."""
        if self.predicted_ratings is None or user_row is None or n_interactions == 0:
            # Popularity-based fallback: mean engagement per skill
            if self.interaction_matrix is not None:
                means = self.interaction_matrix.mean(axis=0)
                return {j: float(means[j]) for j in range(len(means))}
            return {}
        row = self.predicted_ratings[user_row]
        return {j: float(row[j]) for j in range(len(row))}

    def _cb_scores(self, user_row: Optional[int], seen_skills: set) -> Dict[int, float]:
        """Content-based scores using TF-IDF similarity to seen skills."""
        if self.skill_similarity is None or not seen_skills:
            # No history or no TF-IDF — return uniform 0.5
            return {j: 0.5 for j in range(len(self.skill_index))}

        scores = np.zeros(len(self.skill_index))
        count  = 0
        for sid in seen_skills:
            j = self.skill_index.get(sid)
            if j is not None and j < self.skill_similarity.shape[0]:
                scores += self.skill_similarity[j]
                count  += 1

        if count > 0:
            scores /= count

        # Normalise to [0, 1]
        mx = scores.max()
        if mx > 0:
            scores /= mx

        return {j: float(scores[j]) for j in range(len(scores))}

    def _popularity_fallback(self, top_k: int, exclude: set) -> List[Dict]:
        """Return top skills by market demand when no training data exists."""
        items = [
            (sid, self.skill_metadata.get(sid, {}), float(self.market_demand.get(sid, 0.5)))
            for sid in self.skill_index
            if sid not in exclude
        ]
        items.sort(key=lambda x: x[2], reverse=True)
        return [
            {
                "skill_id"  : sid,
                "skill_name": meta.get("name", sid),
                "domain"    : meta.get("domain", ""),
                "score"     : round(dem, 4),
                "match_pct" : round(dem * 100),
                "reason"    : "Trending in your industry",
            }
            for sid, meta, dem in items[:top_k]
        ]

    def _derive_reason(
        self,
        target_skill_id: str,
        cb_scores: Dict[int, float],
        seen_skills: set,
        n_interactions: int,
    ) -> str:
        """Derive a human-readable reason from skill similarity — no LLM."""
        if n_interactions == 0:
            dem = self.market_demand.get(target_skill_id, 0)
            if dem > 0.8:
                return "High market demand in your field"
            return "Popular starting point for your goal"

        # Find the most-similar seen skill
        target_j = self.skill_index.get(target_skill_id)
        if target_j is None or self.skill_similarity is None:
            return "Complements your current learning path"

        best_sim, best_sid = 0.0, None
        for sid in seen_skills:
            j = self.skill_index.get(sid)
            if j is not None and j < self.skill_similarity.shape[0]:
                sim = float(self.skill_similarity[j][target_j])
                if sim > best_sim:
                    best_sim, best_sid = sim, sid

        if best_sid:
            source_name = self.skill_metadata.get(best_sid, {}).get("name", best_sid)
            return f"Similar to your progress in {source_name}"

        return "Recommended based on your learning history"

    # ── TRAIN / TEST SPLIT for metrics ────────────────────────────────────────

    def train_test_split(
        self, interactions: List[Dict], test_ratio: float = 0.2
    ) -> Tuple[List[Dict], List[Dict]]:
        """80/20 split by user — later interactions go to test set."""
        from collections import defaultdict
        user_interactions: Dict[str, List] = defaultdict(list)
        for r in interactions:
            user_interactions[r["user_id"]].append(r)

        train, test = [], []
        for uid, records in user_interactions.items():
            records_sorted = sorted(records, key=lambda x: x.get("created_at", ""))
            split_idx = max(1, int(len(records_sorted) * (1 - test_ratio)))
            train.extend(records_sorted[:split_idx])
            test.extend(records_sorted[split_idx:])

        return train, test
