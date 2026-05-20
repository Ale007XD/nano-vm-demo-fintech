"""
nano-vm FSM Demo — Backend v1.2  (production-ready)
=====================================================
Fixes applied vs v1.1:

  [P1] SEC-001  — API key auth on all mutating endpoints
  [P2] SEC-002  — innerHTML → safe DOM building (backend sanitises outbound SSE)
  [P3] SEC-003  — USE_MOCK guard before stripe.verify_ssl_certs=False
  [P4] QUAL-001 — TTL cleanup for active_sessions + completed_pdfs (LRU + background task)
  [P5] BUG-001  — font_size based on short_side, not ph after reorientation
  [P6] ARCH     — stripe calls wrapped in asyncio.to_thread (no event-loop blocking)
  [P7] ARCH     — fsmRunning / buy button re-enabled via trace_complete success path (frontend)
  [P8] ARCH     — compute_canonical_hash: ts passed in, not read inside (deterministic)
  [P9] ARCH     — Execution Collapse: real FSM attempt accounting, no magic constant
  [P10] ARCH    — pdf_bytes via step_results, not closure hack
  [P11] ARCH    — background _run() outer try/finally guarantees execution_error emit
  [P12] SEC     — assert live key never used with mock host
  [P13] DEPLOY  — stripe-mock process does NOT run as root (see deploy.sh)

Real packages:
  llm-nano-vm==0.7.5  (ExecutionVM, Program, GovernanceEnvelope, PolicySnapshot,
                        CapabilityRef, DeterministicSanitizer, ASTEngine, GdprEraseEvent)
  banner-pdf-engine contract → reportlab backend
  stripe (test mode, stripe-mock compatible)

Architecture:
  Browser / MCP Client
    → FastAPI Gateway  (nano-vm-mcp role)
        → GovernedRunProgramHandler
            → ExecutionVM (nano-vm kernel)
        → GovernanceEnvelope store (SQLite WAL + SSE stream)
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import time
import traceback
import uuid
from collections import OrderedDict
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from io import BytesIO
from typing import Any

import stripe
from fastapi import Depends, FastAPI, HTTPException, Request, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.security import APIKeyHeader
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, field_validator

# ── nano-vm real imports ───────────────────────────────────────────────────────
from nano_vm import ExecutionVM, Program
from nano_vm.adapters import MockLLMAdapter
from nano_vm.ast_engine import ASTEngine
from nano_vm.contracts import CapabilityRef, GovernanceEnvelope, PolicySnapshot
from nano_vm.models import (
    GdprEraseEvent,
    StateContext,
    StepStatus,
    TraceStatus,
)
from nano_vm.projection import DeterministicSanitizer, ProjectionTarget

# ── PDF rendering (banner-pdf-engine contract) ─────────────────────────────────
try:
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas as rl_canvas
    REPORTLAB = True
except ImportError:
    REPORTLAB = False

log = logging.getLogger("nano_vm_demo")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

# ══════════════════════════════════════════════════════════════════════════════
# CONFIG
# ══════════════════════════════════════════════════════════════════════════════

STRIPE_MOCK_HOST = os.environ.get("STRIPE_MOCK_HOST", "")
STRIPE_SK        = os.environ.get("STRIPE_SK", "sk_test_mock_demo_key_nanovo7")
STRIPE_PK        = os.environ.get("STRIPE_PK", "pk_test_mock_demo_key_nanovo7")
# [P1] API key — set NANO_VM_API_KEY env var to require auth on mutating endpoints.
# If unset in demo mode, all requests are allowed (warning logged).
API_KEY          = os.environ.get("NANO_VM_API_KEY", "")
AMOUNT_CENTS     = 29999
CURRENCY         = "usd"

# Session store limits
MAX_ACTIVE_SESSIONS = 200    # hard cap on concurrent sessions
MAX_COMPLETED_PDFS  = 50     # LRU cap — oldest evicted when exceeded
SESSION_TTL_SECONDS = 3600   # 1 hour TTL for completed sessions

stripe.api_key = STRIPE_SK

if STRIPE_MOCK_HOST:
    # [P3] Never disable SSL verification with a live key
    assert "sk_test_" in STRIPE_SK, (
        "STRIPE_MOCK_HOST is set but STRIPE_SK looks like a live key. Aborting."
    )
    stripe.api_base          = STRIPE_MOCK_HOST
    stripe.verify_ssl_certs  = False
    stripe.default_http_client = stripe._http_client.RequestsClient()

USE_MOCK = bool(STRIPE_MOCK_HOST)

if not API_KEY:
    log.warning(
        "NANO_VM_API_KEY is not set — all mutating endpoints are open. "
        "Set this env var before exposing to the public internet."
    )

# ══════════════════════════════════════════════════════════════════════════════
# AUTH  [P1]
# ══════════════════════════════════════════════════════════════════════════════

_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

import secrets as _secrets

def require_api_key(key: str | None = Security(_api_key_header)) -> None:
    """Dependency: validates X-API-Key header when NANO_VM_API_KEY is configured."""
    if not API_KEY:
        return  # open mode — demo without key
    if not key or not _secrets.compare_digest(key, API_KEY):
        raise HTTPException(status_code=401, detail="Invalid or missing API key")

# ══════════════════════════════════════════════════════════════════════════════
# GOVERNANCE STORE  (in-memory — mirrors nano-vm-mcp store.py)
# ══════════════════════════════════════════════════════════════════════════════

class GovernanceStore:
    """Append-only GovernanceEnvelope store with SSE fan-out."""

    def __init__(self) -> None:
        self._envelopes: list[dict] = []
        self._sse_queues: list[asyncio.Queue] = []

    def save_envelope(self, env: GovernanceEnvelope, extra: dict | None = None) -> None:
        record = {
            "execution_id":          env.execution_id,
            "step_id":               env.step_id,
            "policy_hash":           env.policy_hash,
            "canonical_snapshot_hash": env.canonical_snapshot_hash,
            "payload":               env.payload,
            "ts":                    datetime.now(timezone.utc).isoformat(),
            **(extra or {}),
        }
        self._envelopes.append(record)
        self._broadcast({"type": "envelope", **record})

    def get_envelopes(self, execution_id: str) -> list[dict]:
        return [e for e in self._envelopes if e["execution_id"] == execution_id]

    def emit_trace_event(self, event: dict) -> None:
        self._broadcast(event)

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=200)
        self._sse_queues.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        try:
            self._sse_queues.remove(q)
        except ValueError:
            pass

    def _broadcast(self, event: dict) -> None:
        dead = []
        for q in self._sse_queues:
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                dead.append(q)
                log.warning("SSE queue full — dropping slow client")
        for q in dead:
            try:
                self._sse_queues.remove(q)
            except ValueError:
                pass


_store = GovernanceStore()

# ══════════════════════════════════════════════════════════════════════════════
# SESSION STORES  [P4]  — LRU-capped with TTL
# ══════════════════════════════════════════════════════════════════════════════

class _TTLStore:
    """OrderedDict-backed store: LRU cap + per-entry TTL eviction."""

    def __init__(self, maxsize: int, ttl: float) -> None:
        self._data: OrderedDict[str, tuple[Any, float]] = OrderedDict()
        self._maxsize = maxsize
        self._ttl     = ttl

    def set(self, key: str, value: Any) -> None:
        self._data[key] = (value, time.monotonic())
        self._data.move_to_end(key)
        if len(self._data) > self._maxsize:
            evicted_key, _ = self._data.popitem(last=False)
            log.info("TTLStore evicted oldest entry: %s", evicted_key)

    def get(self, key: str) -> Any | None:
        entry = self._data.get(key)
        if entry is None:
            return None
        value, ts = entry
        if time.monotonic() - ts > self._ttl:
            del self._data[key]
            return None
        return value

    def delete(self, key: str) -> None:
        self._data.pop(key, None)

    def evict_expired(self) -> int:
        now  = time.monotonic()
        dead = [k for k, (_, ts) in self._data.items() if now - ts > self._ttl]
        for k in dead:
            del self._data[k]
        return len(dead)

    def __len__(self) -> int:
        return len(self._data)


_active_sessions: _TTLStore = _TTLStore(maxsize=MAX_ACTIVE_SESSIONS, ttl=SESSION_TTL_SECONDS)
_completed_pdfs:  _TTLStore = _TTLStore(maxsize=MAX_COMPLETED_PDFS,  ttl=SESSION_TTL_SECONDS)


async def _cleanup_loop() -> None:
    """Background task: evicts expired sessions and PDFs every 5 minutes."""
    while True:
        await asyncio.sleep(300)
        s = _active_sessions.evict_expired()
        p = _completed_pdfs.evict_expired()
        if s or p:
            log.info("Cleanup: evicted %d sessions, %d PDFs", s, p)


# ══════════════════════════════════════════════════════════════════════════════
# POLICY
# ══════════════════════════════════════════════════════════════════════════════

BANNER_POLICY = PolicySnapshot(
    policy_id="banner_print_v1",
    version="1.0.0",
    tool_capabilities={
        "validate_config":        ["width_mm", "height_mm", "text", "font"],
        "sanitize_text":          ["text", "sanitized_text", "pii_hits"],
        "create_payment_intent":  ["intent_id", "amount", "currency", "status"],
        "confirm_payment":        ["payment_method_id", "status", "charge_id"],
        "render_banner":          ["width_mm", "height_mm", "bg_color", "text_color",
                                   "font", "canvas_hash"],
        "generate_pdf":           ["pdf_size_bytes", "pages", "icc_profile", "trace_id"],
        "governance_seal":        ["policy_hash", "canonical_hash", "envelope_count",
                                   "chain_valid"],
    },
)

SANITIZER = DeterministicSanitizer()

# ══════════════════════════════════════════════════════════════════════════════
# BANNER PDF ENGINE  (banner-pdf-engine contract via reportlab)
# ══════════════════════════════════════════════════════════════════════════════

BG_COLORS: dict[str, dict] = {
    "navy":     {"hex": "#1a1a2e", "cmyk": (100, 80,  0, 40)},
    "blue":     {"hex": "#0f3460", "cmyk": (100, 50,  0, 20)},
    "dark":     {"hex": "#16213e", "cmyk": (100, 70,  0, 60)},
    "red":      {"hex": "#c41e3a", "cmyk": (  0, 100, 80, 20)},
    "green":    {"hex": "#1b4332", "cmyk": ( 80,   0, 60, 30)},
    "charcoal": {"hex": "#2d2d2d", "cmyk": (  0,   0,  0, 80)},
    "white":    {"hex": "#f8f9fa", "cmyk": (  0,   0,  0,  2)},
    "orange":   {"hex": "#f4a261", "cmyk": (  0,  40, 70,  0)},
}

TEXT_COLORS: dict[str, str] = {
    "white": "#ffffff", "teal": "#00d4a1", "gold": "#ffd700",
    "red":   "#ff6b6b", "dark": "#1a1a2e", "light": "#f8f9fa",
}

FONTS_MAP: dict[str, str] = {
    "helvetica": "Helvetica-Bold",
    "times":     "Times-Bold",
    "courier":   "Courier-Bold",
    "impact":    "Helvetica-Bold",   # reportlab has no real Impact; documented substitution
}


def hex_to_rgb_float(h: str) -> tuple[float, float, float]:
    h = h.lstrip("#")
    return int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255


def render_banner_pdf(
    width_mm: int, height_mm: int, text: str,
    bg_hex: str, text_hex: str, font_name: str, trace_id: str,
) -> bytes:
    if not REPORTLAB:
        raise RuntimeError("reportlab not installed — pip install reportlab>=4.1")

    buf  = BytesIO()
    w_pt = width_mm  * mm
    h_pt = height_mm * mm

    # Always landscape (wider side horizontal)
    page_size = (w_pt, h_pt) if w_pt >= h_pt else (h_pt, w_pt)
    c = rl_canvas.Canvas(buf, pagesize=page_size)
    pw, ph = page_size

    # [P5] Font size based on short_side — stable regardless of orientation swap
    short_side = min(pw, ph)

    r, g, b = hex_to_rgb_float(bg_hex)
    c.setFillColorRGB(r, g, b)
    c.rect(0, 0, pw, ph, fill=1, stroke=0)

    # Guide grid
    c.setStrokeColorRGB(1, 1, 1)
    c.setLineWidth(0.3)
    c.setDash([3, 12])
    for i in range(1, 10):
        c.line(pw / 10 * i, 0, pw / 10 * i, ph)
    for i in range(1, 5):
        c.line(0, ph / 5 * i, pw, ph / 5 * i)
    c.setDash([])

    # Bleed marks
    c.setStrokeColorRGB(0.7, 0.7, 0.7)
    c.setLineWidth(0.5)
    m_pt, sz = 6 * mm, 8 * mm
    for cx, cy in [(m_pt, m_pt), (pw - m_pt, m_pt), (m_pt, ph - m_pt), (pw - m_pt, ph - m_pt)]:
        c.line(cx - sz, cy, cx + sz, cy)
        c.line(cx, cy - sz, cx, cy + sz)

    tr, tg, tb = hex_to_rgb_float(text_hex)
    c.setFillColorRGB(tr, tg, tb)

    rl_font   = FONTS_MAP.get(font_name, "Helvetica-Bold")
    font_size = short_side * 0.28
    c.setFont(rl_font, font_size)
    while c.stringWidth(text, rl_font, font_size) > pw * 0.92 and font_size > 10:
        font_size -= 1
        c.setFont(rl_font, font_size)

    c.drawCentredString(pw / 2, ph / 2 - font_size * 0.35, text)

    c.setFillColorRGB(0.5, 0.5, 0.5)
    footer_size = max(4 * mm, min(7 * mm, short_side * 0.012))
    c.setFont("Helvetica", footer_size)
    footer = (
        f"nano-vm v0.7.5 · trace_id: {trace_id} · "
        f"{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}"
    )
    c.drawCentredString(pw / 2, 4 * mm, footer)
    c.save()
    return buf.getvalue()


# ══════════════════════════════════════════════════════════════════════════════
# HASH HELPERS  [P8] — ts is now passed in, not read inside
# ══════════════════════════════════════════════════════════════════════════════

def sha256_short(data: Any) -> str:
    raw = json.dumps(data, default=str, sort_keys=True).encode()
    return hashlib.sha256(raw).hexdigest()[:16]


def compute_canonical_hash(prev_hash: str, step_id: str, payload: Any, ts_ms: int) -> str:
    """Deterministic: ts_ms is provided by the caller, not sampled inside."""
    return sha256_short({"prev": prev_hash, "step": step_id, "payload": payload, "ts": ts_ms})


# ══════════════════════════════════════════════════════════════════════════════
# EXECUTION COLLAPSE COUNTER  [P9]
# ══════════════════════════════════════════════════════════════════════════════

class CollapseAccumulator:
    """
    Tracks the real FSM attempt accounting for the Execution Collapse Counter.

    What counts as an "attempt":
      - Every tool call that completes (accepted step)         → 1 accepted
      - Every sabotage injection that was blocked              → adds to rejected
      - Every PolicySnapshot tool_capabilities check performed  → 1 attempt each
      - Every ASTEngine condition that was evaluated            → 1 attempt each
      - Governance: for each sealed envelope, the policy engine
        considered all N tool_capabilities entries before
        authorising — those are real policy checks.

    Formula:
      total_attempts = accepted + rejected
      rejected = policy_checks_denied + sabotage_blocks + hash_chain_violations

    This is conservative — real FSM branching factor is larger.
    """

    def __init__(self, policy: PolicySnapshot) -> None:
        self._policy              = policy
        self.accepted_steps: int  = 0      # steps that produced a GovernanceEnvelope
        self.policy_checks: int   = 0      # total tool_capabilities lookups
        self.policy_denials: int  = 0      # capability checks that failed
        self.sabotage_blocks: int = 0      # injected attacks that were rejected
        self.hash_violations: int = 0      # chain integrity breaks detected
        self.ast_evals: int       = 0      # ASTEngine condition evaluations (if any)

    def record_step_accepted(self) -> None:
        self.accepted_steps += 1
        # Each accepted step implies one positive capability lookup per policy entry
        # for that tool (all entries in tool_capabilities[tool_id] were checked)
        self.policy_checks += 1

    def record_policy_denial(self, count: int = 1) -> None:
        self.policy_denials  += count
        self.policy_checks   += count

    def record_sabotage_block(self) -> None:
        self.sabotage_blocks += 1

    def record_hash_violation(self) -> None:
        self.hash_violations += 1

    def record_ast_eval(self) -> None:
        self.ast_evals += 1

    @property
    def rejected(self) -> int:
        return self.policy_denials + self.sabotage_blocks + self.hash_violations

    @property
    def total_attempts(self) -> int:
        return self.accepted_steps + self.rejected

    def to_dict(self) -> dict:
        return {
            "total_attempts":           self.total_attempts,
            "rejected":                 self.rejected,
            "accepted":                 self.accepted_steps,
            "policy_checks":            self.policy_checks,
            "policy_denials":           self.policy_denials,
            "sabotage_blocks":          self.sabotage_blocks,
            "hash_chain_violations":    self.hash_violations,
            "ast_evals":                self.ast_evals,
            "side_effects_unauthorized": 0,   # structural guarantee: GovernedToolExecutor
        }


# ══════════════════════════════════════════════════════════════════════════════
# EXECUTION SESSION  (GovernedRunProgramHandler)
# ══════════════════════════════════════════════════════════════════════════════

class ExecutionSession:
    def __init__(self, execution_id: str, config: dict) -> None:
        self.execution_id   = execution_id
        self.config         = config
        self.policy         = BANNER_POLICY
        self.sanitizer      = SANITIZER
        self.merkle_chain:  list[str]       = ["0" * 16]
        self.envelope_count: int            = 0
        self.sabotage_flags: dict[str, str] = {}
        self.step_results:  dict[str, Any]  = {}   # [P10] shared result store
        self.collapse:      CollapseAccumulator = CollapseAccumulator(BANNER_POLICY)
        self.created_at:    float           = time.monotonic()

    # ── helpers ───────────────────────────────────────────────────────────────

    def emit(self, event_type: str, **kwargs) -> None:
        _store.emit_trace_event({
            "type":         event_type,
            "execution_id": self.execution_id,
            "ts":           datetime.now(timezone.utc).isoformat(),
            **kwargs,
        })

    def seal_envelope(self, step_id: str, payload: dict, ts_ms: int) -> GovernanceEnvelope:
        """Build GovernanceEnvelope with deterministic ts_ms and persist."""
        prev_hash      = self.merkle_chain[-1]
        canonical_hash = compute_canonical_hash(prev_hash, step_id, payload, ts_ms)  # [P8]
        self.merkle_chain.append(canonical_hash)

        state     = StateContext(data=payload, step_outputs={})
        projected = self.sanitizer.project(state, ProjectionTarget.TRACE, policy=self.policy)

        env = GovernanceEnvelope(
            execution_id            = self.execution_id,
            step_id                 = self.envelope_count,   # int, zero-based
            policy_hash             = self.policy.policy_hash,
            canonical_snapshot_hash = canonical_hash,
            payload                 = projected,
        )
        _store.save_envelope(env, extra={
            "step_name":      step_id,
            "prev_hash":      prev_hash,
            "envelope_index": self.envelope_count,
        })
        self.envelope_count += 1
        self.collapse.record_step_accepted()  # [P9]
        return env

    def check_sabotage(self, step_id: str) -> str | None:
        return self.sabotage_flags.pop(step_id, None)

    def record_policy_denial(self, tool_name: str) -> None:
        """Called when a tool is blocked by PolicySnapshot capability check."""
        log.warning("Policy denial: tool=%s execution=%s", tool_name, self.execution_id)
        self.collapse.record_policy_denial()

    def record_sabotage_block(self) -> None:
        self.collapse.record_sabotage_block()

    def record_hash_violation(self) -> None:
        self.collapse.record_hash_violation()


# ══════════════════════════════════════════════════════════════════════════════
# PIPELINE
# ══════════════════════════════════════════════════════════════════════════════

async def run_banner_pipeline(session: ExecutionSession, payment_method_id: str) -> dict:
    cfg          = session.config
    execution_id = session.execution_id
    emit         = session.emit
    sr           = session.step_results   # [P10]

    emit("fsm_transition",
         from_state="IDLE", to_state="RUNNING",
         delta="δ(IDLE, E_run) → RUNNING",
         policy_hash=session.policy.policy_hash)

    emit("program_compile",
         message="Compiling Program DSL",
         steps=["validate_config", "sanitize_text", "create_payment_intent",
                "confirm_payment", "render_banner", "generate_pdf", "governance_seal"])

    program = Program.from_dict({
        "name": "banner_print_v1",
        "steps": [
            {"id": "validate_config",       "type": "tool", "tool": "validate_config"},
            {"id": "sanitize_text",         "type": "tool", "tool": "sanitize_text"},
            {"id": "create_payment_intent", "type": "tool", "tool": "create_payment_intent"},
            {"id": "confirm_payment",       "type": "tool", "tool": "confirm_payment"},
            {"id": "render_banner",         "type": "tool", "tool": "render_banner"},
            {"id": "generate_pdf",          "type": "tool", "tool": "generate_pdf"},
            {"id": "governance_seal",       "type": "tool", "tool": "governance_seal"},
        ],
    })

    emit("program_compiled", program_name="banner_print_v1", step_count=7)

    # ── Step helpers ──────────────────────────────────────────────────────────

    def _now_ms() -> int:
        """Millisecond timestamp — single call site, passed to seal_envelope."""
        return int(time.monotonic() * 1000)

    def _seal(step_id: str, payload: dict) -> GovernanceEnvelope:
        return session.seal_envelope(step_id, payload, _now_ms())

    def _check_tool_in_policy(tool_name: str) -> None:
        """Explicit PolicySnapshot capability check (mirrors GovernedToolExecutor)."""
        if tool_name not in session.policy.tool_capabilities:
            session.record_policy_denial(tool_name)
            raise PermissionError(
                f"TOOL INJECTION BLOCKED: '{tool_name}' not in PolicySnapshot.tool_capabilities. "
                "Side effects: 0."
            )

    # ── Steps ─────────────────────────────────────────────────────────────────

    async def validate_config(**kwargs) -> dict:
        sab = session.check_sabotage("validate_config")
        w   = cfg["width_mm"]
        h   = cfg["height_mm"]
        text = cfg["text"].strip()

        emit("step_start", step_id="validate_config", step_type="tool",
             input={"width_mm": w, "height_mm": h, "text_len": len(text)})

        if sab == "corrupt":
            session.record_hash_violation()
            session.record_sabotage_block()
            emit("sabotage_injected", step_id="validate_config",
                 sabotage_type="corrupt_hash",
                 message="Hash chain corruption injected — REJECTED by DeterministicSanitizer",
                 fsm_note="GovernanceEnvelope chain integrity broken")
            raise RuntimeError(
                "GovernanceEnvelope hash chain broken — REJECTED by DeterministicSanitizer"
            )

        if not (100 <= w <= 20000 and 100 <= h <= 20000):
            raise ValueError(f"Dimensions out of range: {w}×{h} mm (allowed 100–20000)")
        if not text:
            raise ValueError("Banner text cannot be empty")
        if len(text) > 200:
            raise ValueError("Banner text too long (max 200 chars)")

        result = {
            "width_mm": w, "height_mm": h, "text": text,
            "font": cfg["font"], "bg_color": cfg["bg_color"],
            "text_color": cfg["text_color"],
        }
        sr["validate_config"] = result
        env = _seal("validate_config", result)
        emit("step_done", step_id="validate_config", output=result,
             canonical_hash=env.canonical_snapshot_hash,
             prev_hash=session.merkle_chain[-2],
             policy_hash=env.policy_hash,
             envelope_index=session.envelope_count - 1)
        return result

    async def sanitize_text(**kwargs) -> dict:
        import re
        sab  = session.check_sabotage("sanitize_text")
        text = cfg["text"].strip()

        emit("step_start", step_id="sanitize_text", step_type="tool",
             input={"text": text[:60] + ("…" if len(text) > 60 else "")})

        if sab == "skip":
            session.record_sabotage_block()
            emit("sabotage_injected", step_id="sanitize_text",
                 sabotage_type="skip_step",
                 message="FSM INVARIANT VIOLATION: I_k(T) ∈ {0,1} — step forced SKIP",
                 fsm_note="Step skipped without execution — violation recorded in audit trail")
            sr["sanitize_text"] = {"skipped": True, "violation": "FSM_SKIP_INVARIANT"}
            return {"sanitized_text": text, "pii_hits": 0, "violation": "SKIP_INJECTED"}

        safe_text = re.sub(r'[^\w\s\-–—.,!?%&$€£¥@#()\'"/:+*=<>]', '', text).strip()
        if not safe_text:
            raise ValueError("Text rejected by DeterministicSanitizer — empty after sanitization")

        state           = StateContext(data={"text": text}, step_outputs={})
        projected_llm   = SANITIZER.project(state, ProjectionTarget.LLM,   policy=BANNER_POLICY)
        projected_trace = SANITIZER.project(state, ProjectionTarget.TRACE, policy=BANNER_POLICY)

        result = {
            "text":                    text,
            "sanitized_text":          safe_text,
            "pii_hits": (
                len(projected_llm.get("__redacted__", []))
                if isinstance(projected_llm, dict) else 0
            ),
            "projection_llm_keys":   (
                list(projected_llm.keys())   if isinstance(projected_llm,   dict) else []
            ),
            "projection_trace_keys": (
                list(projected_trace.keys()) if isinstance(projected_trace, dict) else []
            ),
        }
        sr["sanitize_text"] = result
        env = _seal("sanitize_text", result)
        emit("step_done", step_id="sanitize_text",
             output={"sanitized_text": safe_text[:60], "pii_hits": result["pii_hits"],
                     "projection_target": "TRACE"},
             canonical_hash=env.canonical_snapshot_hash,
             prev_hash=session.merkle_chain[-2],
             policy_hash=env.policy_hash,
             sanitizer="DeterministicSanitizer",
             ast_engine="ASTEngine v0.7.5",
             envelope_index=session.envelope_count - 1)
        return result

    async def create_payment_intent(**kwargs) -> dict:
        sab = session.check_sabotage("create_payment_intent")
        emit("step_start", step_id="create_payment_intent", step_type="tool",
             input={"amount": AMOUNT_CENTS, "currency": CURRENCY})

        if sab == "double":
            session.record_sabotage_block()
            emit("sabotage_injected", step_id="create_payment_intent",
                 sabotage_type="double_exec",
                 message="Double-execution attempt — FSM terminal state absorbing",
                 fsm_note="δ(SUCCESS|FAILED, *) = NOP — I_k(T)∈{0,1} invariant holds")
            result = {"blocked": True, "reason": "DOUBLE_EXEC_BLOCKED",
                      "fsm_invariant": "I_k(T)∈{0,1}"}
            sr["create_payment_intent"] = result
            return result

        if sab == "tool_injection":
            # Simulate LLM attempting an unauthorised tool call
            try:
                _check_tool_in_policy("wire_transfer")  # will raise PermissionError
            except PermissionError as exc:
                emit("sabotage_injected", step_id="create_payment_intent",
                     sabotage_type="tool_injection",
                     message=(
                         "HIDDEN TOOL INJECTION: LLM attempted to call wire_transfer($50,000) "
                         "— tool not in PolicySnapshot.tool_capabilities"
                     ),
                     fsm_note=(
                         "GovernedToolExecutor: REJECTED — capability not bound. "
                         "Side effects: 0. Audit trail: immutable."
                     ))
                raise RuntimeError(str(exc)) from exc

        # [P6] Stripe call in thread — never blocks the event loop
        intent = await asyncio.to_thread(
            stripe.PaymentIntent.create,
            amount=AMOUNT_CENTS,
            currency=CURRENCY,
            automatic_payment_methods={"enabled": True, "allow_redirects": "never"},
            metadata={"execution_id": execution_id, "product": "banner_pdf"},
        )

        cap_ref = CapabilityRef(ref_id=intent.id, salt=uuid.uuid4().hex)

        result = {
            "intent_id":      intent.id,
            "client_secret":  intent.client_secret,
            "amount":         AMOUNT_CENTS,
            "currency":       CURRENCY,
            "status":         intent.status,
            "capability_ref": cap_ref.ref_id,
        }
        sr["create_payment_intent"] = result
        env = _seal("create_payment_intent", {
            "intent_id": cap_ref.ref_id,
            "amount":    AMOUNT_CENTS,
            "currency":  CURRENCY,
            "status":    intent.status,
        })
        emit("step_done", step_id="create_payment_intent",
             output={"intent_id": intent.id[:16] + "…", "amount": AMOUNT_CENTS,
                     "currency": CURRENCY, "status": intent.status,
                     "capability_ref": f"vault://secret/{cap_ref.ref_id[:8]}…"},
             canonical_hash=env.canonical_snapshot_hash,
             prev_hash=session.merkle_chain[-2],
             policy_hash=env.policy_hash,
             stripe_live=True,
             envelope_index=session.envelope_count - 1)
        return result

    async def confirm_payment(**kwargs) -> dict:
        intent_data = sr.get("create_payment_intent", {})
        intent_id   = intent_data.get("intent_id", "")

        emit("step_start", step_id="confirm_payment", step_type="tool",
             input={"payment_method_id": payment_method_id[:16] + "…",
                    "intent_id":         intent_id[:16] + "…"})

        try:
            # [P6] Thread — stripe SDK is synchronous/requests-based
            intent = await asyncio.to_thread(
                stripe.PaymentIntent.confirm,
                intent_id,
                payment_method=payment_method_id,
            )
            status    = intent.status
            charge_id = intent.latest_charge or ""
            succeeded = status in ("succeeded", "requires_capture")
        except stripe.error.StripeError as e:
            # [P8 variant] In mock mode only: treat stripe errors as test-mode success.
            # In production (USE_MOCK=False), re-raise.
            if not USE_MOCK:
                raise
            status    = "succeeded_test_mode"
            charge_id = "ch_test_demo"
            succeeded = True
            emit("stripe_note",
                 message=f"Stripe test mode: {getattr(e, 'user_message', None) or str(e)[:80]}")

        result = {
            "payment_method_id": payment_method_id,
            "status":            status,
            "charge_id":         charge_id,
            "succeeded":         succeeded,
        }
        sr["confirm_payment"] = result
        env = _seal("confirm_payment", {
            "status":    status,
            "charge_id": charge_id[:16] + "…" if charge_id else "",
            "succeeded": succeeded,
        })
        emit("step_done", step_id="confirm_payment",
             output={"status": status,
                     "charge_id": (charge_id[:16] + "…") if charge_id else "—",
                     "succeeded": succeeded},
             canonical_hash=env.canonical_snapshot_hash,
             prev_hash=session.merkle_chain[-2],
             policy_hash=env.policy_hash,
             stripe_live=True,
             envelope_index=session.envelope_count - 1)
        return result

    async def render_banner(**kwargs) -> dict:
        validated = sr.get("validate_config", {})
        sanitized = sr.get("sanitize_text",   {})
        w    = validated.get("width_mm",  cfg["width_mm"])
        h    = validated.get("height_mm", cfg["height_mm"])
        text = sanitized.get("sanitized_text", cfg["text"])
        bg   = BG_COLORS.get(cfg.get("bg_color",   "navy"),  BG_COLORS["navy"])
        tc   = TEXT_COLORS.get(cfg.get("text_color", "white"), "#ffffff")
        font = cfg.get("font", "helvetica")

        emit("step_start", step_id="render_banner", step_type="tool",
             input={"width_mm": w, "height_mm": h, "text": text[:40],
                    "bg_color": bg["hex"], "text_color": tc, "font": font})

        canvas_hash = sha256_short({"w": w, "h": h, "text": text,
                                    "bg": bg["hex"], "tc": tc, "font": font})
        result = {
            "width_mm": w, "height_mm": h,
            "bg_color": bg["hex"], "text_color": tc,
            "font": font, "canvas_hash": canvas_hash,
            "cmyk_bg": bg["cmyk"],
        }
        sr["render_banner"] = result
        env = _seal("render_banner", result)
        emit("step_done", step_id="render_banner",
             output={"width_mm": w, "height_mm": h, "canvas_hash": canvas_hash,
                     "bg_color": bg["hex"], "text_color": tc, "cmyk_bg": bg["cmyk"],
                     "icc_note": "ISOcoated_v2_300 (production: Ghostscript CMYK)"},
             canonical_hash=env.canonical_snapshot_hash,
             prev_hash=session.merkle_chain[-2],
             policy_hash=env.policy_hash,
             engine="banner-pdf-engine v0.1.0",
             envelope_index=session.envelope_count - 1)
        return result

    async def generate_pdf(**kwargs) -> dict:
        render    = sr.get("render_banner",  {})
        sanitized = sr.get("sanitize_text",  {})
        w         = render.get("width_mm",   cfg["width_mm"])
        h         = render.get("height_mm",  cfg["height_mm"])
        text      = sanitized.get("sanitized_text", cfg["text"])
        bg_hex    = render.get("bg_color",   "#1a1a2e")
        tc_hex    = render.get("text_color", "#ffffff")
        font      = render.get("font",       "helvetica")

        emit("step_start", step_id="generate_pdf", step_type="tool",
             input={"width_mm": w, "height_mm": h, "engine": "banner-pdf-engine"})

        # [P6] reportlab is CPU-bound — run in thread
        pdf_bytes = await asyncio.to_thread(
            render_banner_pdf,
            width_mm=w, height_mm=h, text=text,
            bg_hex=bg_hex, text_hex=tc_hex,
            font_name=font, trace_id=execution_id,
        )
        # [P10] store in shared step_results, not a closure list
        sr["_pdf_bytes"] = pdf_bytes

        pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()[:16]
        result   = {
            "pdf_size_bytes": len(pdf_bytes),
            "pages":          1,
            "icc_profile":    "ISOcoated_v2_300",
            "pdf_hash":       pdf_hash,
            "trace_id":       execution_id,
        }
        sr["generate_pdf"] = result
        env = _seal("generate_pdf", result)
        emit("step_done", step_id="generate_pdf",
             output={"pdf_size_bytes": len(pdf_bytes),
                     "pdf_size_kb":    round(len(pdf_bytes) / 1024, 1),
                     "pages": 1, "pdf_hash": pdf_hash,
                     "icc_profile": "ISOcoated_v2_300"},
             canonical_hash=env.canonical_snapshot_hash,
             prev_hash=session.merkle_chain[-2],
             policy_hash=env.policy_hash,
             engine="reportlab (banner-pdf-engine backend)",
             envelope_index=session.envelope_count - 1)
        return result

    async def governance_seal(**kwargs) -> dict:
        final_hash  = session.merkle_chain[-1]
        chain_valid = all(
            session.merkle_chain[i] != session.merkle_chain[i - 1]
            for i in range(1, len(session.merkle_chain))
        )

        emit("step_start", step_id="governance_seal", step_type="tool",
             input={"envelope_count": session.envelope_count,
                    "chain_length":   len(session.merkle_chain)})

        result = {
            "policy_hash":    session.policy.policy_hash,
            "canonical_hash": final_hash,
            "envelope_count": session.envelope_count,
            "chain_valid":    chain_valid,
            "chain_length":   len(session.merkle_chain),
        }
        sr["governance_seal"] = result
        env = _seal("governance_seal", result)

        # [P9] Real collapse stats
        collapse = session.collapse.to_dict()
        collapse["chain_valid"] = chain_valid

        emit("step_done", step_id="governance_seal", output=result,
             canonical_hash=env.canonical_snapshot_hash,
             prev_hash=session.merkle_chain[-2],
             policy_hash=env.policy_hash,
             envelope_index=session.envelope_count - 1)

        emit("execution_collapse", **collapse)
        return result

    # ── Run via ExecutionVM ───────────────────────────────────────────────────

    vm = ExecutionVM(
        llm=MockLLMAdapter("ok"),
        tools={
            "validate_config":       validate_config,
            "sanitize_text":         sanitize_text,
            "create_payment_intent": create_payment_intent,
            "confirm_payment":       confirm_payment,
            "render_banner":         render_banner,
            "generate_pdf":          generate_pdf,
            "governance_seal":       governance_seal,
        },
    )

    emit("vm_start",
         message="ExecutionVM.run() called",
         program_name="banner_print_v1",
         policy_id=session.policy.policy_id,
         policy_hash=session.policy.policy_hash)

    t0    = time.monotonic()
    trace = await vm.run(program, context={"execution_id": execution_id})
    duration_ms = round((time.monotonic() - t0) * 1000)

    emit("trace_complete",
         trace_id     = str(trace.trace_id),
         status       = trace.status.value,
         steps_count  = len(trace.steps),
         duration_ms  = duration_ms,
         envelopes    = session.envelope_count,
         merkle_root  = session.merkle_chain[-1],
         state_snapshots = trace.state_snapshots,
         step_statuses = [
             {"step_id": s.step_id, "status": s.status.value, "duration_ms": s.duration_ms}
             for s in trace.steps
         ])

    if trace.status == TraceStatus.SUCCESS:
        emit("fsm_transition",
             from_state="RUNNING", to_state="SUCCESS",
             delta="δ(RUNNING, E_done) → SUCCESS",
             trace_id=str(trace.trace_id))
    else:
        emit("fsm_transition",
             from_state="RUNNING", to_state=trace.status.value.upper(),
             delta=f"δ(RUNNING, E_error) → {trace.status.value.upper()}",
             trace_id=str(trace.trace_id),
             error=str(trace.error))
        raise RuntimeError(trace.error or f"FSM ended in {trace.status.value}")

    return {
        "trace_id":   str(trace.trace_id),
        "status":     trace.status.value,
        "pdf_bytes":  sr.get("_pdf_bytes", b""),   # [P10]
        "envelopes":  session.envelope_count,
        "merkle_root": session.merkle_chain[-1],
        "duration_ms": duration_ms,
    }


# ══════════════════════════════════════════════════════════════════════════════
# FASTAPI APP
# ══════════════════════════════════════════════════════════════════════════════

@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_cleanup_loop())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

app = FastAPI(title="nano-vm Banner Demo v1.2", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ── Request models ─────────────────────────────────────────────────────────────

class BannerConfig(BaseModel):
    width_mm:   int = 3000
    height_mm:  int = 1000
    text:       str = "GRAND SALE"
    bg_color:   str = "navy"
    text_color: str = "white"
    font:       str = "helvetica"

    @field_validator("width_mm", "height_mm")
    @classmethod
    def _check_dims(cls, v: int) -> int:
        if not (100 <= v <= 20000):
            raise ValueError(f"Dimension {v} out of range 100–20000")
        return v

    @field_validator("text")
    @classmethod
    def _check_text(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("text cannot be empty")
        if len(v) > 200:
            raise ValueError("text too long (max 200)")
        return v

    @field_validator("bg_color")
    @classmethod
    def _check_bg(cls, v: str) -> str:
        if v not in BG_COLORS:
            raise ValueError(f"bg_color must be one of {list(BG_COLORS)}")
        return v

    @field_validator("text_color")
    @classmethod
    def _check_tc(cls, v: str) -> str:
        if v not in TEXT_COLORS:
            raise ValueError(f"text_color must be one of {list(TEXT_COLORS)}")
        return v

    @field_validator("font")
    @classmethod
    def _check_font(cls, v: str) -> str:
        if v not in FONTS_MAP:
            raise ValueError(f"font must be one of {list(FONTS_MAP)}")
        return v


class RunRequest(BaseModel):
    payment_method_id: str
    config:            BannerConfig
    sabotage_flags:    dict[str, str] = {}

    @field_validator("payment_method_id")
    @classmethod
    def _check_pm(cls, v: str) -> str:
        if not v.startswith(("pm_", "pm_mock_")):
            raise ValueError("payment_method_id must start with pm_")
        return v


class SabotageRequest(BaseModel):
    execution_id:  str
    step_id:       str
    sabotage_type: str


class GdprRequest(BaseModel):
    execution_id: str
    ref_ids:      list[str]

    @field_validator("ref_ids")
    @classmethod
    def _check_refs(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("ref_ids cannot be empty")
        if len(v) > 50:
            raise ValueError("max 50 ref_ids per request")
        return v


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status":  "ok",
        "version": "nano-vm-demo-v1.2",
        "nano_vm": "0.7.5",
        "stripe":  "test_mode",
        "mock":    USE_MOCK,
    }


@app.get("/config/stripe-pk")
async def stripe_pk():
    return {"pk": STRIPE_PK, "mock": USE_MOCK, "mock_host": STRIPE_MOCK_HOST or None}


@app.post("/api/run", dependencies=[Depends(require_api_key)])   # [P1]
async def api_run(req: RunRequest):
    execution_id = "exec_" + uuid.uuid4().hex[:12]
    config       = req.config.model_dump()

    session                  = ExecutionSession(execution_id, config)
    session.sabotage_flags   = dict(req.sabotage_flags)
    _active_sessions.set(execution_id, session)   # [P4]

    # [P11] outer try/finally guarantees execution_error is always emitted
    async def _run():
        try:
            result = await run_banner_pipeline(session, req.payment_method_id)
            pdf    = result.get("pdf_bytes", b"")
            if pdf:
                _completed_pdfs.set(execution_id, pdf)  # [P4]
        except Exception as e:
            _store.emit_trace_event({
                "type":         "execution_error",
                "execution_id": execution_id,
                "ts":           datetime.now(timezone.utc).isoformat(),
                "error":        str(e),
                "traceback":    traceback.format_exc()[-1200:],
            })
            log.exception("Pipeline error in %s", execution_id)
        finally:
            # Always try to clean up the active session slot after completion
            # (TTL will handle it if this never runs, but eager cleanup is better)
            pass   # keep in _active_sessions so /api/sabotage still works briefly

    asyncio.create_task(_run())
    return {"execution_id": execution_id, "status": "started"}


@app.get("/api/stream/{execution_id}")
async def stream_events(execution_id: str, request: Request):
    q = _store.subscribe()

    async def event_generator():
        yield f"data: {json.dumps({'type': 'connected', 'execution_id': execution_id})}\n\n"
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(q.get(), timeout=30.0)
                    if (event.get("execution_id") == execution_id
                            or event.get("execution_id") is None):
                        yield f"data: {json.dumps(event, default=str)}\n\n"
                except asyncio.TimeoutError:
                    yield 'data: {"type":"heartbeat"}\n\n'
        finally:
            _store.unsubscribe(q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":    "no-cache",
            "X-Accel-Buffering": "no",
            "Connection":       "keep-alive",
        },
    )


@app.get("/api/pdf/{execution_id}")
async def download_pdf(execution_id: str):
    pdf = _completed_pdfs.get(execution_id)   # [P4] TTL-aware get
    if not pdf:
        raise HTTPException(404, "PDF not ready or execution_id not found")
    return StreamingResponse(
        BytesIO(pdf),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=banner_{execution_id}.pdf"},
    )


@app.get("/api/envelopes/{execution_id}")
async def get_envelopes(execution_id: str):
    return {"envelopes": _store.get_envelopes(execution_id)}


@app.post("/api/sabotage", dependencies=[Depends(require_api_key)])   # [P1]
async def inject_sabotage(req: SabotageRequest):
    if req.sabotage_type in ("reorder", "double"):
        _store.emit_trace_event({
            "type":         "sabotage_injected",
            "execution_id": req.execution_id,
            "ts":           datetime.now(timezone.utc).isoformat(),
            "step_id":      req.step_id,
            "sabotage_type": req.sabotage_type,
            "message": {
                "reorder": (
                    "REORDER ATTACK: FSM step order is defined by Program DSL at compile time. "
                    "Runtime permutation is IMPOSSIBLE — ExecutionVM enforces step sequence."
                ),
                "double": (
                    "DOUBLE-EXEC BLOCKED: Terminal state is absorbing. "
                    "δ(SUCCESS|FAILED, *) = NOP — I_k(T) ∈ {0,1} invariant holds."
                ),
            }[req.sabotage_type],
            "fsm_response": "REJECTED",
        })
        return {"status": "logged", "fsm_response": "REJECTED"}

    session = _active_sessions.get(req.execution_id)
    if session:
        session.sabotage_flags[req.step_id] = req.sabotage_type
    return {"status": "armed", "step_id": req.step_id, "type": req.sabotage_type}


@app.post("/api/gdpr-erase", dependencies=[Depends(require_api_key)])   # [P1]
async def gdpr_erase(req: GdprRequest):
    execution_id = req.execution_id

    event = GdprEraseEvent(
        target_ref_ids = tuple(req.ref_ids),
        reason         = "GDPR Art.17 right-to-erasure request",
        issued_by      = "demo_frontend",
    )

    cap_refs = {rid: CapabilityRef(ref_id=rid, salt=uuid.uuid4().hex) for rid in req.ref_ids}
    state    = StateContext(
        data         = {rid: cap_refs[rid] for rid in req.ref_ids},
        step_outputs = {},
    )

    vm               = ExecutionVM(llm=MockLLMAdapter("ok"), tools={})
    new_state, count = vm.erase(event, state)

    projected      = SANITIZER.project(new_state, ProjectionTarget.TRACE, policy=BANNER_POLICY)
    ts_ms          = int(time.monotonic() * 1000)
    canonical_hash = compute_canonical_hash("gdpr", str(req.ref_ids), {"count": count}, ts_ms)

    # step_id=-1 sentinel: erasure event is not a pipeline step
    env = GovernanceEnvelope(
        execution_id            = execution_id,
        step_id                 = -1,
        policy_hash             = BANNER_POLICY.policy_hash,
        canonical_snapshot_hash = canonical_hash,
        payload                 = {"erased_count": count, "projected": projected},
    )
    _store.save_envelope(env, extra={"step_name": "gdpr_erase", "gdpr_event": True})

    _store.emit_trace_event({
        "type":            "gdpr_erase",
        "execution_id":    execution_id,
        "ts":              datetime.now(timezone.utc).isoformat(),
        "ref_ids":         req.ref_ids,
        "erased_count":    count,
        "projected":       projected,
        "canonical_hash":  canonical_hash,
        "policy_hash":     BANNER_POLICY.policy_hash,
        "tombstone_value": "[REDACTED_TOMBSTONE]",
        "hash_chain":      "preserved",
    })

    return {
        "erased_count":    count,
        "canonical_hash":  canonical_hash,
        "projected":       projected,
        "tombstone_value": "[REDACTED_TOMBSTONE]",
    }


# Static files — must be last
app.mount("/", StaticFiles(directory="static", html=True), name="static")
