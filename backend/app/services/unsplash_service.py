"""Unsplash图片服务"""

import asyncio
import random
import time
from typing import Dict, List, Optional, Tuple

import httpx

from ..config import get_settings

class UnsplashService:
    """Unsplash图片服务类"""

    def __init__(self):
        """初始化服务"""
        settings = get_settings()
        self.access_key = settings.unsplash_access_key
        self.base_url = "https://api.unsplash.com"
        self.timeout = 10.0
        self.cache_ttl_seconds = 900.0
        self._search_cache: Dict[Tuple[str, int], Tuple[float, List[dict]]] = {}
        self._request_semaphore = asyncio.Semaphore(5)
        self._cache_lock = asyncio.Lock()
        self._client = httpx.AsyncClient(timeout=self.timeout)

    async def _get_cached_search(self, cache_key: Tuple[str, int]) -> Optional[List[dict]]:
        async with self._cache_lock:
            cached = self._search_cache.get(cache_key)
            if not cached:
                return None

            expires_at, data = cached
            if expires_at <= time.monotonic():
                self._search_cache.pop(cache_key, None)
                return None

            return [dict(photo) for photo in data]

    async def _set_cached_search(self, cache_key: Tuple[str, int], photos: List[dict]) -> None:
        async with self._cache_lock:
            self._search_cache[cache_key] = (
                time.monotonic() + self.cache_ttl_seconds,
                [dict(photo) for photo in photos],
            )

    async def search_photos(self, query: str, per_page: int = 5) -> List[dict]:
        """
        搜索图片

        Args:
            query: 搜索关键词
            per_page: 每页数量

        Returns:
            图片列表
        """
        normalized_query = query.strip()
        if not normalized_query or not self.access_key:
            return []

        cache_key = (normalized_query.lower(), per_page)
        cached = await self._get_cached_search(cache_key)
        if cached is not None:
            return cached

        try:
            url = f"{self.base_url}/search/photos"
            params = {
                "query": normalized_query,
                "per_page": per_page,
                "client_id": self.access_key
            }

            async with self._request_semaphore:
                response = await self._client.get(url, params=params)
                response.raise_for_status()
                data = response.json()

            results = data.get("results", [])

            # 提取图片URL
            photos = []
            for photo in results:
                photos.append({
                    "id": photo.get("id"),
                    "url": photo.get("urls", {}).get("regular"),
                    "thumb": photo.get("urls", {}).get("thumb"),
                    "description": photo.get("description") or photo.get("alt_description"),
                    "photographer": photo.get("user", {}).get("name")
                })

            await self._set_cached_search(cache_key, photos)
            return photos

        except Exception as e:
            print(f"❌ Unsplash搜索失败: {str(e)}")
            return []

    async def get_photo_url(self, query: str, randomize: bool = False) -> Optional[str]:
        """
        获取单张图片URL

        Args:
            query: 搜索关键词
            randomize: 是否从前10条结果中随机挑选

        Returns:
            图片URL
        """
        photos = await self.search_photos(query, per_page=10 if randomize else 1)
        if photos:
            if randomize:
                return random.choice(photos).get("url")
            return photos[0].get("url")
        return None

    async def close(self) -> None:
        """关闭底层HTTP客户端"""
        await self._client.aclose()


# 全局服务实例
_unsplash_service = None


def get_unsplash_service() -> UnsplashService:
    """获取Unsplash服务实例(单例模式)"""
    global _unsplash_service
    
    if _unsplash_service is None:
        _unsplash_service = UnsplashService()
    
    return _unsplash_service


async def close_unsplash_service() -> None:
    """关闭Unsplash服务实例"""
    global _unsplash_service

    if _unsplash_service is not None:
        await _unsplash_service.close()
        _unsplash_service = None
