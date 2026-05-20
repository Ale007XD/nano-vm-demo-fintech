# nano-vm Banner Demo

<p align="center">
  <img src="https://img.shields.io/badge/llm--nano--vm-0.7.5-blue" alt="nano-vm">
  <img src="https://img.shields.io/badge/FSM-deterministic-green" alt="FSM">
  <img src="https://img.shields.io/badge/GovernanceEnvelope-Merkle--chain-purple" alt="Governance">
  <img src="https://img.shields.io/badge/GDPR-tombstoning-orange" alt="GDPR">
  <img src="https://img.shields.io/badge/license-MIT-lightgrey" alt="License">
</p>

**Live demo of a deterministic fintech runtime built on [llm-nano-vm](https://github.com/Ale007XD/nano_vm).**  
A 7-step PDF banner generation pipeline with Stripe mock, GovernanceEnvelope audit trail, SSE trace log, and 6 sabotage injectors.

🔗 **[demo.bannerbot.ru:8843](https://demo.bannerbot.ru:8843)**

---

## What the demo shows

This is not "LLM generates a file". This is a demonstration that **the runtime — not the model — controls execution**.

The program `banner_print_v1` runs exactly 7 steps in a strictly fixed order — regardless of what the LLM or any tool returns. Each step is sealed into a `GovernanceEnvelope`, the hash chain builds a Merkle tree. The result: a cryptographically verifiable audit trail from first byte to last.

---

## Pipeline

```
validate_config → sanitize_text → create_payment_intent
    → confirm_payment → render_banner → generate_pdf → governance_seal
```

| Step | Type | ~latency |
|---|---|---|
| `validate_config` | tool | <1 ms |
| `sanitize_text` | tool (DeterministicSanitizer) | <1 ms |
| `create_payment_intent` | tool (Stripe mock) | ~84 ms |
| `confirm_payment` | tool (Stripe mock) | ~55 ms |
| `render_banner` | tool (reportlab) | <2 ms |
| `generate_pdf` | tool (banner-pdf-engine) | ~20 ms |
| `governance_seal` | tool (Merkle finalization) | ~0.4 ms |

**Total: ~150 ms. PDF: 2 KB. GovernanceEnvelopes: 7. chain_valid: true.**

---

## Runtime guarantees

### Determinism and step order

The DSL program is compiled once. `ExecutionVM` executes steps in strict order with no possibility of reordering. Once the FSM reaches a terminal state (`SUCCESS`/`FAILED`) it becomes absorbing — re-execution is impossible without a new `execution_id`.

```
δ(S, E) → S'        — deterministic transition
δ(SUCCESS, *) → NOP — absorbing state
```

### Cryptographic audit trail

Every successful step produces a `GovernanceEnvelope`:

| Field | Description |
|---|---|
| `execution_id` | Session UUID |
| `step_id` | Step index |
| `policy_hash` | SHA-256 of the active PolicySnapshot |
| `canonical_snapshot_hash` | Merkle/delta hash of state at this step |
| `payload` | Sanitized step output |

Envelopes are written only on `error=None`. The Merkle root is finalized at the `governance_seal` step.

### ASTEngine (no eval)

Condition steps are evaluated by a sandboxed AST interpreter. `eval()` is fully removed from the production path. Supported operators: `==`, `!=`, `>`, `<`, `in`, `not in`, `and`, `or`, `not`, `contains`, dotted-path `$var.field`.

---

## Sabotage injectors

After a successful run, any of 6 attack vectors can be triggered from the UI:

| Injector | Attack target | VM response |
|---|---|---|
| `skip_step` | Skip a pipeline step | Rejected — DSL is immutable |
| `corrupt_hash` | Tamper with an envelope hash | Chain break → detected |
| `double_exec` | Re-run the same program | Absorbing state → NOP |
| `reorder_steps` | Reorder step execution | DSL locked at compile time |
| `tool_injection` | Wire transfer $50k outside policy | CapabilityDeniedError |
| `gdpr_erase` | Erase sensitive CapabilityRefs | Tombstoning + hash preserved |

> **Note:** Sabotage injectors are a scripted showcase, not live anomaly detection. Each injector is triggered by a UI button and demonstrates a specific protection mechanism.

---

## GDPR tombstoning

`gdpr_erase` erases two `CapabilityRef` tokens (`vault://secret/...`) without breaking the audit chain:

```
pre-erase:  canonical_hash = 941df9763bcba424
post-erase: canonical_hash = c740cd50a5f018b1
merkle_root: preserved     (535e8bd8676813e1)
policy_hash: unchanged     (4ea6a303e5ddad0f)
```

All subsequent projections return `[REDACTED_TOMBSTONE]`. The hash chain remains unbroken — Art.17 GDPR compliance without destroying the evidentiary record.

---

## Stripe layer

The demo uses **stripe-mock v0.189.0** (local binary, port 12111). The payment layer is intentionally simplified: the demo focuses on VM orchestration and governance, not on a complete payment lifecycle.

`confirm_payment` may return `succeeded: false` on the mock — the pipeline continues (demo behavior). In production, add a guard:

```python
if not result["succeeded"] and not USE_MOCK:
    raise RuntimeError(f"Payment failed: {result['status']}")
```

---

## Collapse Accumulator

The counter at the bottom of the UI shows real session statistics:

```
total_attempts: 7           ← accepted (GovernanceEnvelope) + rejected
accepted_steps: 7
policy_checks: 7
sabotage_blocks: 0          ← increments on tool_injection
side_effects_unauthorized: 0
```

Triggering `tool_injection` increments `sabotage_blocks`. A clean run shows honest 7/7.

---

## Architecture

```
Browser (SSE + POST)
  ↓  Handshake & Trigger
FastAPI (uvicorn)
  ↓
ExecutionVM
  ├─ PolicySnapshot (capability gate)
  ├─ DeterministicSanitizer (ASTEngine v0.7.5)
  ├─ GovernanceStore (append-only envelopes)
  └─ Stripe mock adapter
  ↓
GovernanceEnvelope chain → Merkle root
```

**SSE Handshake & Trigger:** the client generates `execution_id` via `crypto.getRandomValues`, opens the SSE connection, waits for `{type:'connected'}`, then sends POST `/api/run`. This guarantees no events are lost before the connection is established.

---

## Stack

| Component | Version |
|---|---|
| llm-nano-vm | 0.7.5 |
| FastAPI + uvicorn | latest |
| stripe-mock | 0.189.0 |
| reportlab | ≥4.1 |
| nginx (SSL) | system |
| Python | 3.10+ |

---

## Known limitations

- `GovernedToolExecutor` in nano-vm-mcp is **not implemented** — capability-gating is enforced at the demo VM level, not at the gateway layer
- `idempotency_store` is not implemented — inter-session duplicate risk if the process restarts after payment creation but before completion
- Stripe layer: mock-only, no webhook-driven state machine or Saga/compensating transactions
- `Step.allowed_outputs` and `Step.timeout_seconds` — Sprint 5, not yet implemented
- HTTP:80 does not redirect to :8444 (non-standard port — port 443 is occupied by amnezia-xray)

---

## Roadmap

- [ ] `GovernedToolExecutor` in gateway — real capability gate at the MCP server layer
- [ ] `idempotency_store` — inter-session exactly-once guarantee (Sprint 4 nano-vm-mcp)
- [ ] StateContext SQLite persistence — close the inter-session duplicate risk
- [ ] Stripe webhook-driven suspend/resume — `vm.run()` → `SUSPENDED` → `resume_with_program()`
- [ ] OpenTelemetry span per FSM step (Sprint 6)
- [ ] `Step.allowed_outputs` + `Step.timeout_seconds` (Sprint 5)
- [ ] PROGRAM_IPN_HANDLER DSL

---

## Contact

**Author:** [@ale007xd](https://t.me/ale007xd) · [@ale007xd](https://x.com/ale007xd)

[![Buy Me a Coffee](https://img.shields.io/badge/☕-Buy%20Me%20a%20Coffee-yellow?style=flat-square)](https://www.buymeacoffee.com/ale007xd)

---

## License

[MIT](LICENCE)
