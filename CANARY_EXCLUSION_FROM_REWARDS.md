# Canary Blocks Excluded from Reward Calculations

## Overview

**Important Change**: Canary blocks (both passed and failed) are **excluded** from reward point calculations. They do NOT count toward performance pool distribution.

**Rationale**: Canary blocks are validation/test blocks designed to detect cheaters. They are not real work and should not earn rewards.

## What Changed

### Before
```typescript
// OLD: Used calculateTotalComputePoints() which included canaries
weight = sqrt(total_points_including_canaries)
```

### After
```typescript
// NEW: Uses calculateRewardPoints() which excludes all canaries
weight = sqrt(reward_points_excluding_canaries)
```

## Impact on Contributors

### Example: Contributor with Mixed Blocks

**Blocks completed**:
- 10 INFERENCE blocks (real work) = 100 points
- 2 TRAINING blocks (real work) = 30 points
- 3 INFERENCE canaries (passed) = 30 points
- **Total**: 160 points

**Reward calculation**:
- **Old behavior**: sqrt(160) = 12.65 weight
- **New behavior**: sqrt(130) = 11.40 weight ← Only real work counts

**Result**: Canaries excluded, fair reward for actual work performed.

### Why This Is Fair

1. **Canaries are tests, not work**: They exist to validate honesty, not to produce value
2. **Everyone gets the same canary rate**: Dynamic canary system ensures fairness
3. **Passing canaries still helps**:
   - Reduces your future canary rate (rehabilitation)
   - Maintains your reputation
   - Keeps you active (not blocked)
4. **Failed canaries already penalized**: 24h block + reputation loss

## Technical Implementation

### New Function: `calculateRewardPoints()`

Location: [computePoints.ts:56-68](src/computePoints.ts#L56-L68)

```typescript
export function calculateRewardPoints(contributor: Contributor): number {
  return contributor.completedBlocks
    .filter(block => !block.isCanary) // Exclude all canaries
    .reduce((total, block) => {
      return total + calculateBlockPoints(block);
    }, 0);
}
```

**Key difference from `calculateTotalComputePoints()`**:
- `calculateTotalComputePoints()`: Includes all blocks (used for tracking, analytics)
- `calculateRewardPoints()`: Excludes canaries (used for reward distribution)

### Updated Functions

**Performance Weight Calculation**:
```typescript
// src/rewardDistribution.ts:156-159
export function calculatePerformanceWeight(contributor: Contributor): number {
  const rewardPoints = calculateRewardPoints(contributor); // ← Changed
  return Math.sqrt(rewardPoints);
}
```

**Daily Rewards Reason String**:
```typescript
// Now shows correct point count (excluding canaries)
reason: `Base: 2200.00 (equal share) + Performance: 8800.00 (130 points → 11.40 weight) = 11000.00 tokens`
//                                                              ↑ Only real work points
```

## Test Coverage

### New Tests Added

**computePoints.test.ts** (6 new tests):
1. ✅ Exclude all canary blocks from rewards
2. ✅ Exclude failed canary blocks
3. ✅ Count only real work blocks
4. ✅ Return 0 if all blocks are canaries
5. ✅ Return 0 for empty contributor
6. ✅ Verify difference from `calculateTotalComputePoints()`

**rewardDistribution.test.ts** (2 new tests):
1. ✅ Exclude canary blocks from reward calculations (integration test)
2. ✅ Give 0 reward if contributor only completed canaries

### Test Examples

**Test 1: Mixed real work and canaries**
```typescript
Blocks:
  - INFERENCE (real) → 10 points ✓
  - INFERENCE (passed canary) → 0 points (excluded)
  - TRAINING (real) → 15 points ✓
  - INFERENCE (passed canary) → 0 points (excluded)

Reward points: 25 (only real work)
```

**Test 2: Only canaries**
```typescript
Blocks:
  - INFERENCE (passed canary) → 0 points
  - INFERENCE (passed canary) → 0 points
  - INFERENCE (passed canary) → 0 points

Reward points: 0
Performance pool: 0 tokens
Base pool: Still eligible (fairness floor)
```

## Impact Analysis

### Scenario 1: Honest Contributor
- **Canary rate**: 10% (base)
- **100 blocks completed**: 90 real work, 10 canaries
- **Reward points**: Based on 90 blocks only
- **Impact**: Fair - rewarded for actual work

### Scenario 2: Cheater (Failed Canaries)
- **Failed 3 canaries**: 24h block + reputation penalty
- **During 24h**: No rewards at all (blocked)
- **After 24h**: Higher canary rate (e.g., 25%)
- **100 blocks completed**: 75 real work, 25 canaries
- **Reward points**: Based on 75 blocks only
- **Impact**: Reduced rewards due to less real work opportunity

### Scenario 3: Reformed Cheater (Passing Canaries)
- **Passed 10 canaries**: Canary rate decreases (e.g., 15% → 10% → 8%)
- **More real work opportunities**: Less time spent on validation
- **Reward points**: Based on actual work completed
- **Impact**: Rehabilitation path clear

## Edge Cases

### All Canaries Scenario
```typescript
Contributor only completed canaries (no real work):
- Reward points: 0
- Performance pool: 0 tokens
- Base pool: 2,200 tokens (still gets fairness floor)
- Total: 2,200 tokens
```

**Why still get base pool?**
- They passed the canaries (proved honest)
- Not blocked (active contributor)
- Base pool is fairness floor (everyone gets equal share)

### Zero Weight Fallback
```typescript
All contributors have 0 reward points:
- Performance pool distribution: Falls back to equal split
- Ensures no tokens are lost
- Extremely rare edge case
```

## Backward Compatibility

### No Breaking Changes
- ✅ Existing `calculateTotalComputePoints()` unchanged (used for analytics)
- ✅ New `calculateRewardPoints()` added alongside
- ✅ Only reward distribution logic updated
- ✅ All tests updated and passing

### Migration Path
```typescript
// OLD CODE (if any external usage)
const points = calculateTotalComputePoints(contributor);
const weight = Math.sqrt(points);

// NEW CODE
const rewardPoints = calculateRewardPoints(contributor);
const weight = Math.sqrt(rewardPoints);

// Or use the helper directly
const weight = calculatePerformanceWeight(contributor);
```

## Documentation Updates

Files updated to reflect canary exclusion:
- [x] [computePoints.ts](src/computePoints.ts) - New `calculateRewardPoints()` function
- [x] [rewardDistribution.ts](src/rewardDistribution.ts) - Uses `calculateRewardPoints()`
- [x] [computePoints.test.ts](src/computePoints.test.ts) - 6 new tests
- [x] [rewardDistribution.test.ts](src/rewardDistribution.test.ts) - 2 new tests
- [x] This document - Complete explanation

## FAQ

### Q: Why exclude passed canaries? They were answered correctly!

**A**: Canaries are validation blocks, not productive work. Including them would:
1. Reward contributors for taking tests (not creating value)
2. Create perverse incentive to seek out more canaries
3. Complicate the system (different canary rates = different earnings)

The purpose of canaries is to validate honesty, not to produce output.

### Q: Does this punish honest contributors?

**A**: No, because:
1. Everyone has the same base canary rate (10%)
2. Honest contributors pass canaries → rate decreases over time (8%, 5%)
3. Cheaters fail canaries → rate increases (15%, 25%, 50%)
4. Net effect: Honest contributors spend more time on real work = more rewards

### Q: What if I fail a canary accidentally?

**A**:
1. You get a 24h block (no rewards)
2. Your canary rate increases (more scrutiny)
3. But you can rehabilitate by passing canaries
4. Your canary rate decreases back to normal as you prove honesty

The system is designed for rehabilitation, not permanent punishment.

### Q: Can I game the system by only doing canaries?

**A**: No:
1. You can't identify which blocks are canaries (they look like regular work)
2. If you somehow did only canaries: 0 performance pool rewards
3. You'd only get base pool (2,200 / N contributors)
4. Far less than honest contributors who do real work

### Q: How does this affect high performers?

**A**: Positive impact:
1. sqrt already provides diminishing returns (prevents monopolization)
2. Excluding canaries makes the system more accurate
3. High performers naturally have lower canary rates (proven honest)
4. More of their blocks are real work → higher reward points

## Summary

**Key Points**:
1. ✅ Canaries excluded from reward calculations (both passed and failed)
2. ✅ Only real work blocks count toward performance pool
3. ✅ Base pool still distributed equally (fairness floor maintained)
4. ✅ Incentivizes honest work over gaming the validation system
5. ✅ Fully tested with 8 new test cases
6. ✅ No breaking changes to existing code

**Impact**: More accurate reward distribution that properly values actual work over validation checks.

---

**Implementation Date**: 2026-01-27
**Related Systems**: Performance Pool, Canary System, Reward Distribution
**Status**: ✅ Implemented and Tested
