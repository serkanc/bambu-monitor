"""Backoff helper for service-level retries."""
from __future__ import annotations

from dataclasses import dataclass
import math
import random


@dataclass
class Backoff:
    base_delay: float = 5.0
    factor: float = 1.8
    max_delay: float = 60.0
    jitter: float = 0.1

    def __post_init__(self) -> None:
        self._attempt = 0
        # Calculate the maximum attempts before hitting max_delay
        self._max_attempts_for_max_delay = self._calculate_max_attempts_for_max_delay()
    
    def _calculate_max_attempts_for_max_delay(self) -> int:
        """Calculate how many attempts until delay reaches max_delay."""
        if self.factor <= 1.0 or self.base_delay >= self.max_delay:
            return 0
        
        # Solve: base_delay * (factor ^ n) >= max_delay
        # => factor ^ n >= max_delay / base_delay
        # => n >= log(max_delay / base_delay) / log(factor)
        try:
            n = math.log(self.max_delay / self.base_delay) / math.log(self.factor)
            return max(1, math.ceil(n))
        except (ValueError, ZeroDivisionError):
            # Fallback: safe upper bound
            return 50  # 1.8^50 is already astronomically large

    def reset(self) -> None:
        self._attempt = 0

    def next_delay(self) -> float:
        # Cap the effective attempt to prevent overflow
        if self._attempt >= self._max_attempts_for_max_delay:
            # We've already reached max_delay, just return it with jitter
            delay = self.max_delay
        else:
            try:
                # Safe calculation with bounded exponent
                delay = self.base_delay * (self.factor ** self._attempt)
            except OverflowError:
                # Extreme fallback: use max_delay if calculation overflows
                delay = self.max_delay
        
        self._attempt += 1
        
        # Ensure we don't exceed max_delay (safety check)
        delay = min(self.max_delay, delay)
        
        # Apply jitter if configured
        if self.jitter:
            offset = delay * self.jitter
            delay = delay + random.uniform(-offset, offset)
        
        # Ensure non-negative
        return max(0.0, delay)
