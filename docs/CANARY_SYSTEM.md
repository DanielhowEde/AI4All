# Canary Block Anti-Gaming System

## Overview

Canary blocks (also called "honeypots") are special blocks randomly inserted into the work queue with **known-correct answers**. They look identical to normal blocks from the contributor's perspective, but the system knows the expected result.

## Purpose

1. **Detect Cheaters**: Contributors who claim to complete blocks without actually processing them will fail canaries
2. **Prevent Auto-claiming**: Bots that auto-accept blocks and return random results get caught
3. **Validate Processing**: Ensures contributors are genuinely running the AI models
4. **Maintain Network Integrity**: Bad actors are automatically penalized without manual intervention

## How It Works

### 1. Canary Distribution (10% of blocks by default)

```typescript
import { shouldBeCanary, selectCanaryBlocks } from './canaryGenerator';

// System decides which blocks are canaries
const blockId = 'block_abc123';
const config = { canaryPercentage: 0.10, seed: 42 };

if (shouldBeCanary(blockId, config)) {
  // This is a canary - set known-correct answer
}
```

### 2. Contributor Completes Block

```typescript
const completedBlock: CompletedBlock = {
  blockType: BlockType.INFERENCE,
  resourceUsage: 0.8,
  difficultyMultiplier: 1.0,
  validationPassed: true,
  timestamp: new Date(),
  isCanary: true,
  canaryAnswerCorrect: false, // ← Contributor got it wrong!
};
```

### 3. Points Calculation

```typescript
import { calculateBlockPoints } from './computePoints';

// Failed canary = 0 points
const points = calculateBlockPoints(completedBlock);
// Result: 0 (even though validation passed)
```

### 4. Reputation Penalty

```typescript
import { calculateReputationWithCanaryPenalty } from './computePoints';

const contributor = {
  accountId: 'acc_123',
  reputationMultiplier: 1.0, // Start at 100%
  canaryFailures: 2, // Failed 2 canaries
  completedBlocks: [...]
};

const config = {
  canaryFailurePenalty: 0.1, // -10% per failure
  canaryMaxFailures: 3, // Banned at 3
  ...
};

const effectiveReputation = calculateReputationWithCanaryPenalty(
  contributor.reputationMultiplier,
  contributor.canaryFailures,
  config
);

// Result: 1.0 - (2 × 0.1) = 0.8 (80% reputation)
```

### 5. Immediate 24-Hour Block

```typescript
import { isBlockedByRecentCanaryFailure } from './computePoints';

// After failing a canary, contributor is immediately blocked for 24h
const contributor = {
  accountId: 'acc_123',
  lastCanaryFailureTime: new Date('2026-01-27T12:00:00Z'),
  // ... other fields
};

const currentTime = new Date('2026-01-27T18:00:00Z'); // 6 hours later
const config = { canaryBlockDurationMs: 24 * 60 * 60 * 1000, ... };

if (isBlockedByRecentCanaryFailure(contributor, config, currentTime)) {
  // Contributor cannot receive ANY rewards for 24h
  // This applies even if they complete valid work during the block period
}
```

### 6. Ban After Max Failures

```typescript
// After 3 failed canaries, reputation goes to 0 (permanent ban)
if (canaryFailures >= 3) {
  // Contributor is permanently banned from receiving rewards
  isActiveContributor(contributor, config); // Returns false
}
```

## Penalty System

Canary failures trigger a **two-tier penalty system**:

### Tier 1: Immediate 24-Hour Block (Per Failure)

**Triggered**: After EACH canary failure
**Duration**: 24 hours from failure timestamp
**Effect**:
- Contributor cannot receive ANY rewards during block period
- Work completed during block is wasted (no points, no tokens)
- Block expires automatically after 24h
- Multiple failures = multiple 24h blocks (blocks don't stack, most recent applies)

**Example**:
```
Fail canary at 12:00 PM → Blocked until 12:00 PM next day
Complete 100 blocks during block period → 0 rewards
After 24h expires → Can earn rewards again (if under max failures)
```

### Tier 2: Progressive Reputation Penalties (Cumulative)

**Triggered**: Accumulated canary failures
**Duration**: Permanent (until reputation system reset, if implemented)
**Effect**:
- 1st failure: -10% reputation (24h block + 90% future rewards)
- 2nd failure: -20% reputation (24h block + 80% future rewards)
- 3rd failure: Permanent ban (reputation → 0, cannot earn rewards ever)

**Example**:
```
Start: 100% reputation, earning 1000 points/day = 1000 reward
Fail 1 canary: 90% reputation, blocked 24h, then earn 900 reward/day
Fail 2 canary: 80% reputation, blocked 24h, then earn 800 reward/day
Fail 3 canary: 0% reputation, permanent ban, 0 rewards forever
```

### Why Two Tiers?

- **24h block**: Immediate deterrent, fast feedback, prevents rapid retries
- **Reputation penalty**: Long-term consequence, discourages repeat offenses
- **Combined effect**: Strong anti-gaming protection without false-positive risk

## Key Properties

### Deterministic

The same `blockId` + `seed` always produces the same canary decision:

```typescript
shouldBeCanary('block_123', { canaryPercentage: 0.1, seed: 42 }); // true
shouldBeCanary('block_123', { canaryPercentage: 0.1, seed: 42 }); // true (always)
```

This allows:
- **Auditing**: Verify which blocks were canaries after the fact
- **Reproducibility**: Disputes can be resolved by replaying the logic
- **No Database**: Don't need to store canary flags, can recompute them

### Undetectable

Contributors cannot distinguish canaries from normal blocks:
- Same block format
- Same difficulty
- Same resource requirements
- Random distribution (10% looks like natural variation)

### No False Positives

Honest contributors who actually process blocks will naturally pass canaries:
- If you run the model, you get the correct answer
- Canaries test the same skills as normal blocks
- No trick questions or edge cases

## Configuration

### Recommended Settings

```typescript
// Production configuration
const productionConfig: RewardConfig = {
  canaryFailurePenalty: 0.1, // -10% reputation per failure
  canaryMaxFailures: 3, // 3 strikes and you're out
  canaryBlockDurationMs: 24 * 60 * 60 * 1000, // 24 hours
  ...
};

const canaryDistribution: CanaryConfig = {
  canaryPercentage: 0.10, // 10% of blocks
  seed: dailySeed, // Rotate daily for unpredictability
};
```

### Tuning Guidelines

| Metric | Low Security | Medium Security | High Security |
|--------|--------------|-----------------|---------------|
| Canary % | 5% | 10% | 15-20% |
| Penalty | -5% | -10% | -20% |
| Max Failures | 5 | 3 | 2 |
| Block Duration | 12h | 24h | 48h |

**Trade-offs**:
- **Higher canary %**: More detection, but more "wasted" compute
- **Higher penalty**: Faster bad actor removal, but harsher on mistakes
- **Lower max failures**: Stricter security, but less forgiving of honest errors
- **Longer block duration**: Stronger immediate deterrent, but more disruptive to honest mistakes

## Example: Full Workflow

```typescript
// Day 1: Contributor joins
const contributor = {
  accountId: 'alice',
  reputationMultiplier: 1.0,
  canaryFailures: 0,
  completedBlocks: [],
};

// System distributes 10 blocks, 1 is a canary
const blocks = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9', 'b10'];
const canaries = selectCanaryBlocks(blocks); // ['b3']

// Alice completes all blocks
// She actually runs the AI, so she passes the canary
blocks.forEach(blockId => {
  const isCanary = canaries.includes(blockId);
  const completed: CompletedBlock = {
    // ... Alice's work ...
    isCanary,
    canaryAnswerCorrect: isCanary ? true : undefined, // Correct!
  };
  contributor.completedBlocks.push(completed);
});

// Result: Alice earns full rewards
calculateEffectiveComputePoints(contributor); // Full points
isActiveContributor(contributor, config); // true

// Day 2: Bob tries to cheat at 10:00 AM
const bob = {
  accountId: 'bob',
  reputationMultiplier: 1.0,
  canaryFailures: 0,
  lastCanaryFailureTime: undefined,
  completedBlocks: [],
};

// Bob auto-claims blocks without processing
blocks.forEach(blockId => {
  const isCanary = canaries.includes(blockId);
  const completed: CompletedBlock = {
    // ... Bob's fake work ...
    timestamp: new Date('2026-01-28T10:00:00Z'),
    isCanary,
    canaryAnswerCorrect: isCanary ? false : undefined, // Wrong!
  };
  bob.completedBlocks.push(completed);
});

// Result: Bob earns 0 points on canary, loses 10% reputation, BLOCKED for 24h
countFailedCanaries(bob); // 1
bob.lastCanaryFailureTime = new Date('2026-01-28T10:00:00Z');
calculateReputationWithCanaryPenalty(bob.reputationMultiplier, 1, config); // 0.9

// Bob tries to claim more work at 2:00 PM (4 hours later)
const currentTime = new Date('2026-01-28T14:00:00Z');
isActiveContributor(bob, config, currentTime); // false (still blocked)

// Day 3 (26 hours later): Bob's block expires at 10:00 AM
const nextDay = new Date('2026-01-29T10:01:00Z');
isActiveContributor(bob, config, nextDay); // true (if he has valid work)
// But he now only earns 90% rewards due to reputation penalty

// Bob cheats again and fails 2 more canaries
bob.canaryFailures = 3;

// Result: Bob is permanently banned
isActiveContributor(bob, config); // false (forever)
```

## Security Considerations

### Attack: Sybil Splitting
**Defense**: Canaries are per-block, not per-account. Splitting work across multiple accounts doesn't help.

### Attack: Canary Detection
**Defense**: Distribution is deterministic but unpredictable without the seed. Seed rotates daily.

### Attack: Shared Answers
**Defense**: Canaries should use unique, per-block correct answers. Even if attackers share a database, each canary is different.

### Attack: Partial Processing
**Defense**: Canaries test full end-to-end processing, not just input validation.

## Implementation Checklist

- [x] Canary block type definitions
- [x] Deterministic canary selection
- [x] Points calculation with canary checks
- [x] Reputation penalty system
- [x] 24-hour block after canary failure
  - [x] Track last failure timestamp
  - [x] Check if contributor is currently blocked
  - [x] Automatic block expiration after 24h
- [x] Ban logic for max failures
- [x] Audit functions (count failures, check distribution)
- [x] Comprehensive unit tests (70+ test cases)
- [ ] Canary answer generation (Milestone 2+)
- [ ] Daily seed rotation (Milestone 2+)
- [ ] Canary performance monitoring dashboard

## Testing

Run canary tests:
```bash
npm test -- canaryGenerator.test.ts
```

Test coverage includes:
- Deterministic random generation
- Distribution percentage accuracy
- Edge cases (0%, 100%, empty inputs)
- Reputation calculation
- Ban logic
- Integration with compute points

## References

- Original design doc: AI4All Reward Distribution Design Specification v1.0
- Anti-Gaming Safeguards section
