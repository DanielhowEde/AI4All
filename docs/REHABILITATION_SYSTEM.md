# Rehabilitation System: Dynamic Canary Rates

## Overview

The AI4All reward system uses **adaptive scrutiny** instead of permanent bans. Contributors who fail canaries face increased scrutiny (more canary blocks), but can **rehabilitate** by passing canaries over time.

## Core Philosophy

**No Permanent Bans**: Every contributor has a path to redemption. The system self-regulates through dynamic canary rates rather than hard cutoffs.

## How It Works

### Dynamic Canary Rate Formula

```typescript
canary_rate = base + (failures × increase_per_failure) - (passes × decrease_per_pass)
canary_rate = clamp(canary_rate, min_rate, max_rate)
```

**Default Configuration**:
- **Base Rate**: 10% (clean contributors)
- **Increase Per Failure**: +5%
- **Decrease Per Pass**: -2%
- **Max Rate**: 50% (heavy cheaters)
- **Min Rate**: 5% (reformed contributors)

### Example Progression

| Failures | Passes | Canary Rate | Meaning |
|----------|--------|-------------|---------|
| 0 | 0 | 10% | Clean contributor |
| 1 | 0 | 15% | First offense, light scrutiny |
| 3 | 0 | 25% | Repeat offender, heavy scrutiny |
| 5 | 0 | 35% | Serious cheater, very heavy scrutiny |
| 10 | 0 | 50% | Extreme case, max scrutiny (1 in 2 blocks) |
| 3 | 5 | 15% | Reformed! (3×5% - 5×2% = 25% - 10% = 15%) |
| 3 | 10 | 5% | Fully rehabilitated! (clamped to min 5%) |

## Rehabilitation Path

### Scenario: Bob the Cheater

**Day 1**: Bob tries to cheat, fails 3 canaries
- Canary Rate: 10% + (3 × 5%) = **25%**
- Bob gets canaries in 25% of his blocks (high scrutiny)
- Blocked for 24h after each failure
- Reputation: 70% (earns 70% of normal rewards)

**Day 2-5**: Bob reforms, starts doing honest work
- Passes 1st canary → Rate: 25% - 2% = **23%**
- Passes 2nd canary → Rate: 23% - 2% = **21%**
- Passes 3rd canary → Rate: 21% - 2% = **19%**
- Passes 4th canary → Rate: 19% - 2% = **17%**

**Day 6-10**: Continued honest behavior
- Passes 5 more canaries → Rate: 17% - 10% = **7%**
- Almost back to normal!

**Day 11+**: Fully reformed
- Passes 2 more canaries → Rate: 7% - 4% = 3% → **clamped to 5% min**
- Bob now gets baseline canary rate (5%)
- Still monitored, but trusted again

### Key Points

1. **Fast Escalation**: Failures increase scrutiny quickly (+5% per failure)
2. **Slow Recovery**: Passes decrease scrutiny slowly (-2% per pass)
3. **No Instant Forgiveness**: Takes ~5-10 passed canaries to recover from 3 failures
4. **Always Monitored**: Even reformed contributors get minimum 5% canary rate

## Implementation

### Calculate Dynamic Rate

```typescript
import { calculateDynamicCanaryRate } from './computePoints';

const contributor = {
  accountId: 'alice',
  canaryFailures: 2,
  canaryPasses: 3,
  // ... other fields
};

const config = {
  baseCanaryPercentage: 0.10,
  canaryIncreasePerFailure: 0.05,
  canaryDecreasePerPass: 0.02,
  maxCanaryPercentage: 0.50,
  minCanaryPercentage: 0.05,
  // ... other config
};

const personalizedRate = calculateDynamicCanaryRate(contributor, config);
// Result: 0.10 + (2 × 0.05) - (3 × 0.02) = 0.14 (14%)
```

### Usage in Block Distribution

```typescript
// When assigning blocks to contributors, use their personalized canary rate
for (const contributor of contributors) {
  const canaryRate = calculateDynamicCanaryRate(contributor, config);

  // Distribute blocks with personalized canary percentage
  const blocks = distributeBlocks(contributor, {
    canaryPercentage: canaryRate,
    totalBlocks: 100,
  });

  // Example result for Bob (25% rate): 25 canaries, 75 normal blocks
}
```

## Benefits

### 1. Self-Regulating System
- Cheaters automatically face more scrutiny
- Honest contributors face less scrutiny
- No manual intervention needed

### 2. Fair Second Chances
- Mistakes don't result in permanent bans
- Contributors can prove reform through honest work
- Encourages rehabilitation over punishment

### 3. Economic Incentives
- Cheating = more canaries = more chances to fail = 24h blocks = lost income
- Honest work = fewer canaries = smoother experience = consistent income
- **It's more profitable to be honest than to cheat**

### 4. Adaptive Security
- System automatically adapts to threat levels
- Heavy cheaters face 50% canary rate (very hard to game)
- Light offenders face 15-20% (room for reform)

## Comparison: Old vs. New System

| Aspect | Old (3-Strike Ban) | New (Rehabilitation) |
|--------|-------------------|---------------------|
| **Permanent Ban** | Yes (after 3 failures) | No (never) |
| **Recovery** | Impossible | Always possible |
| **Scrutiny** | Fixed 10% for all | Dynamic 5-50% per contributor |
| **False Positives** | Catastrophic | Recoverable |
| **Gaming Resistance** | Moderate | High |
| **Fairness** | Harsh | Balanced |

## Configuration Tuning

### Lenient (Beta/Testing)
```typescript
{
  baseCanaryPercentage: 0.08,      // 8% base
  canaryIncreasePerFailure: 0.03,  // +3% per failure
  canaryDecreasePerPass: 0.03,     // -3% per pass (fast recovery)
  maxCanaryPercentage: 0.30,       // 30% max
  minCanaryPercentage: 0.05,       // 5% min
}
```

### Standard (Production)
```typescript
{
  baseCanaryPercentage: 0.10,      // 10% base
  canaryIncreasePerFailure: 0.05,  // +5% per failure
  canaryDecreasePerPass: 0.02,     // -2% per pass
  maxCanaryPercentage: 0.50,       // 50% max
  minCanaryPercentage: 0.05,       // 5% min
}
```

### Strict (High-Security)
```typescript
{
  baseCanaryPercentage: 0.15,      // 15% base
  canaryIncreasePerFailure: 0.10,  // +10% per failure (fast escalation)
  canaryDecreasePerPass: 0.01,     // -1% per pass (slow recovery)
  maxCanaryPercentage: 0.70,       // 70% max (very heavy scrutiny)
  minCanaryPercentage: 0.10,       // 10% min (always monitored)
}
```

## Monitoring & Analytics

### Key Metrics to Track

1. **Distribution of Canary Rates**
   - How many contributors at each rate tier?
   - Are most at base (10%) or elevated?

2. **Rehabilitation Success Rate**
   - What % of failed-canary contributors pass subsequent canaries?
   - How long does rehabilitation take on average?

3. **Repeat Offenders**
   - Do contributors oscillate between high/low rates?
   - Are some stuck at max rate permanently?

4. **Economic Impact**
   - How much compute is spent on canaries?
   - Is the cost justified by fraud prevention?

### Example Dashboard Query

```sql
SELECT
  CASE
    WHEN canary_rate < 0.10 THEN 'Below Base'
    WHEN canary_rate = 0.10 THEN 'Base (Clean)'
    WHEN canary_rate BETWEEN 0.10 AND 0.20 THEN 'Light Scrutiny'
    WHEN canary_rate BETWEEN 0.20 AND 0.35 THEN 'Moderate Scrutiny'
    WHEN canary_rate BETWEEN 0.35 AND 0.50 THEN 'Heavy Scrutiny'
    ELSE 'Max Scrutiny'
  END AS scrutiny_tier,
  COUNT(*) as contributor_count,
  AVG(canary_failures) as avg_failures,
  AVG(canary_passes) as avg_passes
FROM contributors
GROUP BY scrutiny_tier
ORDER BY canary_rate;
```

## Security Considerations

### Attack: Rapid Cycling
**Scenario**: Cheater tries to rapidly pass canaries to lower rate, then cheat

**Defense**:
- Passing canaries only decreases rate by -2% each
- Takes 5-10 passes to recover from 3 failures
- Each failure adds +5%, so cheating negates progress
- 24h blocks make rapid cycling impractical

### Attack: Persistent Cheating
**Scenario**: Cheater accepts max 50% canary rate and tries to game half the blocks

**Defense**:
- At 50% rate, half of all blocks are canaries
- Expected to fail 50% of canaries (since cheating)
- Each failure = 24h block = lost income
- **Not economically viable** - more profitable to work honestly

### Attack: Sybil Splitting
**Scenario**: Cheater creates multiple accounts to avoid high canary rates

**Defense**:
- New accounts start at 10% rate anyway
- Diminishing returns (sqrt) means splitting work doesn't help
- Each account independently tracked
- Caught accounts don't affect others (no cross-contamination)

## Testing

Run rehabilitation tests:
```bash
npm test -- dynamicCanary.test.ts
```

Expected: **15 tests pass**, covering:
- Counting passed canaries
- Dynamic rate calculation
- Escalation and rehabilitation
- Min/max clamping
- No permanent bans

## Migration from Old System

If migrating from the 3-strike ban system:

1. **Reset Banned Accounts** (optional):
   ```sql
   UPDATE contributors
   SET canary_failures = 3,  -- Give them high scrutiny
       canary_passes = 0
   WHERE reputation_multiplier = 0 AND canary_failures >= 3;
   ```

2. **Add canaryPasses Field**:
   ```sql
   ALTER TABLE contributors ADD COLUMN canary_passes INTEGER DEFAULT 0;
   ```

3. **Remove canaryMaxFailures from Config**:
   ```typescript
   // OLD:
   const config = { canaryMaxFailures: 3, ... };

   // NEW:
   const config = {
     baseCanaryPercentage: 0.10,
     canaryIncreasePerFailure: 0.05,
     canaryDecreasePerPass: 0.02,
     maxCanaryPercentage: 0.50,
     minCanaryPercentage: 0.05,
     ...
   };
   ```

## Status

✅ **Implemented and tested**
- Dynamic canary rate calculation
- Rehabilitation logic (pass counting)
- No permanent bans
- Comprehensive unit tests (15+ cases)

🔄 **Future Enhancements**
- Manual reputation reset (admin tool)
- Canary rate decay over time (forgiveness)
- Visualization dashboard
- Per-contributor canary scheduling

---

**Key Takeaway**: The rehabilitation system makes cheating economically unviable while giving honest mistakes a path to recovery. It's both more secure and more fair than hard bans.
