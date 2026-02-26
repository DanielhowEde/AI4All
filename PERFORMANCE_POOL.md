# Performance Pool: Merit-Based Rewards

## Overview

The Performance Pool distributes **80% of daily emissions (17,600 out of 22,000 tokens)** to contributors based on their real work (non-canary) compute points, using square root weighting to balance merit with fairness.

The remaining 20% (4,400 tokens) is the **Base Pool**, split equally among all active contributors as a fairness floor.

**Total reward = base pool share + performance pool share.**

## Core Formula

```typescript
// Weight per contributor
weight = sqrt(reward_points_from_last_30_days)

// Share of performance pool
reward = (weight / sum_of_all_weights) × 17_600
```

## Why Square Root?

### Diminishing Returns

```
100 points  → sqrt(100)  = 10 weight
400 points  → sqrt(400)  = 20 weight   (4× points → 2× weight)
900 points  → sqrt(900)  = 30 weight   (9× points → 3× weight)
```

High performers earn more, but not in a winner-take-all way.

### Fairness for Small Contributors

```
Alice: 10,000 points → weight 100
Bob:   1,000 points  → weight 31.6

Alice share:  100/131.6 = 76%   (vs 90.9% without sqrt)
Bob share:   31.6/131.6 = 24%   (vs  9.1% without sqrt)
```

Bob gets 2.6× more of the pool with sqrt than with linear weighting.

### Sybil Resistance (Honest Assessment)

sqrt is concave, so splitting work across multiple accounts actually **increases** total weight:

```
Single account (400 points):      sqrt(400)          = 20
Split into 4 × 100 points:    4 × sqrt(100)          = 40  ← double!
```

**sqrt alone does not prevent Sybil attacks.** Actual defences:

1. **Per-account canary validation** — each account independently fails/passes; failed canaries trigger 24h blocks per account
2. **Per-account reputation** — splits all start at zero history, taking time to build assignment weight
3. **Block assignment gating** — new accounts get minimum weight (0.1) from the upstream lottery
4. **Operational friction** — managing N accounts requires N× effort and monitoring
5. **Future: identity cost** (stake, bond, or web-of-trust) — not yet implemented

**Why still use sqrt?** Diminishing returns per account, better fairness for small contributors, simple and transparent.

## Real-World Examples

### Three contributors

| Contributor | Points | Weight | Performance | + Base | Total |
|-------------|--------|--------|-------------|--------|-------|
| Alice | 900 | 30 | 8,800 | 1,467 | **10,267** |
| Bob | 400 | 20 | 5,867 | 1,467 | **7,334** |
| Charlie | 100 | 10 | 2,933 | 1,467 | **4,400** |
| *Total* | | 60 | 17,600 | 4,400 | 22,000 |

Charlie's points-to-reward ratio is best (44:1 vs Alice's 11.4:1)—small contributors are meaningfully rewarded.

### Dominant performer

Alice has 100× the points of Bob/Carol/Dave, but only takes 66.6% of emissions. The rest still earn 11% each (vs 0.3% under linear weighting).

## How It Works (Step by Step)

### 1. Compute reward points

Only **real work blocks** count—canary blocks (both passed and failed) are excluded. See [CANARY_SYSTEM.md](CANARY_SYSTEM.md).

```typescript
rewardPoints = sum(non_canary_blocks.points)  // last 30 days
```

### 2. Apply sqrt

```typescript
weight = Math.sqrt(rewardPoints)
```

### 3. Calculate performance pool share

```typescript
share = (weight / totalWeight) × 17_600

// Fallback: equal split when all weights are 0
```

### 4. Add base pool

```typescript
totalReward = (4_400 / activeContributorCount) + share
```

## 30-Day Rolling Window

Both block assignment and performance pool use a **30-day rolling window** to prevent incumbency advantage. Early contributors cannot build an insurmountable lead; performance is measured on recent work only.

```typescript
const rewardPoints = calculateRewardPoints(contributor, config.performanceLookbackDays, currentTime);
// performanceLookbackDays defaults to 30
```

After 30 days of inactivity a contributor's weight naturally drops to 0. New contributors can reach the same weight as veterans within a month of equal effort.

## Configuration

```typescript
export const DEFAULT_REWARD_CONFIG: RewardConfig = {
  dailyEmissions: 22_000,
  basePoolPercentage: 0.20,         // 20% equal split
  performancePoolPercentage: 0.80,  // 80% merit-based
  performanceLookbackDays: 30,      // rolling window
};
```

| Setting | Egalitarian | Standard | Merit-Focused |
|---------|-------------|----------|---------------|
| Base pool | 40% | 20% | 10% |
| Performance pool | 60% | 80% | 90% |

## Reputation: Gating, Not Weighting

Reputation determines **whether** you receive rewards (eligibility), not **how much** you get.

- Below `minReliability` threshold → inactive, no reward at all
- Above threshold → performance pool share based solely on points
- Reputation already affects upstream block assignment (fewer blocks = fewer points = lower weight)

Double-penalising bad actors in the distribution formula on top of this would be excessive.

## Fixed-Point Arithmetic (Mainnet)

The production reward path uses bigint fixed-point arithmetic (1 token = 1,000,000,000 nanounits) via `rewardDistributionFixed.ts`. This ensures:
- Fully deterministic results across environments
- No floating-point rounding drift
- Auditable reproductions of exact distributions

See [FIXED_POINT_ARITHMETIC.md](FIXED_POINT_ARITHMETIC.md) for details.

## Rehabilitation: Adaptive Scrutiny

Rather than permanent bans, the system uses dynamic canary rates. Contributors who fail canaries face **increased scrutiny** (more canary blocks), but can **rehabilitate** by passing canaries over time.

```
canary_rate = base + (failures × +5%) − (passes × −2%)
              clamped between 5% and 50%
```

| Failures | Passes | Rate | Effect |
|----------|--------|------|--------|
| 0 | 0 | 10% | Normal contributor |
| 3 | 0 | 25% | Heavy scrutiny |
| 3 | 5 | 15% | Reforming |
| 3 | 10 | 5% | Fully rehabilitated |

**Economic incentive**: At 50% scrutiny a cheater gets a canary in every other block. Each failed canary triggers a 24h earnings block. Cheating becomes unprofitable—honest work always yields higher income.

**Rehabilitation path**: Fast to escalate (+5% per failure), slow to recover (−2% per pass). Takes ~10 passed canaries to recover from 3 failures. Even reformed contributors remain at minimum 5% (always monitored).

Configuration:
```typescript
{
  baseCanaryPercentage: 0.10,       // 10% base
  canaryIncreasePerFailure: 0.05,   // +5% per failure
  canaryDecreasePerPass: 0.02,      // −2% per pass (slow recovery)
  maxCanaryPercentage: 0.50,        // 50% max
  minCanaryPercentage: 0.05,        // 5% min (always monitored)
}
```

## Performance Characteristics

| Operation | Complexity |
|-----------|-----------|
| `calculatePerformanceWeight` | O(m) — m blocks per contributor |
| `distributePerformancePool` | O(n × m) |
| `calculateDailyRewards` | O(n × m) |

Space: O(n) for weights, shares, and output.

**Optimisation opportunity**: Cache total points per contributor, invalidate on new blocks.

## Comparison to Alternatives

| Approach | Fairness | Merit | Sybil Resist | Complexity |
|----------|---------|-------|--------------|------------|
| Equal split | ★★★★★ | ★ | ★ | Low |
| Linear | ★ | ★★★★★ | ★★ | Low |
| **sqrt (this system)** | ★★★★ | ★★★★ | ★★★★ | Low |
| Log weighting | ★★★★★ | ★★ | ★★★★★ | Low |

sqrt over log: better balance between merit and fairness; log compresses high performers too aggressively. sqrt over linear: prevents winner-take-all monopolisation while still rewarding effort.

## Key Takeaways

1. **More real work = more reward**, but with diminishing returns (sqrt)
2. **Base pool** ensures every active contributor earns something
3. **30-day window** prevents incumbency—new contributors can compete
4. **Rehabilitation** replaces permanent bans with adaptive scrutiny
5. **Sybil resistance** comes from the combination of canaries + gating + reputation + friction, not sqrt alone
6. **Fixed-point arithmetic** in production ensures deterministic, auditable distributions
