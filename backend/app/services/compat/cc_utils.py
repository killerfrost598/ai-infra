"""Shared compute-capability helpers used across compat modules."""


def cc_gte(cc_a: str, cc_b: str) -> bool:
    """Return True if cc_a >= cc_b (e.g. '8.9' >= '8.0')."""
    try:
        return tuple(int(x) for x in cc_a.split(".")) >= tuple(int(x) for x in cc_b.split("."))
    except (ValueError, AttributeError):
        return False
