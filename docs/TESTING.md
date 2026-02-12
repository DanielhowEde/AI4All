# Testing Guide — AI4All Wallet & Cryptocurrency

Instructions for running and writing tests across all three codebases.

## Prerequisites

| Component | Requirement |
|-----------|-------------|
| Backend | Node.js 20+, npm |
| Worker | Rust 1.75+, cargo |
| iOS Wallet | Xcode 15+, iOS 17 SDK |

## 1. Backend Tests (TypeScript / Jest)

### Run All Tests

```bash
cd h:\repos\AIForAll
npm test
```

Output: **28 suites, 552 tests** (runs in ~10 seconds).

### Run a Specific Suite

```bash
# By filename
npm test -- --testPathPattern pairing
npm test -- --testPathPattern crypto
npm test -- --testPathPattern simulateDay

# By describe block name
npm test -- -t "sign / verify"
npm test -- -t "/pairing endpoints"
```

### Watch Mode (re-runs on file save)

```bash
npm run test:watch
```

### Coverage Report

```bash
npm run test:coverage
```

Coverage thresholds (enforced in `jest.config.js`): 80% branches, functions, lines, statements.

### Test Suite Map

| Suite | File | What It Tests |
|-------|------|---------------|
| **Crypto** | `src/crypto/tests/crypto.test.ts` | ML-DSA-65 keygen, sign, verify, address derivation, hex round-trip |
| **Device Pairing** | `src/api/tests/pairing.test.ts` | Full 4-step pairing flow, expiry, bad sigs, rate limiting |
| **Work API** | `src/api/tests/work.test.ts` | Work request/submit with nodeKey and device-signature auth |
| **Nodes API** | `src/api/tests/nodes.test.ts` | Node registration, status queries |
| **Rewards API** | `src/api/tests/rewards.test.ts` | Merkle proofs, reward queries |
| **Admin API** | `src/api/tests/admin.test.ts` | Day start/finalize |
| **Integration** | `src/api/tests/integration.test.ts` | Multi-endpoint flows |
| **Simulate Day** | `src/services/simulateDay.test.ts` | Full day orchestration: assign → submit → reward → verify |
| **Reward Distribution** | `src/rewardDistribution.test.ts` | Base + performance pool (floating-point) |
| **Fixed-Point Rewards** | `src/rewardDistributionFixed.test.ts` | Bigint microunit rewards (mainnet) |
| **Fixed-Point Arithmetic** | `src/fixedPoint.test.ts` | Bigint math utilities |
| **Block Assignment** | `src/blockAssignment.test.ts` | Weighted lottery, batch distribution |
| **Canary System** | `src/canaryGenerator.test.ts` | Honeypot detection, reputation penalties |
| **Dynamic Canary** | `src/dynamicCanary.test.ts` | Rehabilitation, rate adjustment |
| **Compute Points** | `src/computePoints.test.ts` | Point calculation logic |
| **Merkle Tree** | `src/merkle/tests/merkleTree.test.ts` | SHA-256 Merkle tree construction and verification |
| **Reward Commitment** | `src/merkle/tests/rewardCommitment.test.ts` | Cryptographic reward proofs |
| **Persistence** | `src/persistence/tests/*.test.ts` | Events, replay, serialization, projection, persist day |
| **Services** | `src/services/*.test.ts` | Node, work assignment, submission, finalize, audit |

### How the Crypto Mock Works

The real `@openforge-sh/liboqs` is an ESM-only WASM module that Jest cannot load directly. The file `__mocks__/@openforge-sh/liboqs.ts` provides an HMAC-based stand-in:

- `generateKeyPair()` creates a random 32-byte HMAC key, embeds it at offset 0 of both the public key (1952 bytes) and secret key (4032 bytes)
- `sign(message, secretKey)` computes `HMAC-SHA256(sk[0:32], message)`, padded to 3309 bytes
- `verify(message, signature, publicKey)` recomputes with `pk[0:32]` and compares

This is **not real post-quantum crypto** — it only provides sign/verify consistency for test assertions. The `moduleNameMapper` in `jest.config.js` redirects `@openforge-sh/liboqs` to this mock.

### Writing a New Backend Test

All tests follow the same pattern:

```typescript
import request from 'supertest';
import { createApp } from '../app';
import { createApiState } from '../state';
import { createInMemoryStores } from '../../persistence/inMemoryStores';

describe('my feature', () => {
  let state: ReturnType<typeof createApiState>;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    const stores = createInMemoryStores();
    state = createApiState(stores);
    app = createApp(state);
  });

  it('should do something', async () => {
    const res = await request(app)
      .post('/some/endpoint')
      .send({ key: 'value' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
```

Key conventions:
- Each test suite creates fresh in-memory state in `beforeEach`
- Crypto keypairs are generated once in `beforeAll` (WASM init is slow) with a 30–60s timeout
- All state is in-memory Maps — no database, no filesystem, no network
- Tests are deterministic: seeded RNG, fixed timestamps

### Testing the Pairing Protocol (Backend)

The pairing test (`src/api/tests/pairing.test.ts`) runs the full 4-step flow:

1. **Generate keys** in `beforeAll`: one wallet keypair + one device keypair
2. **Start**: `POST /pairing/start` with device public key hex
3. **Approve**: build signature payload `"AI4A:PAIR:APPROVE:v1" + pairingId + timestamp + nonce`, sign with wallet secret key, `POST /pairing/approve`
4. **Poll**: `GET /pairing/:id/status` to get challenge
5. **Complete**: sign challenge with device secret key, `POST /pairing/complete`

Security tests verify: wrong wallet key rejected, tampered signature rejected, expired session rejected, wrong device key rejected, rate limiting enforced.

---

## 2. Worker Tests (Rust / Cargo)

### Run All Tests

```bash
cd h:\repos\AIForAll\worker
cargo test
```

### Run a Specific Test

```bash
cargo test test_full_config_workflow
cargo test test_startup_time
```

### Test Files

| File | What It Tests |
|------|---------------|
| `tests/cli_tests.rs` | CLI argument parsing, subcommand routing |
| `tests/config_tests.rs` | TOML config parsing, validation, defaults |
| `tests/integration_tests.rs` | End-to-end: config workflow, log creation, storage dirs, error codes, startup time, concurrency |

### Integration Tests

The integration tests use `assert_cmd` to run the worker binary and check:

- Config show/validate commands
- Benchmark runs
- Error exit codes (code 10 for config errors)
- Startup time < 1 second
- Config parse time < 500ms
- Concurrent config reads (4 threads)

Each test uses a `TestEnvironment` struct that creates a temporary directory with a test config.

### Testing the Pairing Module

The pairing module (`src/pairing.rs`) currently requires a running backend server for integration testing. To test manually:

```bash
# Terminal 1: Start the backend
cd h:\repos\AIForAll
npm run start:api

# Terminal 2: Run worker pairing
cd h:\repos\AIForAll\worker
cargo run -- pair --api-url http://localhost:3000 --name "Test Worker"
```

The worker will:
1. Generate an ML-DSA-65 keypair (saved to `~/.ai4all/worker/`)
2. Display a QR code as ASCII art + short code + verification code
3. Poll `/pairing/:id/status` every 2 seconds for up to 5 minutes
4. When approved, sign the challenge and complete the link

---

## 3. iOS Wallet Tests (Swift / XCTest)

### Run from Xcode

1. Open `h:\repos\AI4AllWallet\AI4AllWallet.xcodeproj`
2. Select the `AI4AllWalletTests` scheme
3. Press `Cmd+U` to run all tests

### Run from Command Line

```bash
cd h:\repos\AI4AllWallet
xcodebuild test \
  -scheme AI4AllWallet \
  -destination 'platform=iOS Simulator,name=iPhone 15' \
  -resultBundlePath TestResults
```

### Test Files

| File | What It Tests |
|------|---------------|
| `CryptoTests/AddressDerivationTests.swift` | `ai4a` prefix, 44-char length, determinism, cross-platform SHA-256 vector |
| `CryptoTests/TokenAmountTests.swift` | Microunit/token conversion, display formatting, arithmetic, Codable |
| `CryptoTests/DataHexTests.swift` | Data ↔ hex string conversion |
| `CryptoTests/MerkleVerifierTests.swift` | Merkle proof verification |
| `NetworkingTests/APIClientTests.swift` | Reward fetch, proof fetch, HTTP error handling (via `MockURLProtocol`) |

### Cross-Platform Test Vectors

The address derivation test verifies the same algorithm across backend and iOS:

```
Input:  1952 bytes of 0x42
Output: "ai4a" + hex(SHA256(input)[0:20])
```

Both `AddressDerivationTests.swift` and `src/crypto/tests/crypto.test.ts` use this formula. If you change the address derivation algorithm, update both test suites.

### Writing a New iOS Test

API tests use `MockURLProtocol` to intercept HTTP calls:

```swift
func testMyEndpoint() async throws {
    let json = """
    {"key": "value"}
    """
    MockURLProtocol.mockResponse(data: json.data(using: .utf8)!, statusCode: 200)

    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [MockURLProtocol.self]
    let session = URLSession(configuration: config)
    let client = APIClient(session: session)

    let result = try await client.myMethod()
    XCTAssertEqual(result.key, "value")
}
```

---

## 4. Manual End-to-End Testing

### Full Day Cycle (Backend Only)

```bash
# Start the API server
npm run start:api

# Register two nodes
curl -X POST http://localhost:3000/nodes/register \
  -H "Content-Type: application/json" \
  -d '{"accountId":"alice","nodeKey":"key-alice"}'

curl -X POST http://localhost:3000/nodes/register \
  -H "Content-Type: application/json" \
  -d '{"accountId":"bob","nodeKey":"key-bob"}'

# Start a new day
curl -X POST http://localhost:3000/admin/day/start \
  -H "x-admin-key: admin"

# Request work for alice
curl -X POST http://localhost:3000/work/request \
  -H "Content-Type: application/json" \
  -d '{"accountId":"alice","nodeKey":"key-alice"}'

# Submit work results (use blockId from request response)
curl -X POST http://localhost:3000/work/submit \
  -H "Content-Type: application/json" \
  -d '{"accountId":"alice","nodeKey":"key-alice","blockId":"<id>","result":"done","validationPassed":true}'

# Finalize the day (triggers reward calculation)
curl -X POST http://localhost:3000/admin/day/finalize \
  -H "x-admin-key: admin"

# Check rewards
curl "http://localhost:3000/rewards/proof?dayId=1&accountId=alice"
curl "http://localhost:3000/rewards/root?dayId=1"
```

### Device Pairing (3-Way Manual Test)

Requires: backend running, worker binary built, iOS app on simulator/device.

```
Step 1 — Worker starts pairing:
  $ ai4all-worker pair --api-url http://localhost:3000 --name "My GPU Rig"
  → Shows QR code + short code (e.g. K7F9-M2Q4) + verification code (e.g. 4827)

Step 2 — iOS app scans:
  Settings → Link Worker → [scan QR or enter K7F9-M2Q4]
  → Shows device name + capabilities + verification code 4827
  → User confirms verification code matches worker terminal

Step 3 — iOS app approves:
  Tap "Approve" → wallet signs with ML-DSA-65 → server verifies

Step 4 — Worker completes:
  Worker sees "APPROVED", signs challenge → server verifies device key
  → Terminal prints: "Paired successfully! Device ID: dev_..."
  → Saves identity.json to ~/.ai4all/worker/
```

After pairing, the worker can authenticate work submissions with its device key instead of a plain nodeKey.

### Pairing Failure Scenarios to Test

| Scenario | Expected Result |
|----------|----------------|
| Enter wrong short code on phone | 404 — "Code not found" |
| Wait > 5 minutes before approving | 410 — "Pairing expired" |
| Approve with a different wallet | 403 — "Address mismatch" |
| Complete with wrong device key | 403 — "Device signature invalid" |
| Create > 10 pending pairings | 429 — "Rate limited" |
| Try to complete before approval | 409 — "Invalid state" |

---

## 5. Token Arithmetic Consistency

The system uses **1 token = 1,000,000 microunits** (bigint on backend, Int64 on iOS).

Test vectors to verify cross-platform:

| Tokens | Microunits | Display |
|--------|-----------|---------|
| 0 | 0 | "0.00" |
| 1.00 | 1,000,000 | "1.00" |
| 1.50 | 1,500,000 | "1.50" |
| 0.12 | 123,456 | "0.12" |
| 22,000.00 | 22,000,000,000 | "22000.00" |

Backend: `fixedPoint.ts` uses `bigint` arithmetic.
iOS: `TokenAmount` struct with `Int64` microunits.

---

## 6. Continuous Integration

### Backend CI (GitHub Actions example)

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 20
- run: npm ci
- run: npm test
- run: npm run test:coverage
- run: npx tsc --noEmit
```

### Worker CI

```yaml
- uses: actions-rs/toolchain@v1
  with:
    toolchain: stable
- run: cargo test --manifest-path worker/Cargo.toml
- run: cargo clippy --manifest-path worker/Cargo.toml -- -D warnings
```

### iOS CI

```yaml
- run: xcodebuild test \
    -project AI4AllWallet.xcodeproj \
    -scheme AI4AllWallet \
    -destination 'platform=iOS Simulator,name=iPhone 15'
```
