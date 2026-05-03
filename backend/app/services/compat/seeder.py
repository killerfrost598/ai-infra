import json
import uuid
from pathlib import Path

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models.entities import GpuProfile, ModelVariant, StackMatrix

_SEEDS_DIR = Path(__file__).parent.parent.parent / "seeds"


def load_seeds(db: Session) -> None:
    _seed_gpu_profiles(db)
    _seed_stack_matrix(db)
    _seed_model_variants(db)


def _seed_gpu_profiles(db: Session) -> None:
    path = _SEEDS_DIR / "gpu_profiles.json"
    if not path.exists():
        return
    rows = json.loads(path.read_text())
    for row in rows:
        stmt = pg_insert(GpuProfile).values(**row).on_conflict_do_update(
            index_elements=["model_key"],
            set_={k: v for k, v in row.items() if k != "model_key"},
        )
        db.execute(stmt)
    db.commit()


def _seed_stack_matrix(db: Session) -> None:
    path = _SEEDS_DIR / "stack_matrix.json"
    if not path.exists():
        return
    if db.query(StackMatrix).count() > 0:
        return
    rows = json.loads(path.read_text())
    for row in rows:
        db.add(StackMatrix(**row))
    db.commit()


def _seed_model_variants(db: Session) -> None:
    path = _SEEDS_DIR / "model_variants.json"
    if not path.exists():
        return
    rows = json.loads(path.read_text())
    for row in rows:
        existing = db.query(ModelVariant).filter_by(
            model_key=row["model_key"], quant=row["quant"]
        ).first()
        if existing:
            for k, v in row.items():
                if k not in ("model_key", "quant"):
                    setattr(existing, k, v)
        else:
            db.add(ModelVariant(id=uuid.uuid4(), **row))
    db.commit()
