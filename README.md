# AI4All Reward Distribution System

Token reward distribution system implementing fair, merit-based rewards with anti-gaming safeguards.

## Quick Start

### Install Dependencies
```bash
npm install
```

### Run Tests
```bash
npm test
```

### Run Tests in Watch Mode
```bash
npm run test:watch
```

### Run Tests with Coverage
```bash
npm run test:coverage
```

### Build
```bash
npm run build
```

## Project Structure

```
src/
├── types.ts                        # Core type definitions
├── computePoints.ts                # Compute points calculation logic
├── computePoints.test.ts           # Unit tests for compute points
├── canaryGenerator.ts              # Canary block honeypot system
├── canaryGenerator.test.ts         # Unit tests for canary generator
├── dynamicCanary.test.ts           # Tests for rehabilitation system
├── rewardDistribution.ts           # Daily reward distribution logic (floating-point)
├── rewardDistribution.test.ts      # Unit tests for reward distribution
├── rewardDistributionFixed.ts      # Fixed-point reward distribution (mainnet)
├── rewardDistributionFixed.test.ts # Fixed-point integration tests
├── fixedPoint.ts                   # Fixed-point arithmetic utilities
├── fixedPoint.test.ts              # Fixed-point core tests
├── blockAssignment.ts              # Block assignment weighted lottery
├── blockAssignment.test.ts         # Unit tests for block assignment
└── (more modules coming in future milestones)
```

## Development Status

### ✅ Milestone 1: Core Data Structures & Compute Points
- [x] Type definitions
- [x] Block types and point calculation
- [x] Active contributor validation
- [x] Canary block anti-gaming system
  - [x] Honeypot blocks with known answers
  - [x] Automatic reputation penalties
  - [x] **24-hour block after each canary failure**
  - [x] **Dynamic canary rates (rehabilitation system)**
  - [x] **No permanent bans - always a path to redemption**
  - [x] Deterministic canary distribution
  - [x] Failed canary detection
- [x] Unit tests (100% coverage, 80+ tests)

### ✅ Milestone 2A: Base Participation Pool (Fairness Floor)
- [x] Base pool calculation (30% of daily emissions)
- [x] Equal distribution among active contributors
- [x] Integration with canary system (blocked contributors excluded)
- [x] ContributorReward and RewardDistribution types
- [x] Unit tests (100% coverage, 20+ tests)
- [x] Integration tests with rehabilitation system

### ✅ Milestone 2B: Block Assignment System (Upstream Work Distribution)
- [x] BlockAssignment and BlockAssignmentConfig types
- [x] 30-day performance tracking (lookback window)
- [x] Hybrid weight calculation (sqrt(performance) × reputation)
- [x] Weighted lottery algorithm (pure random selection)
- [x] Daily block distribution (2,200 blocks/day in batches of 5)
- [x] Minimum weight for new contributors (0.1 default)
- [x] Integration with reputation/canary system
- [x] Unit tests (27+ tests covering all edge cases)
- [x] Integration tests (6 scenarios with canary system)
- [x] Comprehensive documentation

### ✅ Milestone 3: Performance Pool (Merit-Based Rewards)
- [x] Performance weight calculation with sqrt diminishing returns
- [x] Performance pool distribution (80% of emissions)
- [x] Integration with base pool (complete daily rewards)
- [x] calculateDailyRewards() and calculateRewardDistribution()
- [x] **30-day rolling window (prevents "rich get richer forever")**
- [x] **Fixed-point arithmetic (deterministic, auditable, mainnet-ready)**
- [x] Fairness for small contributors (diminishing returns)
- [x] Canary blocks excluded from reward calculations
- [x] Unit tests (49+ tests for performance pool)
- [x] Fixed-point tests (64 tests: 42 core + 22 integration)
- [x] Integration tests with reputation/canary systems
- [x] Comprehensive documentation with honest Sybil assessment
- [x] Edge case handling (0 points, single contributor, 100+ contributors)

### 🔄 Upcoming Milestones
- [ ] Luck Pool (optional weighted lottery, 0-10% of emissions)
- [ ] End-to-end integration tests (full workflow)
- [ ] Performance optimizations (caching, indexing)
- [ ] Settlement and payout system

## Testing Philosophy

- All tests are deterministic (no network, no real time)
- External systems are mocked
- Coverage includes: happy path, edge cases, failure cases

## Documentation

**[📋 IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md)** - Complete implementation status and mainnet readiness

### Detailed system documentation:

- **[CANARY_SYSTEM.md](CANARY_SYSTEM.md)** - Honeypot blocks for anti-gaming detection
- **[CANARY_EXCLUSION_FROM_REWARDS.md](CANARY_EXCLUSION_FROM_REWARDS.md)** - Why canaries don't count toward rewards
- **[REHABILITATION_SYSTEM.md](REHABILITATION_SYSTEM.md)** - Dynamic canary rates and contributor recovery
- **[BLOCK_ASSIGNMENT_SYSTEM.md](BLOCK_ASSIGNMENT_SYSTEM.md)** - Weighted lottery for upstream work distribution
- **[PERFORMANCE_POOL.md](PERFORMANCE_POOL.md)** - Merit-based rewards with sqrt diminishing returns
- **[30DAY_ROLLING_WINDOW.md](30DAY_ROLLING_WINDOW.md)** - 30-day rolling window implementation (prevents "rich get richer forever")
- **[FIXED_POINT_ARITHMETIC.md](FIXED_POINT_ARITHMETIC.md)** - ✅ **Deterministic fixed-point arithmetic for mainnet**
- **[CRITICAL_CORRECTIONS.md](CRITICAL_CORRECTIONS.md)** - Important design corrections and improvements
- **[MILESTONE1_24H_BLOCK_ENHANCEMENT.md](MILESTONE1_24H_BLOCK_ENHANCEMENT.md)** - 24-hour cooldown after canary failures

## Test Results

```bash
npm test
```

**Current Status**: ✅ **245 tests passing** (all test suites)

### Test Breakdown
- **Canary System**: 30 tests
- **Compute Points**: 45 tests
- **Block Assignment**: 33 tests
- **Reward Distribution**: 49 tests (floating-point)
- **Fixed-Point Arithmetic**: 42 tests (core utilities)
- **Fixed-Point Rewards**: 22 tests (integration)
- **Dynamic Canary**: 24 tests

**Total Coverage**: All critical paths tested, including edge cases and error conditions

## Production Readiness

### ✅ MAINNET-READY

All critical components complete:
- ✅ **Deterministic calculations**: Fixed-point arithmetic with bigint
- ✅ **Fair time window**: 30-day rolling window prevents incumbency
- ✅ **Anti-gaming**: Canary system with dynamic rehabilitation
- ✅ **Auditable**: Exact sum verification down to microunits
- ✅ **Comprehensive testing**: 245 tests, all passing
- ✅ **Honest documentation**: Clear about limitations and tradeoffs

**Optional Enhancements** (future milestones):
- 🟡 Identity cost layer (additional Sybil resistance)
- 🟡 Luck pool (weighted lottery rewards)
- 🟡 Settlement and payout system
