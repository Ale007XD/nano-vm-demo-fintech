# nano-vm Banner Demo

<p align="center">
  <img src="https://img.shields.io/badge/llm--nano--vm-0.7.5-blue" alt="nano-vm">
  <img src="https://img.shields.io/badge/FSM-deterministic-green" alt="FSM">
  <img src="https://img.shields.io/badge/GovernanceEnvelope-Merkle--chain-purple" alt="Governance">
  <img src="https://img.shields.io/badge/GDPR-tombstoning-orange" alt="GDPR">
  <img src="https://img.shields.io/badge/license-MIT-lightgrey" alt="License">
</p>

**Живое демо детерминированного fintech-runtime на базе [llm-nano-vm](https://github.com/Ale007XD/nano_vm).**  
7-шаговый пайплайн генерации PDF-баннера со Stripe-моком, GovernanceEnvelope audit trail, SSE trace log и 6 sabotage injectors.

🔗 **[demo.bannerbot.ru:8444](https://demo.bannerbot.ru:8444)**

---

## Что показывает демо

Это не просто "LLM генерирует файл". Это демонстрация того, что **runtime, а не модель, контролирует исполнение**.

Программа `banner_print_v1` проходит ровно 7 шагов в строго заданном порядке — независимо от того, что возвращает LLM или инструмент. Каждый шаг запечатывается в `GovernanceEnvelope`, цепочка хэшей выстраивает Merkle-дерево. Итог: криптографически верифицируемый audit trail с первого до последнего байта.

---

## Пайплайн

```
validate_config → sanitize_text → create_payment_intent
    → confirm_payment → render_banner → generate_pdf → governance_seal
```

| Шаг | Тип | ~время |
|---|---|---|
| `validate_config` | tool | <1 ms |
| `sanitize_text` | tool (DeterministicSanitizer) | <1 ms |
| `create_payment_intent` | tool (Stripe mock) | ~84 ms |
| `confirm_payment` | tool (Stripe mock) | ~55 ms |
| `render_banner` | tool (reportlab) | <2 ms |
| `generate_pdf` | tool (banner-pdf-engine) | ~20 ms |
| `governance_seal` | tool (Merkle finalization) | ~0.4 ms |

**Суммарно: ~150 ms. PDF: 2 KB. GovernanceEnvelopes: 7. chain_valid: true.**

---

## Гарантии runtime

### Детерминизм и порядок

DSL-программа компилируется один раз. `ExecutionVM` выполняет шаги в строгом порядке без возможности переупорядочивания. FSM после достижения терминального состояния (`SUCCESS`/`FAILED`) становится absorbing — повторный запуск невозможен без нового execution_id.

```
δ(S, E) → S'   — детерминированный переход
δ(SUCCESS, *) → NOP   — absorbing state
```

### Cryptographic audit trail

Каждый успешный шаг производит `GovernanceEnvelope`:

| Поле | Описание |
|---|---|
| `execution_id` | UUID сессии |
| `step_id` | Индекс шага |
| `policy_hash` | SHA-256 активного PolicySnapshot |
| `canonical_snapshot_hash` | Merkle/delta хэш состояния |
| `payload` | Sanitized вывод шага |

Конверты пишутся только при `error=None`. Merkle-корень финализируется на шаге `governance_seal`.

### ASTEngine (no eval)

Condition-шаги вычисляются через sandboxed AST-интерпретатор. `eval()` полностью удалён из production path. Поддерживаемые операторы: `==`, `!=`, `>`, `<`, `in`, `not in`, `and`, `or`, `not`, `contains`, dotted-path `$var.field`.

---

## Sabotage injectors

После успешного прогона можно активировать любой из 6 атак через UI:

| Инжектор | Что атакует | Реакция VM |
|---|---|---|
| `skip_step` | Пропуск шага пайплайна | Отклонение — DSL immutable |
| `corrupt_hash` | Подмена envelope hash | Разрыв chain → detect |
| `double_exec` | Повторный запуск той же программы | Absorbing state → NOP |
| `reorder_steps` | Переупорядочивание шагов | DSL locked at compile time |
| `tool_injection` | Wire transfer $50k вне policy | CapabilityDeniedError |
| `gdpr_erase` | Стирание чувствительных CapabilityRef | Tombstoning + hash preserved |

> **Note:** Sabotage injectors — scripted showcase, не live anomaly detection. Каждый инжектор активируется кнопкой в UI и демонстрирует конкретный защитный механизм.

---

## GDPR tombstoning

`gdpr_erase` стирает два `CapabilityRef` (`vault://secret/...`) без разрушения audit chain:

```
pre-erase:  canonical_hash = 941df9763bcba424
post-erase: canonical_hash = c740cd50a5f018b1
merkle_root: preserved (535e8bd8676813e1)
policy_hash: unchanged (4ea6a303e5ddad0f)
```

Все последующие проекции возвращают `[REDACTED_TOMBSTONE]`. Hash-chain остаётся непрерывной — соответствие Art.17 GDPR без разрушения доказательной базы.

---

## Stripe layer

Демо использует **stripe-mock v0.189.0** (локальный бинарь, порт 12111). Платёжный слой намеренно упрощён: фокус демо — на оркестрации VM и governance, а не на полном payment lifecycle.

`confirm_payment` может вернуть `succeeded: false` на моке — пайплайн продолжает выполнение (демо-логика). В production необходим guard:

```python
if not result["succeeded"] and not USE_MOCK:
    raise RuntimeError(f"Payment failed: {result['status']}")
```

---

## Collapse Accumulator

Счётчик в нижней части UI показывает реальную статистику сессии:

```
total_attempts: 7      ← accepted (GovernanceEnvelope) + rejected
accepted_steps: 7
policy_checks: 7
sabotage_blocks: 0     ← растёт при tool_injection
side_effects_unauthorized: 0
```

При активации `tool_injection` — `sabotage_blocks` увеличивается. Без sabotage — честные 7/7.

---

## Архитектура

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

**SSE Handshake & Trigger:** клиент генерирует `execution_id` через `crypto.getRandomValues`, открывает SSE-соединение, ждёт `{type:'connected'}`, только после этого POST `/api/run`. Гарантирует что ни одно событие не потеряно до установки соединения.

---

## Стек

| Компонент | Версия |
|---|---|
| llm-nano-vm | 0.7.5 |
| FastAPI + uvicorn | latest |
| stripe-mock | 0.189.0 |
| reportlab | ≥4.1 |
| nginx (SSL) | системный |
| Python | 3.10+ |

---

## Known limitations

- `GovernedToolExecutor` в nano-vm-mcp **не реализован** — capability-gating декларируется на уровне demo VM, не gateway
- `idempotency_store` не реализован — межсессионный риск дубля при рестарте процесса до завершения платежа
- Stripe layer: mock-only, без webhook-driven state machine и Saga/compensating transactions
- `Step.allowed_outputs` и `Step.timeout_seconds` — Sprint 5, не реализованы
- HTTP:80 не редиректит на :8444 (нестандартный порт — amnezia-xray занимает 443)

---

## Roadmap

- [ ] `GovernedToolExecutor` в gateway — реальный capability gate на уровне MCP-сервера
- [ ] `idempotency_store` — межсессионная идемпотентность (Sprint 4 nano-vm-mcp)
- [ ] StateContext SQLite persistence — закрыть риск дубля при рестарте
- [ ] Stripe webhook-driven suspend/resume — `vm.run()` → `SUSPENDED` → `resume_with_program()`
- [ ] OpenTelemetry span per FSM step (Sprint 6)
- [ ] `Step.allowed_outputs` + `Step.timeout_seconds` (Sprint 5)
- [ ] PROGRAM_IPN_HANDLER DSL

---

## Связь

**Author:** [@ale007xd](https://t.me/ale007xd) · [@ale007xd](https://x.com/ale007xd)

[![Buy Me a Coffee](https://img.shields.io/badge/☕-Buy%20Me%20a%20Coffee-yellow?style=flat-square)](https://www.buymeacoffee.com/ale007xd)

---

## License

[MIT](LICENCE)
