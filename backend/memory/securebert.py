"""
SecureBERT sentence embedding for the case-memory index (memory/case_index.py).

Mean-pools the last hidden states of ehsanaghaei/SecureBERT (a RoBERTa
model pretrained on cybersecurity text) into one raw, un-normalized
768-d vector per text. Requires `transformers` + `torch` (torch is a
manual install — see backend/requirements.txt); the ~500MB model
downloads once on first use.
"""
from __future__ import annotations

from functools import lru_cache
from typing import List

import numpy as np

from config import get_settings
from logger import get_logger

logger = get_logger(__name__)


@lru_cache(maxsize=1)
def _load_model():
    from transformers import AutoModel, AutoTokenizer

    model_name = get_settings().SECUREBERT_MODEL
    logger.info("Loading SecureBERT (%s) — first run downloads ~500MB, then cached", model_name)
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModel.from_pretrained(model_name)
    model.eval()
    return tokenizer, model


def embed_texts(texts: List[str], batch_size: int = 16) -> np.ndarray:
    """(N, 768) float32 array of raw mean-pooled embeddings."""
    import torch

    tokenizer, model = _load_model()
    vectors: List[np.ndarray] = []
    with torch.no_grad():
        for start in range(0, len(texts), batch_size):
            batch = texts[start : start + batch_size]
            encoded = tokenizer(batch, padding=True, truncation=True, max_length=256, return_tensors="pt")
            last_hidden = model(**encoded).last_hidden_state
            mask = encoded["attention_mask"].unsqueeze(-1).float()  # mask out padding tokens
            mean_pooled = (last_hidden * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1e-9)
            vectors.append(mean_pooled.cpu().numpy().astype("float32"))
    return np.vstack(vectors) if vectors else np.zeros((0, 768), dtype="float32")


def embed_text(text: str) -> np.ndarray:
    return embed_texts([text])[0]
