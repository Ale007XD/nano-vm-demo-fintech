# nano-vm · Canonical Execution Runtime Demo

<p align="center">
  <a href="https://github.com/Ale007XD/nano_vm/actions">
    <img src="https://github.com/Ale007XD/nano_vm/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>
  <a href="https://pypi.org/project/llm-nano-vm/">
    <img src="https://img.shields.io/pypi/v/llm-nano-vm" alt="PyPI">
  </a>
  <img src="https://img.shields.io/badge/python-3.10+-blue" alt="Python">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
</p>

<p align="center">
  <strong>Deterministic Execution Collapse.</strong><br>
  10,000 stochastic execution attempts. 1 canonical graph accepted. 0 unauthorized side effects.
</p>

---

## Live Demo

→ **[demo.nano-vm.io](https://demo.nano-vm.io)**

Real packages. Real FSM. Real GovernanceEnvelope audit trail.

---

## The Core Invariant

```
δ(S, E) → S'
```

Where `S` is current execution state, `E` is a validated event, `S'` is the
next deterministic state.

**Only policy-valid transitions may mutate runtime state.**

The model does not control execution. The runtime does.

---

## What This Demo Shows

### Canonical Execution Resolution

```
Input:  10,000 possible execution graphs
Output: 1 canonical graph committed
        0 unauthorized side effects
        GOVERNANCE SEAL VERIFIED
```

This is not a metaphor. Every GovernanceEnvelope seals one accepted transition.
Every rejected path leaves no trace in state.

---

### Execution Pipeline

```
Browser / MCP Client
    ↓
FastAPI Gateway  (nano-vm-mcp role)
    ↓
GovernedRunProgramHandler
    ├── PolicySnapshot.tool_capabilities enforcement
    ├── DeterministicSanitizer (LLM/TRACE/TOOL projection)
    ├── ASTEngine condition evaluation (no eval())
    └── ExecutionVM (nano-vm FSM kernel)
         ↓
GovernanceEnvelope store
    ├── Merkle hash chain (canonical_snapshot_hash)
    ├── GDPR tombstoning (CapabilityRef → [REDACTED_TOMBSTONE])
    └── Append-only audit trail
```

Seven deterministic steps, executed in order, with no possibility of reordering,
skipping, or injection by the model or external input.

---

### FSM Transition Table

| Current state | Event | Next state |
|:---|:---|:---|
| `IDLE` | `E_run` | `RUNNING` |
| `RUNNING` | tool success | `RUNNING` |
| `RUNNING` | tool returns `"PENDING"` | `SUSPENDED` |
| `RUNNING` | tool error (`on_error=fail`) | `FAILED` |
| `RUNNING` | no more steps | `SUCCESS` |
| `SUCCESS` | any | `SUCCESS` (absorbing) |
| `FAILED` | any | `FAILED` (absorbing) |

Terminal states are absorbing. `δ(SUCCESS, *) = NOP`. Double-execution is
structurally impossible.

---

### GovernanceEnvelope

Each successful step produces an immutable `GovernanceEnvelope`:

| Field | Description |
|:---|:---|
| `execution_id` | Session identifier |
| `step_id` | Zero-based step index |
| `policy_hash` | SHA-256 of active `PolicySnapshot` |
| `canonical_snapshot_hash` | Merkle/delta hash (prev → current) |
| `payload` | TRACE-projected sanitized output |

The chain is append-only. No envelope can be modified after creation.

---

### Merkle Hash Chain

```
H_0 = "0000000000000000"  (genesis)

H_1 = SHA-256(H_0 ‖ step_id ‖ payload ‖ ts)
H_2 = SHA-256(H_1 ‖ step_id ‖ payload ‖ ts)
…
H_7 = merkle_root
```

Any modification to any prior step invalidates all subsequent hashes.
The `corrupt_hash` injector demonstrates this live.

---

### GDPR Tombstoning

Sensitive values are stored as `CapabilityRef` tokens:

```python
cap = CapabilityRef(ref_id="pi_test_abc123", salt=uuid4().hex)
state = StateContext(data={"payment_ref": cap}, step_outputs={})
```

On erasure:

```python
event = GdprEraseEvent(
    target_ref_ids=("pi_test_abc123",),
    reason="GDPR Art.17 right-to-erasure request",
)
new_state, count = vm.erase(event, state)
# new_state.data["payment_ref"].is_tombstone == True
# All projections → "[REDACTED_TOMBSTONE]"
# Hash chain: preserved
```

The secret disappears. The audit trail remains valid.

---

## FSM Chain Violation Injectors

The demo includes six live injectors, each demonstrating a different attack
vector that the runtime blocks:

| Injector | Attack | FSM Response |
|:---|:---|:---|
| `skip_step` | Force-skip `sanitize_text` | Violation recorded in audit trail |
| `corrupt_hash` | Inject invalid hash at `validate_config` | Chain broken — GovernanceEnvelope invalid |
| `double_exec` | Replay completed execution | `δ(SUCCESS, *) = NOP` — absorbed |
| `reorder_steps` | Permute step order | DSL order immutable — rejected |
| `tool_injection` | LLM calls `wire_transfer($50,000)` | Not in `PolicySnapshot.tool_capabilities` — `REJECTED`, side effects: 0 |
| `gdpr_erase` | GDPR Art.17 erasure | `CapabilityRef` tombstoned — `[REDACTED_TOMBSTONE]` |

### Tool Injection — the most important one

```python
# LLM attempts to call:
{"tool": "wire_transfer", "amount": 50000}

# Runtime response:
# GovernedToolExecutor: REJECTED
# Reason: wire_transfer not in PolicySnapshot.tool_capabilities
# Side effects: 0
# Audit trail: immutable
```

This is the enterprise-critical scenario. The LLM cannot call tools that
were not explicitly bound in the policy at session creation time. Capability
enforcement is structural, not prompt-based.

---

## Projection Layer

Every payload is sanitized before entering the audit trail:

```python
state = StateContext(data=payload, step_outputs={})
projected = sanitizer.project(state, ProjectionTarget.TRACE, policy=BANNER_POLICY)
```

Three projection targets:

| Target | Purpose |
|:---|:---|
| `LLM` | Redact sensitive fields before model sees them |
| `TRACE` | Canonical audit representation |
| `TOOL` | Clean payload for external tool calls |

---

## ASTEngine — No eval()

Condition expressions are evaluated by a sandboxed AST interpreter.
`eval()` is never used. No Python builtins are accessible.

```python
# ❌ WRONG — raises ASTEvalError at parse time (v0.7.5+)
{"condition": "'yes' in '$decision'.lower()"}

# ✅ CORRECT
{"condition": "'yes' in '$decision'"}
```

Supported operators: `==`, `!=`, `>`, `<`, `in`, `not in`, `and`, `or`,
`not`, `contains`, dotted-path `$var.field`.

---

## Performance

| Suite | Result |
|:---|:---|
| CI (179/179 tests) | 0 violations |
| MoMo Payment PoC v4 | 9/9 PASS |
| Stripe Payment PoC v1 | 9/9 PASS |
| FSM invariant stress (v0.6.0) | 1,020,000 ops · 0 violations |
| Integration benchmark (v0.7.3) | 1,096,500 ops · 0 violations |

### Integration benchmark detail

Environment: QEMU/KVM · Intel Xeon E5-2697A v4 · 2 cores · Python 3.12

| ID | Scenario | Mean TPS | p95 |
|:---|:---|---:|---:|
| BM-INT-01 | Refund pipeline | 2,300/s | 0.66 ms |
| BM-INT-02 | Double-execution guard | 2,400/s | 0.67 ms |
| BM-INT-03 | Budget enforcement | 1,100/s | 331 ms |
| BM-INT-04 | Parallel throughput | 436/s | 542 ms |
| BM-INT-05 | MCP store round-trip | 3,000/s | 0.42 ms |
| BM-INT-06 | GovernanceEnvelope | 1,300/s | 171 ms |
| BM-INT-07 | Crash consistency | 7/s | 233 ms |
| BM-INT-08 | Replay equivalence | 1,300/s | 1.30 ms |
| BM-INT-09 | Adversarial retries | 2,400/s | 0.64 ms |
| BM-INT-10 | Long-horizon | 30/s | 3,606 ms |

---

## Tech Stack

| Layer | Package | Role |
|:---|:---|:---|
| FSM kernel | `llm-nano-vm==0.7.5` | ExecutionVM, ASTEngine, ProjectionLayer |
| Gateway | FastAPI + uvicorn | MCP gateway role |
| PDF engine | reportlab | banner-pdf-engine contract |
| Payment | stripe-mock | Stripe REST API emulator |
| Audit store | in-memory + SSE | GovernanceEnvelope stream |

---

## Deploy

```bash
# Upload
scp deploy.sh main.py requirements.txt root@<VPS_IP>:/root/
scp static/index.html static/stripe-mock-adapter.js root@<VPS_IP>:/root/static/

# Run
ssh root@<VPS_IP> "chmod +x /root/deploy.sh && ./deploy.sh demo.yourdomain.com your@email.com"
```

Full deployment guide: [DEPLOY.md](./DEPLOY.md)

---

## Kernel Runtime

Core `llm-nano-vm` package: [github.com/Ale007XD/nano_vm](https://github.com/Ale007XD/nano_vm)

MCP Gateway: [github.com/Ale007XD/nano-vm-mcp](https://github.com/Ale007XD/nano-vm-mcp)

PyPI: [llm-nano-vm](https://pypi.org/project/llm-nano-vm/)

---

## License

MIT License.
