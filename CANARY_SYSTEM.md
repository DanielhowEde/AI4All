# Canary Block Anti-Gaming System

## Overview

Canary blocks (honeypots) are special blocks randomly inserted into the work queue with **known-correct answers**. They look identical to normal blocks from the contributor's perspective, but the system knows the expected result.

**Purpose**: Detect cheaters, prevent auto-claiming, validate genuine AI processing, and maintain network integrity—automatically, without manual intervention.

## How It Works

### 1. Canary Distribution (10% of blocks by default)

```typescript
const config = { canaryPercentage: 0.10, seed: dailySeed };
if (shouldBeCanary(blockId, config)) {
  // This is a canary — system knows the correct answer
}
```

### 2. Contributor Completes Block

```typescript
const completed: CompletedBlock = {
  blockType: BlockType.INFERENCE,
  resourceUsage: 0.8,
  isCanary: true,
  canaryAnswerCorrect: false, // ← Contributor got it wrong!
};
```

### 3. Failed Canary → 0 Points + Penalty

```typescript
// Failed canary = 0 points even if validation otherwise "passed"
const points = calculateBlockPoints(completed); // → 0
```

### 4. 24-Hour Block (Immediate)

After each canary failure the contributor is immediately blocked from receiving **any** rewards for 24 hours:

```typescript
// 10:00 AM: Bob fails canary
bob.lastCanaryFailureTime = new Date('2026-01-28T10:00:00Z');

// 2:00 PM same day: Still blocked
isActiveContributor(bob, config, new Date('2026-01-28T14:00:00Z')); // false

// 10:01 AM next day: Block expires
isActiveContributor(bob, config, new Date('2026-01-29T10:01:00Z')); // true
```

### 5. Progressive Reputation Penalty (Permanent Until Reformed)

```typescript
// -10% reputation per failure, 0% = permanent ban
const effective = calculateReputationWithCanaryPenalty(
  contributor.reputationMultiplier, // e.g., 1.0
  contributor.canaryFailures,       // e.g., 2
  config                            // canaryFailurePenalty: 0.1
);
// Result: 1.0 - (2 × 0.1) = 0.8
```

| Failure | Immediate Effect | Long-Term Effect |
|---------|-----------------|-----------------|
| 1st | Blocked 24h | −10% reputation (90% future rewards) |
| 2nd | Blocked 24h | −20% reputation (80% future rewards) |
| 3rd | Blocked 24h | Permanent ban (0% reputation) |

## Reward Calculation: Canaries Excluded

Canary blocks (both passed and failed) do **not** count toward performance pool points. Only real work blocks earn rewards.

```typescript
// calculateRewardPoints() excludes all canary blocks
export function calculateRewardPoints(contributor: Contributor): number {
  return contributor.completedBlocks
    .filter(block => !block.isCanary)
    .reduce((total, block) => total + calculateBlockPoints(block), 0);
}

// calculatePerformanceWeight() uses reward points (not total compute points)
export function calculatePerformanceWeight(contributor: Contributor): number {
  return Math.sqrt(calculateRewardPoints(contributor));
}
```

**Example**: 90 real work blocks + 10 canaries → reward points from the 90 blocks only.

**Why exclude passed canaries?** Canaries are validation tests, not productive work. Everyone gets the same base canary rate, so excluding them is fair. Honest contributors naturally pass canaries and earn fewer over time (via the rehabilitation system), meaning more of their blocks count as real work.

**Edge case**: A contributor who only completed canaries (no real work) gets 0 performance pool tokens but still receives the base pool share (the fairness floor).

## Rehabilitation: Dynamic Canary Rates

Instead of permanent bans after 3 failures, the system uses **adaptive scrutiny**. Canary rates adjust per contributor based on their history:

```
canary_rate = base + (failures × increase_per_failure) − (passes × decrease_per_pass)
canary_rate = clamp(canary_rate, min_rate, max_rate)
```

**Default**: base 10%, +5% per failure, −2% per pass, max 50%, min 5%.

| Failures | Passes | Rate | Meaning |
|----------|--------|------|---------|
| 0 | 0 | 10% | Clean contributor |
| 3 | 0 | 25% | Repeat offender, heavy scrutiny |
| 3 | 5 | 15% | Reforming |
| 3 | 10 | 5% | Fully rehabilitated (clamped to min) |

```typescript
const personalizedRate = calculateDynamicCanaryRate(contributor, config);
// e.g., canaryFailures=2, canaryPasses=3 → 0.10 + 0.10 − 0.06 = 14%
```

**Key insight**: At 50% scrutiny, a cheater gets a canary in every other block, and each failure triggers a 24h block. Cheating becomes economically unviable—honest work always pays better.

## Key Properties

**Deterministic**: `shouldBeCanary(blockId, { seed: 42 })` always returns the same result. No database needed to store canary flags; they can be recomputed for auditing.

**Undetectable**: Canaries use the same block format, difficulty, and resource requirements as normal blocks. The 10% rate looks like natural variation.

**No false positives**: Honest contributors who actually run the AI model get canaries correct automatically. Canaries test the same skills as normal work.

## Configuration

```typescript
// Default production settings
const config = {
  canaryFailurePenalty: 0.1,           // −10% reputation per failure
  canaryBlockDurationMs: 86_400_000,   // 24h block after each failure
  baseCanaryPercentage: 0.10,          // 10% base rate
  canaryIncreasePerFailure: 0.05,      // +5% rate per failure
  canaryDecreasePerPass: 0.02,         // −2% rate per pass
  maxCanaryPercentage: 0.50,           // Cap at 50%
  minCanaryPercentage: 0.05,           // Floor at 5% (always monitored)
};
```

| Setting | Low Security | Standard | High Security |
|---------|-------------|----------|---------------|
| Canary % | 5% | 10% | 15–20% |
| Penalty | −5% | −10% | −20% |
| Block duration | 12h | 24h | 48h |
| Max rate | 30% | 50% | 70% |

## Security Considerations

**Sybil splitting**: Canaries are per-block, not per-account. Splitting across accounts doesn't help—each account gets independently scrutinised.

**Canary detection**: Distribution is deterministic but requires the daily seed (which is secret until the day closes). Seed rotation prevents pre-computation.

**Shared answers**: Each canary should have a unique per-block correct answer. Even if cheaters share a database of answers, each canary differs.

**Rapid cycling**: Passing canaries decreases scrutiny by only −2% each. Recovering from 3 failures takes ~10 passed canaries, but a single re-failure adds back +5%. Cheating negates progress.

## Testing

```bash
npm test -- canaryGenerator.test.ts dynamicCanary.test.ts
```

Coverage includes: deterministic generation, distribution percentage accuracy, reputation penalties, 24h block timing edge cases, ban logic, dynamic rate calculation, rehabilitation progression, and integration with compute points and reward distribution.
