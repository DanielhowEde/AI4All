# AI4All

Decentralised AI compute network. Workers contribute GPU/CPU resources, earn token rewards, and are cryptographically linked to wallets via post-quantum signatures.

## Architecture

```
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│  iOS Wallet  │◄────►│   Backend    │◄────►│    Worker    │
│  (Swift/UI)  │      │  (Express)   │      │   (Rust)     │
│  ML-DSA-65   │      │  REST API    │      │  ML-DSA-65   │
│  QR scanner  │      │  In-memory   │      │  GPU/CPU     │
└──────────────┘      └──────────────┘      └──────────────┘
        h:/repos/           src/                worker/
        AI4AllWallet
```

**Three codebases, one protocol:**

| Component | Language | Location | Purpose |
|-----------|----------|----------|---------|
| Backend | TypeScript + Express | `src/` | API server, reward distribution, pairing, persistence |
| Worker | Rust | `worker/` | Compute execution, GPU detection, device pairing CLI |
| iOS Wallet | Swift/SwiftUI | `h:/repos/AI4AllWallet/` | Key management, QR pairing, balance viewer |

## Quick Start

### Backend

```bash
npm install
npm test          # 632 tests
npm run build
npm start         # Express server on :3000
```

### Worker

```bash
cd worker
cargo build --release
./target/release/ai4all-worker run --api-url http://localhost:3000
```

### Device Pairing

```bash
# Worker terminal:
ai4all-worker pair --api-url http://localhost:3000 --name "My Desktop"
# Displays QR code + short code (K7F9-M2Q4 format)

# iOS Wallet:
# Settings → Link Worker → scan QR or enter short code → verify 4-digit code → Approve
```

## Project Structure

```
src/
├── api/
│   ├── app.ts                  # Express app setup, route mounting
│   ├── server.ts               # HTTP server entry point
│   ├── state.ts                # In-memory state (Maps for accounts, nodes, pairings, devices)
│   ├── types.ts                # API types, error codes, pairing/device interfaces
│   ├── middleware/
│   │   └── adminAuth.ts        # Admin authentication middleware
│   ├── routes/
│   │   ├── nodes.ts            # Node registration & management
│   │   ├── work.ts             # Work request/submit (dual auth: nodeKey OR device sig)
│   │   ├── rewards.ts          # Reward queries, Merkle proofs
│   │   ├── admin.ts            # Admin endpoints (day management)
│   │   ├── pairing.ts          # 6-endpoint device pairing protocol
│   │   ├── tasks.ts            # On-demand AI task queue
│   │   ├── peers.ts            # P2P worker discovery & groups
│   │   └── data.ts             # Crawled data ingest from workers
│   └── tests/                  # API integration tests (supertest)
├── crypto/
│   ├── keys.ts                 # ML-DSA-65 keypair generation (via liboqs WASM)
│   ├── signing.ts              # Sign/verify with ML-DSA-65
│   ├── address.ts              # Address derivation: "ai4a" + hex(SHA256(pk)[0:20])
│   └── tests/
├── services/
│   ├── nodeService.ts          # Node lifecycle management
│   ├── workAssignmentService.ts# Block→node assignment logic
│   ├── submissionService.ts    # Work result submission handling
│   ├── dailyFinalizeService.ts # End-of-day reward calculation
│   ├── auditService.ts         # Audit trail queries
│   └── simulateDay.ts          # Full day orchestration (test harness)
├── persistence/
│   ├── eventBuilder.ts         # Domain event construction
│   ├── eventTypes.ts           # Event type definitions (incl. DEVICE_PAIRED)
│   ├── inMemoryStores.ts       # In-memory event/state stores
│   ├── persistDay.ts           # Day-level state persistence
│   ├── replayRunner.ts         # Event replay for state reconstruction
│   ├── stateProjection.ts      # State projection from events
│   └── canonicalSerialize.ts   # Deterministic JSON serialisation
├── merkle/
│   ├── merkleTree.ts           # SHA-256 Merkle tree implementation
│   └── rewardCommitment.ts     # Reward commitment proofs
├── types.ts                    # Core domain types (Contributor, Block, Reward)
├── computePoints.ts            # Compute point calculation
├── canaryGenerator.ts          # Honeypot anti-gaming system
├── blockAssignment.ts          # Weighted lottery block distribution
├── rewardDistribution.ts       # Reward distribution (floating-point)
├── rewardDistributionFixed.ts  # Reward distribution (fixed-point, mainnet)
└── fixedPoint.ts               # Bigint fixed-point arithmetic (1 token = 1M microunits)

worker/
├── src/
│   ├── main.rs                 # Entry point, command dispatch
│   ├── cli.rs                  # CLI args (run, pair, benchmark subcommands)
│   ├── config.rs               # TOML configuration
│   ├── pairing.rs              # Device pairing: keygen, QR display, poll, sign
│   ├── crawler.rs              # Background web crawler service
│   ├── coordinator/            # Server communication
│   ├── executor/               # Task execution engine
│   ├── backend/                # Compute backends (CPU, OpenAI-compat, crawler, mock)
│   ├── gpu/                    # GPU detection
│   ├── system/                 # Health checks, benchmarking
│   └── plugins/                # Plugin system
└── Cargo.toml
```

## Core Systems

### Cryptography (ML-DSA-65 / FIPS 204)

Post-quantum digital signatures used for wallet identity and device authentication.

- **Key sizes**: publicKey 1,952 bytes, secretKey 4,032 bytes, signature 3,309 bytes
- **Implementation**: `@openforge-sh/liboqs` (WASM) on backend/iOS, `pqcrypto-dilithium` on worker
- **Address format**: `ai4a` + 40 hex chars = 44 characters total

### Device Pairing Protocol

4-step protocol linking workers to wallets:

1. **Start** — Worker generates ML-DSA-65 keypair, sends public key to server
2. **Scan** — Phone scans QR (or enters short code), sees device info + 4-digit verification code
3. **Approve** — Phone signs approval with wallet's ML-DSA-65 key, server verifies
4. **Complete** — Worker signs challenge with device key, link is established

Safety: 5-min expiry, one-time use, verification code prevents scan-from-afar, rate limited to 10 pending sessions.

After pairing, workers authenticate with device signatures instead of plain nodeKeys.

### Reward Distribution

- **Base pool** (30%): Equal share among active contributors
- **Performance pool** (80%): Merit-based with sqrt diminishing returns
- **30-day rolling window**: Prevents incumbency advantage
- **Fixed-point arithmetic**: Bigint microunits (1 token = 1,000,000 microunits) for deterministic calculation
- **Canary system**: Honeypot blocks detect gaming, dynamic rehabilitation (no permanent bans)
- **Block assignment**: Weighted lottery, 2,200 blocks/day in batches of 5
- **Web crawler**: Workers autonomously crawl seed URLs and submit text/embeddings; rewarded per accepted page

### Event Sourcing & Persistence

All state changes recorded as domain events. Full state is reconstructable via replay. Merkle tree commitments provide cryptographic proof of reward distributions.

## Testing

```bash
npm test           # All 632 tests
npm run test:watch # Watch mode
npm run test:coverage
```

### Test Suites (30 total, 632 tests)

| Suite | Tests | Covers |
|-------|-------|--------|
| Canary System | 30 | Honeypot detection, reputation penalties |
| Compute Points | 45 | Point calculation, validation |
| Block Assignment | 33 | Weighted lottery, batch distribution |
| Reward Distribution | 49 | Floating-point rewards |
| Fixed-Point Arithmetic | 42 | Bigint math utilities |
| Fixed-Point Rewards | 22 | Mainnet reward integration |
| Dynamic Canary | 24 | Rehabilitation system |
| Merkle Tree | 8 | Tree construction, proofs |
| Reward Commitment | 5 | Commitment verification |
| Crypto | 6 | ML-DSA-65 keygen, sign, verify, address |
| API (nodes, work, admin, rewards) | 82 | REST endpoints, auth, validation |
| Device Pairing | 17 | Full 4-step flow, expiry, bad sigs, rate limits |
| Services | ~100 | Node, work assignment, submission, finalize, audit |
| Persistence | ~50 | Events, replay, serialization, projection |
| Simulate Day | 9 | End-to-end day orchestration |

## API Endpoints

### Nodes
- `POST /nodes/register` — Register contributor node
- `GET /nodes/:nodeId` — Get node status

### Work
- `POST /work/request` — Request work assignment (nodeKey or device auth)
- `POST /work/submit` — Submit completed work (nodeKey or device auth)

### Rewards
- `GET /rewards/proof` — Merkle proof for account reward
- `GET /rewards/root` — Merkle root for finalized day

### Admin
- `POST /admin/day/start` — Start new day
- `POST /admin/day/finalize` — Finalize current day

### Device Pairing
- `POST /pairing/start` — Worker initiates pairing session
- `GET /pairing/code/:code` — Resolve short code to pairing details
- `GET /pairing/:pairingId` — Get pairing session details
- `POST /pairing/approve` — Phone approves with wallet signature
- `GET /pairing/:pairingId/status` — Poll for approval status
- `POST /pairing/complete` — Worker completes with device signature

### Data Ingest
- `POST /data/crawled` — Worker submits crawled pages (ML-DSA-65 auth, deduplication, flat reward per page)
- `GET /data/crawled` — Query crawled pages (optional `?url=` prefix filter)
