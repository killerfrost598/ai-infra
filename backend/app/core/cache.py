import redis as _redis

from app.core.config import settings


def get_redis_client() -> _redis.Redis:
    return _redis.from_url(settings.redis_cache_url, decode_responses=True, socket_connect_timeout=2)
