# 30-Day Rolling Window for Reward Calculations

## Implementation Date: 2026-01-27

## Overview

The reward system now uses a **30-day rolling window** for performance pool calculations, aligning with the block assignment system. This prevents the "rich get richer forever" problem where early contributors build insurmountable advantages.

## Problem Statement

### Before: All-Time Points

**Issue**: Using all-time points created a permanent incumbency barrier.

```typescript
// OLD: All-time points
const rewardPoints = calculateRewardPoints(contributor);
```

**Example of the problem**:
```
Month 1:
  Alice (early): 10,000 total points → sqrt(10,000) = 100 weight
  Bob (new): 1,000 total points → sqrt(1,000) = 31.6 weight
  Bob share: 31.6/(100+31.6) = 24%

Month 6 (Bob performs identically to Alice each month):
  Alice: 60,000 total points → sqrt(60,000) = 245 weight
  Bob: 6,000 total points → sqrt(6,000) = 77.5 weight
  Bob share: 77.5/(245+77.5) = 24%  ← STILL 24%!

Bob can NEVER catch up, even with identical performance!
```

### Root Cause

- All-time accumulation means early contributors have permanent advantages
- New contributors competing against accumulated history, not current performance
- Inactive contributors continue earning based on historical work
- No mechanism for performance-based catch-up

## Solution: 30-Day Rolling Window

### Implementation

```typescript
// NEW: 30-day rolling window
const rewardPoints = calculateRewardPoints(
  contributor,
  config.performanceLookbackDays,  // Default: 30
  currentTime
);
```

### Key Changes

#### 1. Updated `calculateRewardPoints()` Function

**Location**: [src/computePoints.ts:72-93](src/computePoints.ts#L72-L93)

```typescript
export function calculateRewardPoints(
  contributor: Contributor,
  lookbackDays?: number,
  currentTime: Date = new Date()
): number {
  let blocksToConsider = contributor.completedBlocks;

  // If lookback window is specified, filter by timestamp
  if (lookbackDays !== undefined) {
    const cutoffTime = new Date(currentTime.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
    blocksToConsider = blocksToConsider.filter(
      block => block.timestamp >= cutoffTime && block.timestamp <= currentTime
    );
  }

  // Exclude all canaries and calculate points
  return blocksToConsider
    .filter(block => !block.isCanary)
    .reduce((total, block) => {
      return total + calculateBlockPoints(block);
    }, 0);
}
```

**Features**:
- `lookbackDays` parameter: Optional time window (undefined = all-time for backward compatibility)
- `currentTime` parameter: For deterministic testing
- Filters blocks by timestamp within the window
- Still excludes canary blocks (validation/test blocks)

#### 2. Updated `calculatePerformanceWeight()` Function

**Location**: [src/rewardDistribution.ts:162-173](src/rewardDistribution.ts#L162-L173)

```typescript
export function calculatePerformanceWeight(
  contributor: Contributor,
  config: RewardConfig,
  currentTime: Date = new Date()
): number {
  const rewardPoints = calculateRewardPoints(
    contributor,
    config.performanceLookbackDays,  // Use configured window
    currentTime
  );
  return Math.sqrt(rewardPoints);
}
```

**Changes**:
- Now accepts `config` and `currentTime` parameters
- Uses `config.performanceLookbackDays` (default: 30)
- Aligns with block assignment's 30-day window

#### 3. Added `performanceLookbackDays` to RewardConfig

**Location**: [src/types.ts:63](src/types.ts#L63)

```typescript
export interface RewardConfig {
  // ... other fields
  performanceLookbackDays: number; // Days to look back for performance pool calculation
}

export const DEFAULT_REWARD_CONFIG: RewardConfig = {
  // ... other fields
  performanceLookbackDays: 30, // 30-day rolling window
};
```

#### 4. Updated `distributePerformancePool()` Function

**Location**: [src/rewardDistribution.ts:194-235](src/rewardDistribution.ts#L194-L235)

```typescript
export function distributePerformancePool(
  activeContributors: Contributor[],
  performancePoolAmount: number,
  config: RewardConfig,
  currentTime: Date = new Date()
): Map<string, number> {
  // ... calculates weights using 30-day window
  const weight = calculatePerformanceWeight(contributor, config, currentTime);
}
```

## Benefits

### 1. Fair Competition

New contributors compete based on **recent performance**, not against accumulated history.

```
Month 1:
  Alice: 10,000 points (last 30 days) → sqrt(10,000) = 100 weight
  Bob (new): 1,000 points (last 30 days) → sqrt(1,000) = 31.6 weight
  Bob share: 24%

Month 6 (both perform identically in last 30 days):
  Alice: 10,000 points (last 30 days) → sqrt(10,000) = 100 weight
  Bob: 10,000 points (last 30 days) → sqrt(10,000) = 100 weight
  Bob share: 50%  ← Equal rewards for equal recent work!
```

### 2. Alignment with Block Assignment

Both systems now use the same time window:

| System | Time Window | Formula |
|--------|-------------|---------|
| Block Assignment | 30 days | `sqrt(30_day_points) × reputation` |
| Performance Pool | 30 days | `sqrt(30_day_points)` |

### 3. Natural Phase-Out of Inactive Contributors

Contributors who stop working naturally lose their weight over 30 days.

```
Alice stops contributing after Month 3:

Month 3: 10,000 points (last 30 days) → 100 weight
Month 4: 0 points (last 30 days) → 0 weight

Alice's rewards stop immediately when she stops working.
Active contributors get her share.
```

### 4. Encourages Consistent Contribution

Contributors are incentivized to maintain consistent performance, not just build up historical points.

## Backward Compatibility

### Optional `lookbackDays` Parameter

The `calculateRewardPoints()` function maintains backward compatibility:

```typescript
// All-time (backward compatible, pass undefined)
const allTimePoints = calculateRewardPoints(contributor, undefined, currentTime);

// 30-day window (recommended)
const recentPoints = calculateRewardPoints(contributor, 30, currentTime);

// Custom window (e.g., 7 days)
const weeklyPoints = calculateRewardPoints(contributor, 7, currentTime);
```

### Default Behavior

- `DEFAULT_REWARD_CONFIG` sets `performanceLookbackDays: 30`
- All new code uses 30-day window by default
- Existing tests updated to pass required parameters

## Testing

### Test Coverage

All 181 tests passing, including:

1. **Unit tests** for `calculateRewardPoints()` with time windows
2. **Unit tests** for `calculatePerformanceWeight()` with config
3. **Unit tests** for `distributePerformancePool()` with time filtering
4. **Integration tests** for complete reward distribution
5. **Edge cases**: Empty blocks, all canaries, zero points, 100+ contributors

### Test Example: 30-Day Window Filtering

```typescript
it('should only count blocks within 30-day window', () => {
  const now = new Date('2024-02-01T00:00:00Z');
  const contributor: Contributor = {
    accountId: 'alice',
    completedBlocks: [
      // 35 days ago (outside window)
      { timestamp: new Date('2023-12-28'), /* ... */ },
      // 25 days ago (inside window)
      { timestamp: new Date('2024-01-07'), /* ... */ },
      // 10 days ago (inside window)
      { timestamp: new Date('2024-01-22'), /* ... */ },
    ],
    // ...
  };

  const points = calculateRewardPoints(contributor, 30, now);
  // Only counts last 2 blocks (within 30 days)
});
```

## Performance Considerations

### Time Complexity

- **Before**: O(n) where n = total blocks (all-time)
- **After**: O(n) where n = total blocks (but filters by timestamp first)

**Optimization opportunity**: If blocks are sorted by timestamp, we could use binary search for O(log n) cutoff, then O(m) where m = blocks in window. Not implemented yet as premature optimization.

### Memory

- No additional memory required
- Same block data structure
- Filtering happens in-place during calculation

## Comparison with Block Assignment

Both systems now use identical time window logic:

### Block Assignment: `calculate30DayPerformance()`

**Location**: [src/blockAssignment.ts:24-44](src/blockAssignment.ts#L24-L44)

```typescript
export function calculate30DayPerformance(
  contributor: Contributor,
  lookbackDays: number = 30,
  currentTime: Date = new Date()
): number {
  const cutoffTime = new Date(currentTime.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  const recentBlocks = contributor.completedBlocks.filter(
    block => block.timestamp >= cutoffTime && block.timestamp <= currentTime
  );
  // ... calculate total compute points
}
```

### Reward Distribution: `calculateRewardPoints()`

**Location**: [src/computePoints.ts:72-93](src/computePoints.ts#L72-L93)

```typescript
export function calculateRewardPoints(
  contributor: Contributor,
  lookbackDays?: number,
  currentTime: Date = new Date()
): number {
  let blocksToConsider = contributor.completedBlocks;
  if (lookbackDays !== undefined) {
    const cutoffTime = new Date(currentTime.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
    blocksToConsider = blocksToConsider.filter(
      block => block.timestamp >= cutoffTime && block.timestamp <= currentTime
    );
  }
  // ... calculate reward points (excludes canaries)
}
```

**Key Difference**: Reward distribution excludes canary blocks; block assignment includes them.

## Configuration

### Default Configuration

```typescript
export const DEFAULT_REWARD_CONFIG: RewardConfig = {
  dailyEmissions: 22_000,
  basePoolPercentage: 0.20,
  performancePoolPercentage: 0.80,
  performanceLookbackDays: 30, // ← 30-day rolling window
  // ...
};
```

### Custom Configuration

You can adjust the window for different use cases:

```typescript
const weeklyConfig: RewardConfig = {
  ...DEFAULT_REWARD_CONFIG,
  performanceLookbackDays: 7, // Weekly rewards
};

const quarterlyConfig: RewardConfig = {
  ...DEFAULT_REWARD_CONFIG,
  performanceLookbackDays: 90, // Quarterly rewards
};
```

## Migration Path

### For Testnet

1. ✅ Update `calculateRewardPoints()` to accept time window
2. ✅ Update `calculatePerformanceWeight()` to use 30-day window
3. ✅ Add `performanceLookbackDays` to `RewardConfig`
4. ✅ Update all callers to pass required parameters
5. ✅ Update all tests (181 tests passing)
6. ✅ Update documentation

### For Production

No additional migration needed. The 30-day window is:
- ✅ Fully implemented
- ✅ Fully tested
- ✅ Production-ready for testnet

**Remaining blocker for mainnet**: Fixed-point arithmetic (separate issue)

## Related Documentation

- [CRITICAL_CORRECTIONS.md](CRITICAL_CORRECTIONS.md) - Full context on why this was needed
- [PERFORMANCE_POOL.md](PERFORMANCE_POOL.md) - Performance pool design and implementation
- [BLOCK_ASSIGNMENT_SYSTEM.md](BLOCK_ASSIGNMENT_SYSTEM.md) - Block assignment 30-day window

## Summary

**What Changed**:
- Reward calculations now use 30-day rolling window instead of all-time points
- Aligns with block assignment system (both use 30-day window)
- Prevents "rich get richer forever" incumbency barrier

**Why It Matters**:
- Fair competition based on recent performance
- New contributors can catch up with good work
- Inactive contributors naturally phase out
- Encourages consistent contribution

**Status**:
- ✅ Fully implemented (2026-01-27)
- ✅ All tests passing (181 tests)
- ✅ Production-ready for testnet
- 🔴 Still need fixed-point arithmetic before mainnet

---

**Implementation**: 2026-01-27
**Test Coverage**: 181 tests, all passing
**Status**: ✅ Complete and production-ready for testnet
