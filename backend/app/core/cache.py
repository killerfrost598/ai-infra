import redis as _redis


def get_redis_client() -> _redis.Redis:
    return _redis.from_url("redis://redis:6379/2", decode_responses=True, socket_connect_timeout=2)
