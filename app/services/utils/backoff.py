"""Backoff helper for service-level retries."""
from __future__ import annotations

from dataclasses import dataclass
import random


@dataclass
class Backoff:
	base_delay: float = 5.0
	factor: float = 1.8
	max_delay: float = 60.0
	jitter: float = 0.1

	def __post_init__(self) -> None:
		self._attempt = 0

	def reset(self) -> None:
		self._attempt = 0

	def next_delay(self) -> float:
		delay = self.base_delay * (self.factor ** self._attempt)
		self._attempt += 1
		delay = min(self.max_delay, delay)
		if self.jitter:
			offset = delay * self.jitter
			delay = delay + random.uniform(-offset, offset)
		return max(0.0, delay)

