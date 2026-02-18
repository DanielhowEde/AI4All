# P2P Worker Communication Layer

Inter-worker peer-to-peer communication enabling model sharding, task collaboration, and work coordination between Rust worker containers.

## Architecture

```
┌─────────────┐     WebSocket      ┌──────────────┐     WebSocket      ┌─────────────┐
│  Worker A    │◄──────────────────►│  Coordinator  │◄──────────────────►│  Worker B    │
│             │                    │  (discovery)  │                    │             │
│  PeerMesh   │◄── Direct TCP ────►│              │◄── Direct TCP ────►│  PeerMesh   │
│  Registry   │   (data plane)     │              │   (data plane)     │  Registry   │
│  Groups     │                    └──────────────┘                    │  Groups     │
└─────────────┘                                                        └─────────────┘
```

Workers discover each other via the coordinator, then establish direct TCP connections for low-latency data transfer (tensor shards, pipeline results, status).

## Delivered

### New Modules (`worker/src/peer/`)

| File | Purpose |
|------|---------|
| `mod.rs` | Module root, re-exports submodules |
| `registry.rs` | `PeerRegistry` — tracks known peers, capabilities, latency, staleness |
| `mesh.rs` | `PeerMesh` — TCP listener, outbound connections, length-prefixed JSON framing (64MB max), per-connection read/write tasks |
| `groups.rs` | `GroupManager` — work groups for model sharding (`ModelShard`) and task pipelines (`TaskPipeline`) |

### Modified Files

| File | Changes |
|------|---------|
| `protocol/messages.rs` | Added `PeerDiscover`, `PeerDirectory`, `GroupAssigned`, `GroupUpdate` to coordinator `Message` enum. Added `PeerMessage` enum (19 variants) for direct TCP communication: handshake, health, task collaboration, model sharding, pipeline, groups. Added `base64_bytes` serde helper for binary tensor data. |
| `config.rs` | Added `PeerSettings` struct (enabled, listen_port, max_peers, ping/stale timeouts, auto_connect) with env var overrides (`AI4ALL_PEER_*`) and TOML `[peer]` config section. |
| `coordinator/client.rs` | Added `PeerDirectory`, `PeerDiscovered`, `PeerLeft`, `GroupAssigned` variants to `ClientEvent`. Routes incoming peer discovery messages to the event channel. |
| `executor/state.rs` | Added `TaskSource` enum (`Coordinator` / `Peer { worker_id }`) to `ActiveTask` for tracking task origin. |
| `main.rs` | Added `mod peer;`. Initializes `PeerMesh`, `PeerRegistry`, `GroupManager`. Handles peer events in main `tokio::select!` loop. Auto-connects to discovered peers. Processes group assignments. Graceful mesh shutdown on exit. |
| `Cargo.toml` | Added `base64 = "0.22"` dependency. |

### Wire Protocol (Direct TCP)

- 4-byte big-endian length prefix + JSON payload
- Max message size: 64 MB (for tensor data)
- Binary data encoded as base64 within JSON
- Automatic ping/pong for connection health

### PeerMessage Types

| Category | Messages |
|----------|----------|
| Handshake | `Hello`, `HelloAck` |
| Health | `Ping`, `Pong`, `PeerStatus` |
| Task Collaboration | `TaskOffer`, `TaskAccept`, `TaskReject`, `TaskData`, `TaskResultForward` |
| Model Sharding | `ShardAssign`, `ShardReady`, `ShardInput`, `ShardOutput` |
| Pipeline | `PipelineInput`, `PipelineOutput` |
| Groups | `GroupJoin`, `GroupLeave`, `GroupSync` |

### Configuration

```toml
[peer]
enabled = true
listen_port = 0       # 0 = auto-assign
max_peers = 32
ping_interval_ms = 15000
stale_timeout_ms = 60000
auto_connect = true
```

Environment overrides: `AI4ALL_PEER_ENABLED`, `AI4ALL_PEER_PORT`, `AI4ALL_PEER_MAX_PEERS`

### Coordinator-Side REST API (`src/api/`)

Peer discovery and group management implemented as Express REST endpoints, following the existing `createXRouter(state: ApiState)` factory pattern.

#### New Files

| File | Purpose |
|------|---------|
| `routes/peers.ts` | `createPeersRouter` — 4 endpoints for peer registration, directory, heartbeat, deregistration |
| `routes/groups.ts` | `createGroupsRouter` — 5 endpoints for work group CRUD and membership queries |

#### Modified Files

| File | Changes |
|------|---------|
| `types.ts` | Added `PeerInfo`, `WorkerCapabilities`, `PeerRegisterRequest/Response`, `PeerDirectoryResponse`, `GroupPurposeType`, `GroupMemberInfo`, `WorkGroupInfo`, `GroupCreateRequest/Response`, `GroupListResponse`, error codes (`PEER_NOT_FOUND`, `GROUP_NOT_FOUND`, etc.) |
| `state.ts` | Added `peers: Map<string, PeerInfo>` and `workGroups: Map<string, WorkGroupInfo>` to `ApiState` |
| `app.ts` | Mounted `/peers` and `/groups` routers. Added peer/group counts to `/health` endpoint. |

#### Peer Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/peers/register` | nodeKey | Worker announces P2P listen address and capabilities. Returns deterministic `workerId` from `SHA256(accountId)`. |
| GET | `/peers/directory?exclude=<id>` | none | Returns all registered peers. Optional `exclude` param to omit self. |
| POST | `/peers/heartbeat` | none | Worker updates `lastSeen` timestamp to prevent stale pruning. |
| DELETE | `/peers/:workerId` | none | Deregisters peer and removes from all work groups. |

#### Group Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/groups/create` | admin | Creates a work group with purpose (`MODEL_SHARD` / `TASK_PIPELINE` / `GENERAL`), assigns workers. First worker is coordinator. Auto-assigns `shardIndex` or `pipelineStage`. |
| GET | `/groups` | admin | Lists all active work groups. |
| GET | `/groups/mine?workerId=<id>` | none | Worker queries which groups it belongs to. |
| GET | `/groups/:groupId` | none | Get details of a specific work group. |
| DELETE | `/groups/:groupId` | admin | Dissolves a work group. |

## Still To Do

### Model Sharding End-to-End
- [ ] Shard assignment logic — given a model and N workers, determine tensor partition strategy
- [ ] `ShardInput`/`ShardOutput` pipeline execution — actually loading model layers and forwarding activations
- [ ] Memory-aware shard placement (use worker capabilities to decide shard sizes)
- [ ] Fault tolerance — handle a shard worker disconnecting mid-inference

### Task Pipeline End-to-End
- [ ] Pipeline stage definition and registration
- [ ] `PipelineInput`/`PipelineOutput` routing between stages
- [ ] Backpressure handling when downstream stages are slower
- [ ] Pipeline stage failure and retry logic

### Task Collaboration
- [ ] `TaskOffer`/`TaskAccept`/`TaskReject` negotiation logic (load-based work stealing)
- [ ] `TaskData` streaming for large inputs
- [ ] `TaskResultForward` — route peer task results back to the coordinator
- [ ] Integration with `TaskSource::Peer` in executor to properly attribute and return results

### Security
- [ ] Peer authentication — verify worker identity on TCP connections (TLS or signed handshake)
- [ ] Message signing/verification for `PeerMessage` payloads
- [ ] Rate limiting on incoming peer connections

### Resilience
- [ ] Reconnection logic for dropped peer TCP connections
- [ ] Stale peer pruning timer in the main event loop
- [ ] Graceful group reformation when a member disconnects
- [ ] Coordinator-assisted peer re-discovery after network partition

### Testing
- [ ] Unit tests for `PeerMesh` TCP framing (loopback)
- [ ] Integration tests for peer discovery flow (mock coordinator)
- [ ] Integration tests for model shard group formation
- [ ] Load tests for tensor data throughput over TCP mesh

### Build Environment
- [ ] Windows SDK needs to be installed for MSVC compilation (`kernel32.lib` missing)
- [ ] Alternatively, configure the GNU toolchain with `dlltool` for Windows builds
