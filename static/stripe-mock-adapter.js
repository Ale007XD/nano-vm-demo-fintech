<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>nano-vm · Canonical Execution Runtime</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Syne:wght@400;700;800&family=Space+Grotesk:wght@300;400;500;600&display=swap" rel="stylesheet">
<script src="https://js.stripe.com/v3/"></script>
<style>
:root{
  --bg:#070b0f;--surf:#0c1117;--surf2:#131a22;--surf3:#1a2230;
  --border:#1e2630;--border2:#2a3340;
  --ink:#e2eaf3;--ink2:#8a97a8;--ink3:#404d5c;
  --accent:#00d4a1;--accent-dim:rgba(0,212,161,.1);--accent-glo:rgba(0,212,161,.22);
  --danger:#f85149;--danger-dim:rgba(248,81,73,.1);
  --warn:#d29922;--warn-dim:rgba(210,153,34,.1);
  --blue:#58a6ff;--blue-dim:rgba(88,166,255,.1);
  --purple:#bc8cff;
  --mono:'JetBrains Mono',monospace;
  --sans:'Syne',sans-serif;
  --body:'Space Grotesk',sans-serif;
  --r:8px;--rs:4px;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden}
body{background:var(--bg);color:var(--ink);font-family:var(--body);font-size:13px}

body::before{
  content:'';position:fixed;inset:0;pointer-events:none;z-index:0;
  background-image:
    linear-gradient(rgba(0,212,161,.012) 1px,transparent 1px),
    linear-gradient(90deg,rgba(0,212,161,.012) 1px,transparent 1px);
  background-size:36px 36px;
}

/* ── HEADER ── */
header{
  position:relative;z-index:20;
  height:52px;padding:0 24px;
  border-bottom:1px solid var(--border);
  background:rgba(7,11,15,.92);backdrop-filter:blur(12px);
  display:flex;align-items:center;gap:16px;
}
.logo{font-family:var(--sans);font-weight:800;font-size:15px;
  display:flex;align-items:center;gap:8px;letter-spacing:-.02em}
.logo-dot{width:8px;height:8px;border-radius:50%;background:var(--accent);
  box-shadow:0 0 10px var(--accent);animation:pulse 2s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1;box-shadow:0 0 10px var(--accent)}50%{opacity:.5;box-shadow:0 0 3px var(--accent)}}
.logo-sub{color:var(--ink3);font-family:var(--mono);font-size:10px;font-weight:400}
.hbadges{display:flex;gap:6px;margin-left:auto;align-items:center}
.badge{font-family:var(--mono);font-size:9px;padding:3px 8px;border-radius:20px;
  border:1px solid;font-weight:700;letter-spacing:.06em}
.b-green{border-color:var(--accent);color:var(--accent);background:var(--accent-dim)}
.b-blue{border-color:var(--blue);color:var(--blue);background:var(--blue-dim)}
.b-purple{border-color:var(--purple);color:var(--purple);background:rgba(188,140,255,.1)}
.b-warn{border-color:var(--warn);color:var(--warn);background:var(--warn-dim)}
.b-danger{border-color:var(--danger);color:var(--danger);background:var(--danger-dim)}

/* ── LAYOUT ── */
.app{
  position:relative;z-index:1;
  display:grid;
  grid-template-columns:340px 1fr 420px;
  height:calc(100vh - 52px);
}
.col{border-right:1px solid var(--border);overflow-y:auto;overflow-x:hidden;
  display:flex;flex-direction:column}
.col:last-child{border-right:none}

/* ── PANEL HEADER ── */
.ph{
  padding:12px 18px 10px;border-bottom:1px solid var(--border);
  display:flex;align-items:center;justify-content:space-between;
  position:sticky;top:0;z-index:10;
  background:rgba(7,11,15,.96);backdrop-filter:blur(8px);flex-shrink:0;
}
.ph-title{font-family:var(--mono);font-size:10px;font-weight:700;
  letter-spacing:.1em;text-transform:uppercase;color:var(--ink2)}

/* ── SECTION ── */
.sec{padding:14px 18px;border-bottom:1px solid var(--border)}
.sec-lbl{font-family:var(--mono);font-size:9px;letter-spacing:.1em;
  text-transform:uppercase;color:var(--ink3);margin-bottom:10px}

/* ── EQUATION OVERLAY ── */
.eq-bar{
  padding:10px 18px;border-bottom:1px solid var(--border);
  background:rgba(0,212,161,.04);
  display:flex;align-items:center;justify-content:space-between;flex-shrink:0;
}
.eq-formula{font-family:var(--mono);font-size:13px;font-weight:700;
  color:var(--accent);letter-spacing:.04em}
.eq-rule{font-family:var(--mono);font-size:9px;color:var(--ink3);text-align:right;
  max-width:180px;line-height:1.5}

/* ── AUTHORITY BANNER ── */
.authority-banner{
  margin:16px 18px;padding:16px;border-radius:var(--r);
  border:1px solid rgba(248,81,73,.3);
  background:rgba(248,81,73,.06);
  text-align:center;
}
.auth-label{font-family:var(--mono);font-size:8px;letter-spacing:.14em;
  color:var(--danger);text-transform:uppercase;opacity:.7;margin-bottom:6px}
.auth-text{font-family:var(--sans);font-weight:800;font-size:11px;
  color:var(--danger);letter-spacing:.01em;line-height:1.4;text-transform:uppercase}

/* ── COLLAPSE COUNTER ── */
.collapse-panel{
  margin:12px 18px;padding:14px;border-radius:var(--r);
  border:1px solid var(--border2);background:var(--surf2);
  display:none;
}
.collapse-panel.visible{display:block}
.collapse-title{font-family:var(--mono);font-size:9px;letter-spacing:.1em;
  text-transform:uppercase;color:var(--ink3);margin-bottom:12px}
.collapse-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.cc{padding:10px;border-radius:var(--rs);border:1px solid var(--border);background:var(--surf3);
  text-align:center}
.cc-val{font-family:var(--mono);font-size:18px;font-weight:700;margin-bottom:2px}
.cc-lbl{font-family:var(--mono);font-size:8px;color:var(--ink3);letter-spacing:.06em}
.cc-val.red{color:var(--danger)}
.cc-val.green{color:var(--accent)}
.cc-val.blue{color:var(--blue)}
.cc-val.warn{color:var(--warn)}
.collapse-verdict{
  margin-top:10px;padding:8px 12px;border-radius:var(--rs);
  background:rgba(0,212,161,.08);border:1px solid rgba(0,212,161,.2);
  font-family:var(--mono);font-size:9px;color:var(--accent);
  display:flex;align-items:center;gap:8px;
}
.collapse-verdict .vc-seal{font-size:14px}

/* ── INPUTS ── */
.row2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.ig{display:flex;flex-direction:column;gap:4px}
.ig-lbl{font-family:var(--mono);font-size:9px;color:var(--ink3);letter-spacing:.04em}
input[type=text],input[type=number]{
  background:var(--surf2);border:1px solid var(--border2);border-radius:var(--rs);
  color:var(--ink);font-family:var(--mono);font-size:12px;
  padding:6px 10px;width:100%;outline:none;transition:border-color .15s;
}
input:focus{border-color:var(--accent)}

/* ── SWATCHES ── */
.sw-row{display:flex;flex-wrap:wrap;gap:6px}
.sw{width:22px;height:22px;border-radius:50%;cursor:pointer;
  border:2px solid transparent;transition:border-color .15s,transform .1s;flex-shrink:0}
.sw:hover{transform:scale(1.15)}
.sw.active{border-color:var(--ink) !important}

/* ── FONTS ── */
.font-row{display:flex;gap:6px;flex-wrap:wrap}
.fb{background:var(--surf2);border:1px solid var(--border2);border-radius:var(--rs);
  color:var(--ink2);font-size:11px;padding:4px 10px;cursor:pointer;transition:all .15s}
.fb:hover{border-color:var(--accent);color:var(--ink)}
.fb.active{border-color:var(--accent);color:var(--accent);background:var(--accent-dim)}

/* ── PAYMENT ── */
#sw{
  background:var(--surf2);border:1px solid var(--border2);border-radius:var(--rs);
  padding:8px 12px;transition:border-color .15s;min-height:36px;
  display:flex;align-items:center;
}
#sw.focused{border-color:var(--accent)}
#sw.err{border-color:var(--danger)}
.stripe-err{color:var(--danger);font-size:10px;margin-top:4px;min-height:14px;
  font-family:var(--mono)}
.test-hint{font-family:var(--mono);font-size:9px;color:var(--ink3);margin-top:6px;
  line-height:1.6}
.test-hint span{color:var(--accent)}

/* ── BUY BUTTON ── */
.buy-btn{
  width:100%;padding:10px;border-radius:var(--rs);
  background:var(--accent);color:#070b0f;
  font-family:var(--sans);font-weight:800;font-size:13px;letter-spacing:.01em;
  border:none;cursor:pointer;transition:opacity .15s,transform .1s;
  margin-top:10px;
}
.buy-btn:hover{opacity:.88}
.buy-btn:active{transform:scale(.98)}
.buy-btn:disabled{opacity:.4;cursor:not-allowed;transform:none}
.buy-btn.loading{opacity:.7;cursor:wait}

/* ── PREVIEW ── */
.preview-area{
  flex:1;display:flex;align-items:center;justify-content:center;
  padding:16px;background:var(--surf);min-height:200px;position:relative;
}
.preview-empty{
  display:flex;flex-direction:column;align-items:center;gap:10px;
  color:var(--ink3);font-size:11px;font-family:var(--mono);text-align:center;
}
#banner-canvas{max-width:100%;max-height:100%;display:none;border-radius:4px}

/* ── FSM BAR ── */
.fsm-bar{
  padding:8px 18px;border-top:1px solid var(--border);border-bottom:1px solid var(--border);
  display:flex;align-items:center;justify-content:space-between;flex-shrink:0;
  background:var(--surf);
}
.fsm-state{display:flex;align-items:center;gap:8px}
.fsm-dot{width:8px;height:8px;border-radius:50%;background:var(--ink3);flex-shrink:0;
  transition:background .3s}
.fsm-dot.running{background:var(--blue);box-shadow:0 0 6px var(--blue);animation:pulse 1s infinite}
.fsm-dot.success{background:var(--accent);box-shadow:0 0 6px var(--accent)}
.fsm-dot.failed{background:var(--danger)}
.fsm-dot.idle{background:var(--ink3)}
.fsm-state-txt{font-family:var(--mono);font-size:10px;color:var(--ink2)}
.step-ctr{font-family:var(--mono);font-size:10px;color:var(--ink3)}

/* ── PIPELINE ── */
.pipeline-bar{
  padding:10px 18px;border-top:1px solid var(--border);flex-shrink:0;
  background:var(--surf);
}
.pipeline-lbl{font-family:var(--mono);font-size:9px;color:var(--ink3);
  letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px}
.pipe-steps{display:flex;gap:4px;align-items:center}
.pipe-step{display:flex;flex-direction:column;align-items:center;gap:3px;flex:1}
.step-node{
  width:24px;height:24px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;
  font-family:var(--mono);font-size:9px;font-weight:700;
  border:1px solid var(--border2);color:var(--ink3);
  transition:all .25s;background:var(--surf2);
}
.step-node.running{border-color:var(--blue);color:var(--blue);
  box-shadow:0 0 8px var(--blue);animation:pulse 1s infinite}
.step-node.done{border-color:var(--accent);background:var(--accent-dim);
  color:var(--accent)}
.step-node.failed{border-color:var(--danger);background:var(--danger-dim);
  color:var(--danger)}
.step-node.skipped{border-color:var(--warn);background:var(--warn-dim);
  color:var(--warn)}
.step-nm{font-family:var(--mono);font-size:7px;color:var(--ink3);
  text-align:center;letter-spacing:.02em}

/* ── SABOTAGE ── */
.sab-sec{
  padding:10px 18px;border-bottom:1px solid var(--border);flex-shrink:0;
  background:rgba(248,81,73,.03);
}
.sab-lbl{font-family:var(--mono);font-size:9px;color:var(--danger);
  letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px}
.sab-row{display:flex;gap:5px;flex-wrap:wrap}
.sab-btn{
  font-family:var(--mono);font-size:9px;padding:4px 9px;border-radius:var(--rs);
  border:1px solid var(--border2);background:var(--surf2);color:var(--ink3);
  cursor:pointer;transition:all .15s;
}
.sab-btn:hover{border-color:var(--danger);color:var(--danger)}
.sab-btn.armed{border-color:var(--danger);color:var(--danger);
  background:var(--danger-dim);animation:armed-pulse 1s ease-in-out infinite}
@keyframes armed-pulse{0%,100%{box-shadow:0 0 0 0 rgba(248,81,73,.4)}
  50%{box-shadow:0 0 0 3px rgba(248,81,73,.1)}}

/* ── TRACE LOG ── */
.trace-log{flex:1;overflow-y:auto;padding:8px 12px;font-family:var(--mono);font-size:11px}
.trace-empty{color:var(--ink3);padding:20px;text-align:center;font-size:10px;
  line-height:1.7}
.te{padding:5px 0 5px 0;border-bottom:1px solid rgba(255,255,255,.03);
  display:flex;flex-wrap:wrap;align-items:baseline;gap:5px;line-height:1.5}
.te-ts{color:var(--ink3);font-size:9px;flex-shrink:0;width:72px}
.tag{font-size:8px;padding:2px 6px;border-radius:20px;font-weight:700;
  letter-spacing:.05em;flex-shrink:0}
.t-info{background:var(--blue-dim);color:var(--blue);border:1px solid var(--blue)}
.t-step{background:rgba(188,140,255,.1);color:var(--purple);border:1px solid var(--purple)}
.t-ok{background:var(--accent-dim);color:var(--accent);border:1px solid var(--accent)}
.t-sab{background:var(--danger-dim);color:var(--danger);border:1px solid var(--danger)}
.t-err{background:var(--danger-dim);color:var(--danger);border:1px solid var(--danger)}
.t-warn{background:var(--warn-dim);color:var(--warn);border:1px solid var(--warn)}
.t-fsm{background:rgba(0,212,161,.15);color:var(--accent);border:1px solid var(--accent)}
.t-vm{background:var(--blue-dim);color:var(--blue);border:1px solid var(--blue)}
.t-gov{background:rgba(188,140,255,.15);color:var(--purple);border:1px solid var(--purple)}
.t-pay{background:rgba(210,153,34,.15);color:var(--warn);border:1px solid var(--warn)}
.t-pdf{background:var(--accent-dim);color:var(--accent);border:1px solid var(--accent)}
.t-gdpr{background:rgba(248,81,73,.15);color:var(--danger);border:1px solid var(--danger)}
.te-msg{flex:1;color:var(--ink)}
.te-detail{width:100%;padding-left:88px;color:var(--ink2);font-size:9px;
  line-height:1.7;margin-top:2px}
.hash-row{
  width:100%;padding-left:88px;margin-top:3px;
  display:flex;align-items:center;gap:6px;font-size:9px;
}
.hash-block{background:var(--surf3);padding:2px 6px;border-radius:3px;
  color:var(--ink2);font-weight:700;letter-spacing:.03em}
.hash-block.new-hash{color:var(--accent)}
.chain-arrow{color:var(--ink3)}
.env-badge{background:var(--accent-dim);color:var(--accent);padding:2px 6px;
  border-radius:10px;font-size:8px;border:1px solid rgba(0,212,161,.3)}

/* ── TRACE STATS ── */
.trace-stats{
  padding:8px 18px;border-top:1px solid var(--border);flex-shrink:0;
  background:var(--surf);display:flex;gap:12px;flex-wrap:wrap;align-items:center;
}
.stat{font-family:var(--mono);font-size:9px;color:var(--ink3)}
.stat b{color:var(--ink2)}
.stat.ok b{color:var(--accent)}
.stat.danger b{color:var(--danger)}
.tact{display:flex;gap:6px}
.ibtn{font-family:var(--mono);font-size:9px;padding:3px 8px;
  border-radius:var(--rs);border:1px solid var(--border2);
  background:transparent;color:var(--ink3);cursor:pointer;transition:all .15s}
.ibtn:hover{border-color:var(--ink2);color:var(--ink)}
.ibtn.copied{border-color:var(--accent);color:var(--accent)}

/* ── MODAL ── */
.overlay{position:fixed;inset:0;background:rgba(7,11,15,.85);z-index:100;
  display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)}
.overlay.hidden{display:none}
.modal{background:var(--surf);border:1px solid var(--border2);border-radius:12px;
  padding:28px;max-width:400px;width:90%;text-align:center}
.m-icon{font-size:32px;margin-bottom:12px}
.m-icon.ok{color:var(--accent)}
.m-icon.err{color:var(--danger)}
.m-title{font-family:var(--sans);font-weight:800;font-size:18px;margin-bottom:8px}
.m-text{color:var(--ink2);font-size:12px;margin-bottom:12px;line-height:1.7}
.m-meta{font-family:var(--mono);font-size:9px;color:var(--ink3);margin-bottom:16px;
  background:var(--surf2);padding:10px;border-radius:var(--rs);text-align:left;
  line-height:1.8}
.m-btns{display:flex;gap:8px;justify-content:center}
.mbtn{padding:8px 20px;border-radius:var(--rs);border:none;cursor:pointer;
  font-family:var(--body);font-size:12px;font-weight:600;transition:opacity .15s}
.mbtn.pri{background:var(--accent);color:#070b0f}
.mbtn.sec{background:var(--surf2);color:var(--ink);border:1px solid var(--border2)}
.mbtn:hover{opacity:.85}

/* ── DIMS LABEL ── */
.dims-lbl{font-family:var(--mono);font-size:9px;color:var(--ink3);margin-top:4px}

/* ── TOOL INJECTION SPECIAL STYLING ── */
.te.tool-inject .te-msg{color:var(--danger)}
</style>
</head>
<body>

<header>
  <div class="logo">
    <div class="logo-dot"></div>
    <span>nano-vm</span>
    <span class="logo-sub">canonical execution runtime</span>
  </div>
  <div class="hbadges">
    <span class="badge b-green">v0.7.5</span>
    <span class="badge b-blue" id="hdr-status">IDLE</span>
    <span class="badge b-purple">ExecutionVM</span>
  </div>
</header>

<div class="app">

<!-- ═══ LEFT: CONFIG ═══ -->
<div class="col">
  <div class="ph"><span class="ph-title">// banner_config</span></div>

  <!-- Runtime Equation -->
  <div class="eq-bar">
    <span class="eq-formula">δ(S,E) → S'</span>
    <span class="eq-rule">Only policy-valid transitions<br>may mutate runtime state.</span>
  </div>

  <!-- Authority Banner -->
  <div class="authority-banner">
    <div class="auth-label">Invariant</div>
    <div class="auth-text">Model Output Is Not<br>Execution Authority</div>
  </div>

  <!-- Dimensions -->
  <div class="sec">
    <div class="sec-lbl">dimensions · mm</div>
    <div class="row2">
      <div class="ig">
        <span class="ig-lbl">WIDTH</span>
        <input type="number" id="iw" value="3000" min="100" max="20000" step="100">
      </div>
      <div class="ig">
        <span class="ig-lbl">HEIGHT</span>
        <input type="number" id="ih" value="1000" min="100" max="20000" step="100">
      </div>
    </div>
    <div class="dims-lbl" id="dims-lbl">3000 × 1000 mm</div>
  </div>

  <!-- Text -->
  <div class="sec">
    <div class="sec-lbl">banner_text · DeterministicSanitizer</div>
    <input type="text" id="itext" value="GRAND SALE" maxlength="200">
  </div>

  <!-- Background -->
  <div class="sec">
    <div class="sec-lbl">background</div>
    <div class="sw-row" id="bg-sw"></div>
  </div>

  <!-- Text Color -->
  <div class="sec">
    <div class="sec-lbl">text color</div>
    <div class="sw-row" id="tx-sw"></div>
  </div>

  <!-- Font -->
  <div class="sec">
    <div class="sec-lbl">font</div>
    <div class="font-row" id="font-row"></div>
  </div>

  <!-- Payment -->
  <div class="sec">
    <div class="sec-lbl">payment · Stripe test mode</div>
    <div id="sw"><div id="card-el" style="width:100%"></div></div>
    <div class="stripe-err" id="stripe-errors"></div>
    <div class="test-hint" id="test-hint">
      Test card: <span>4242 4242 4242 4242</span> · exp: 12/34 · CVC: 123
    </div>
    <button class="buy-btn" id="buy-btn" onclick="handleBuy()">Generate PDF · $2.99</button>
  </div>
</div>

<!-- ═══ CENTER: PREVIEW ═══ -->
<div class="col">
  <div class="ph"><span class="ph-title">// canvas_preview · banner-pdf-engine</span></div>

  <!-- Execution Collapse Counter (shown after governance_seal) -->
  <div class="collapse-panel" id="collapse-panel">
    <div class="collapse-title">Execution Collapse Resolution</div>
    <div class="collapse-grid">
      <div class="cc">
        <div class="cc-val red" id="cc-attempts">—</div>
        <div class="cc-lbl">Total Attempts</div>
      </div>
      <div class="cc">
        <div class="cc-val warn" id="cc-rejected">—</div>
        <div class="cc-lbl">Rejected</div>
      </div>
      <div class="cc">
        <div class="cc-val green" id="cc-accepted">—</div>
        <div class="cc-lbl">Canonical Steps</div>
      </div>
      <div class="cc">
        <div class="cc-val blue" id="cc-sideeffects">0</div>
        <div class="cc-lbl">Unauthorized Side Effects</div>
      </div>
    </div>
    <div class="collapse-verdict" id="cc-verdict" style="display:none">
      <span class="vc-seal">✦</span>
      <span id="cc-verdict-text">GOVERNANCE SEAL VERIFIED</span>
    </div>
  </div>

  <div class="preview-area">
    <div class="preview-empty" id="prev-empty">
      <svg width="44" height="44" fill="none" viewBox="0 0 44 44" opacity=".3">
        <rect x="2" y="6" width="40" height="32" rx="4" stroke="currentColor" stroke-width="1.5"/>
        <path d="M9 28l8-11 6 8 7-11 7 14H9Z" stroke="currentColor" stroke-width="1.5"/>
      </svg>
      Configure → preview updates live
    </div>
    <canvas id="banner-canvas"></canvas>
  </div>

  <div class="fsm-bar">
    <div class="fsm-state">
      <div class="fsm-dot idle" id="fsm-dot"></div>
      <span class="fsm-state-txt">state: <b id="fsm-txt">IDLE</b></span>
    </div>
    <div class="fsm-state" style="font-size:9px">
      trace_id: <b id="trace-disp" style="color:var(--ink2);margin-left:4px">—</b>
    </div>
    <span class="step-ctr" id="step-ctr">steps: 0/7</span>
  </div>

  <div class="pipeline-bar">
    <div class="pipeline-lbl">execution pipeline · ExecutionVM</div>
    <div class="pipe-steps" id="pipe"></div>
  </div>
</div>

<!-- ═══ RIGHT: TRACE LOG ═══ -->
<div class="col">
  <div class="ph">
    <span class="ph-title">// trace_log · real-time SSE</span>
    <div class="tact">
      <button class="ibtn" id="copy-btn" onclick="copyTrace()">⎘ copy</button>
      <button class="ibtn" onclick="clearTrace()">✕ clear</button>
    </div>
  </div>

  <div class="sab-sec">
    <div class="sab-lbl">⚠ FSM Chain Violation Injector</div>
    <div class="sab-row">
      <button class="sab-btn" id="sab-skip"    onclick="sabotage('skip_step')">skip_step</button>
      <button class="sab-btn" id="sab-corrupt" onclick="sabotage('corrupt_hash')">corrupt_hash</button>
      <button class="sab-btn" id="sab-double"  onclick="sabotage('double_exec')">double_exec</button>
      <button class="sab-btn" id="sab-reorder" onclick="sabotage('reorder')">reorder_steps</button>
      <button class="sab-btn" id="sab-inject"  onclick="sabotage('tool_injection')">tool_injection</button>
      <button class="sab-btn" id="sab-gdpr"    onclick="sabotage('gdpr_erase')">gdpr_erase</button>
    </div>
  </div>

  <div class="trace-log" id="tlog">
    <div class="trace-empty">Waiting for execution…<br>
      <span style="color:var(--ink3);font-size:9px">Configure → pay → watch FSM stream live</span>
    </div>
  </div>

  <div class="trace-stats">
    <span class="stat">entries: <b id="st-entries">0</b></span>
    <span class="stat">envelopes: <b id="st-env">0</b></span>
    <span class="stat" id="st-viol-wrap">violations: <b id="st-viol">0</b></span>
    <span class="stat ok" id="st-chain-wrap">chain: <b id="st-chain">intact</b></span>
    <span class="stat">duration: <b id="st-dur">—</b></span>
  </div>
</div>

</div><!-- .app -->

<!-- Modal: success -->
<div class="overlay hidden" id="mod-ok">
  <div class="modal">
    <div class="m-icon ok">✓</div>
    <div class="m-title">PDF Generated</div>
    <div class="m-text">Print-ready banner downloaded.<br>GovernanceEnvelope audit trail sealed.</div>
    <div class="m-meta" id="mod-meta"></div>
    <div class="m-btns">
      <button class="mbtn sec" onclick="closeModal('mod-ok')">Close</button>
      <button class="mbtn pri" onclick="closeModal('mod-ok');clearTrace()">New Banner</button>
    </div>
  </div>
</div>

<!-- Modal: error -->
<div class="overlay hidden" id="mod-err">
  <div class="modal">
    <div class="m-icon err">✕</div>
    <div class="m-title" id="mod-err-title">Error</div>
    <div class="m-text" id="mod-err-text"></div>
    <div class="m-btns">
      <button class="mbtn pri" onclick="closeModal('mod-err')">Close</button>
    </div>
  </div>
</div>

<script>
// ════════════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════════════
let stripe, cardEl;
let executionId = null;
let sse = null;
let logEntries = [];
let envCount = 0, violCount = 0, chainOk = true;
let stepDone = 0;
let armedSabotage = null;
let fsmRunning = false;
let lastTraceId = null;

// ════════════════════════════════════════════════════════════
// PALETTES
// ════════════════════════════════════════════════════════════
const BG_COLORS = [
  {id:'navy',    hex:'#1a1a2e',cmyk:[100,80,0,40], label:'Navy'},
  {id:'blue',    hex:'#0f3460',cmyk:[100,50,0,20], label:'Blue'},
  {id:'dark',    hex:'#16213e',cmyk:[100,70,0,60], label:'Dark'},
  {id:'red',     hex:'#c41e3a',cmyk:[0,100,80,20], label:'Red'},
  {id:'green',   hex:'#1b4332',cmyk:[80,0,60,30],  label:'Green'},
  {id:'charcoal',hex:'#2d2d2d',cmyk:[0,0,0,80],    label:'Charcoal'},
  {id:'white',   hex:'#f8f9fa',cmyk:[0,0,0,2],     label:'White'},
  {id:'orange',  hex:'#f4a261',cmyk:[0,40,70,0],   label:'Orange'},
];
const TX_COLORS = [
  {id:'white',hex:'#ffffff'},{id:'teal', hex:'#00d4a1'},
  {id:'gold', hex:'#ffd700'},{id:'red',  hex:'#ff6b6b'},
  {id:'dark', hex:'#1a1a2e'},{id:'light',hex:'#f8f9fa'},
];
const FONTS = [
  {id:'helvetica',label:'Helv',  css:'Helvetica, sans-serif',  w:700},
  {id:'times',    label:'Times', css:'Times New Roman, serif', w:700},
  {id:'courier',  label:'Mono',  css:'Courier New, monospace', w:700},
  {id:'impact',   label:'Impact',css:'Impact, sans-serif',      w:400},
];

const STEPS = [
  {id:'validate_config',       label:'validate'},
  {id:'sanitize_text',         label:'sanitize'},
  {id:'create_payment_intent', label:'pay_intent'},
  {id:'confirm_payment',       label:'confirm'},
  {id:'render_banner',         label:'render'},
  {id:'generate_pdf',          label:'pdf_gen'},
  {id:'governance_seal',       label:'gov_seal'},
];

let cfg = {bg: BG_COLORS[0], tx: TX_COLORS[0], font: FONTS[0]};

// ════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════
async function init() {
  let pk = 'pk_test_mock_demo_key_nanovo7';
  let isMock = false;
  try {
    const r = await fetch('/config/stripe-pk');
    const d = await r.json();
    if (d.pk) pk = d.pk;
    isMock = !!d.mock;
  } catch(_) {}

  if (isMock) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = '/stripe-mock-adapter.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
    stripe = window.StripeMock(pk);
    // Badges
    const bm = document.createElement('span');
    bm.className = 'badge b-warn';
    bm.textContent = 'stripe-mock';
    bm.title = 'Local stripe-mock — no real charges, no API keys needed';
    const hb = document.querySelector('.hbadges');
    hb.insertBefore(bm, hb.querySelector('.b-blue'));
    document.querySelector('.b-blue').textContent = 'MOCK MODE';
    // Hint
    const hint = document.getElementById('test-hint');
    if (hint) hint.innerHTML =
      'stripe-mock: any valid card number works<br>Try: <span>4242 4242 4242 4242</span> · 12/34 · 123';
  } else {
    stripe = Stripe(pk);
  }

  const els = stripe.elements ? stripe.elements({locale:'en'}) : stripe.elements();
  cardEl = els.create('card', {
    style:{
      base:{
        color:'#e2eaf3', fontFamily:'JetBrains Mono, monospace',
        fontSize:'13px', fontWeight:'500',
        '::placeholder':{color:'#404d5c'}, iconColor:'#8a97a8',
      },
      invalid:{color:'#f85149', iconColor:'#f85149'},
    },
    hidePostalCode: true,
  });
  cardEl.mount('#card-el');
  cardEl.on('focus', () => document.getElementById('sw').classList.add('focused'));
  cardEl.on('blur',  () => document.getElementById('sw').classList.remove('focused'));
  cardEl.on('change', e => {
    document.getElementById('stripe-errors').textContent = e.error ? e.error.message : '';
    document.getElementById('sw').classList.toggle('err', !!e.error);
  });

  buildPalette('bg-sw', BG_COLORS, 'bg', 0);
  buildPalette('tx-sw', TX_COLORS, 'tx', 0);
  buildFonts();
  buildPipeline();

  document.getElementById('itext').addEventListener('input', updatePreview);
  document.getElementById('iw').addEventListener('input', () => {
    document.getElementById('dims-lbl').textContent =
      `${document.getElementById('iw').value} × ${document.getElementById('ih').value} mm`;
    updatePreview();
  });
  document.getElementById('ih').addEventListener('input', () => {
    document.getElementById('dims-lbl').textContent =
      `${document.getElementById('iw').value} × ${document.getElementById('ih').value} mm`;
    updatePreview();
  });

  updatePreview();

  log('info','info','nano-vm FSM runtime initialized',
    'version: <b>v0.7.5</b> · engine: <b>ExecutionVM</b> · policy: <b>banner_print_v1</b>');
  log('info','info','DeterministicSanitizer ready · ASTEngine v0.7.5 · GovernanceEnvelope store online');
  log('pay','pay','Stripe test mode · no real charges · card: <code>4242 4242 4242 4242</code>');
  log('warn','warn','Sabotage injectors armed — stage FSM violations before payment');
}

// ════════════════════════════════════════════════════════════
// UI BUILDERS
// ════════════════════════════════════════════════════════════
function buildPalette(containerId, colors, key, activeIdx) {
  const el = document.getElementById(containerId);
  colors.forEach((c, i) => {
    const s = document.createElement('div');
    s.className = 'sw' + (i === activeIdx ? ' active' : '');
    s.style.background = c.hex;
    s.title = c.label || c.id;
    s.onclick = () => {
      el.querySelectorAll('.sw').forEach(x => x.classList.remove('active'));
      s.classList.add('active');
      cfg[key] = c;
      updatePreview();
    };
    el.appendChild(s);
  });
}

function buildFonts() {
  const el = document.getElementById('font-row');
  FONTS.forEach((f, i) => {
    const b = document.createElement('button');
    b.className = 'fb' + (i === 0 ? ' active' : '');
    b.textContent = f.label;
    b.style.fontFamily = f.css;
    b.onclick = () => {
      el.querySelectorAll('.fb').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      cfg.font = f;
      updatePreview();
    };
    el.appendChild(b);
  });
}

function buildPipeline() {
  const el = document.getElementById('pipe');
  el.innerHTML = '';
  STEPS.forEach((s, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'pipe-step';
    wrap.id = 'ps-' + s.id;
    const node = document.createElement('div');
    node.className = 'step-node';
    node.id = 'pn-' + s.id;
    node.textContent = i + 1;
    const nm = document.createElement('div');
    nm.className = 'step-nm';
    nm.textContent = s.label;
    wrap.appendChild(node);
    wrap.appendChild(nm);
    el.appendChild(wrap);
  });
}

function setNode(stepId, status) {
  const n = document.getElementById('pn-' + stepId);
  if (!n) return;
  n.className = 'step-node ' + status;
  if (status === 'done')        n.textContent = '✓';
  else if (status === 'failed') n.textContent = '✕';
  else if (status === 'skipped')n.textContent = '~';
  else {
    const idx = STEPS.findIndex(s => s.id === stepId);
    n.textContent = idx + 1;
  }
  const done = STEPS.filter(s => {
    const el = document.getElementById('pn-' + s.id);
    return el && ['done','failed','skipped'].some(c => el.classList.contains(c));
  }).length;
  document.getElementById('step-ctr').textContent = `steps: ${done}/${STEPS.length}`;
}

// ════════════════════════════════════════════════════════════
// CANVAS PREVIEW
// ════════════════════════════════════════════════════════════
function updatePreview() {
  const w = parseInt(document.getElementById('iw').value) || 3000;
  const h = parseInt(document.getElementById('ih').value) || 1000;
  const text = document.getElementById('itext').value || 'YOUR TEXT HERE';

  const canvas = document.getElementById('banner-canvas');
  const empty  = document.getElementById('prev-empty');

  const maxW = 580, maxH = 300;
  const ratio = Math.min(maxW / w, maxH / h);
  canvas.width  = Math.round(w * ratio);
  canvas.height = Math.round(h * ratio);

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = cfg.bg.hex;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = 'rgba(255,255,255,0.035)';
  ctx.lineWidth = 0.5;
  const gs = Math.max(16, canvas.width / 18);
  for (let x = 0; x < canvas.width; x += gs) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += gs) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }

  ctx.fillStyle = cfg.tx.hex;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let fs = canvas.height * 0.28;
  ctx.font = `${cfg.font.w} ${fs}px ${cfg.font.css}`;
  while (ctx.measureText(text).width > canvas.width * 0.92 && fs > 8) {
    fs--;
    ctx.font = `${cfg.font.w} ${fs}px ${cfg.font.css}`;
  }
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = canvas.height * 0.025;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  ctx.shadowColor = 'transparent';

  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 0.6;
  const m = 7, sz = 8;
  [[m,m],[canvas.width-m,m],[m,canvas.height-m],[canvas.width-m,canvas.height-m]].forEach(([cx,cy])=>{
    ctx.beginPath(); ctx.moveTo(cx-sz,cy); ctx.lineTo(cx+sz,cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx,cy-sz); ctx.lineTo(cx,cy+sz); ctx.stroke();
  });

  canvas.style.display = 'block';
  empty.style.display = 'none';
}

// ════════════════════════════════════════════════════════════
// TRACE LOG
// ════════════════════════════════════════════════════════════
function ts() { return new Date().toISOString().slice(11,23); }

function log(type, tagId, msg, detail = null, hashRow = null) {
  const el = document.getElementById('tlog');
  const empty = el.querySelector('.trace-empty');
  if (empty) empty.remove();

  const div = document.createElement('div');
  div.className = 'te ' + type;

  let html = `<span class="te-ts">${ts()}</span>`;
  html += `<span class="tag t-${tagId}">${tagId.toUpperCase()}</span>`;
  html += `<span class="te-msg">${msg}</span>`;
  if (detail) html += `<div class="te-detail">${detail}</div>`;
  if (hashRow) html += hashRow;
  div.innerHTML = html;

  el.appendChild(div);
  el.scrollTop = el.scrollHeight;

  logEntries.push({
    ts: ts(), type, tagId,
    msg: msg.replace(/<[^>]+>/g,''),
    detail: detail ? detail.replace(/<[^>]+>/g,'') : '',
  });
  document.getElementById('st-entries').textContent = logEntries.length;
}

function setFSM(state) {
  document.getElementById('fsm-txt').textContent = state;
  document.getElementById('fsm-dot').className = 'fsm-dot ' + state.toLowerCase();
  const b = document.getElementById('hdr-status');
  b.textContent = state;
  b.className = 'badge';
  if (state === 'RUNNING')  b.classList.add('b-blue');
  else if (state === 'SUCCESS') b.classList.add('b-green');
  else if (state === 'FAILED' || state.includes('EXCEEDED')) b.classList.add('b-danger');
  else b.classList.add('b-warn');
}

function hashRowHtml(prev, curr, envIdx) {
  return `<div class="hash-row">
    <span class="hash-block">${prev}</span>
    <span class="chain-arrow">→</span>
    <span class="hash-block new-hash">${curr}</span>
    <span class="env-badge">env[${envIdx}]</span>
  </div>`;
}

// ════════════════════════════════════════════════════════════
// EXECUTION COLLAPSE COUNTER
// ════════════════════════════════════════════════════════════
function showCollapseCounter(ev) {
  const panel = document.getElementById('collapse-panel');
  panel.classList.add('visible');

  const fmt = n => n.toLocaleString();

  // Animate counters
  animateCount('cc-attempts',   0, ev.total_attempts,    1200);
  animateCount('cc-rejected',   0, ev.rejected,          1100);
  animateCount('cc-accepted',   0, ev.accepted,           600);
  animateCount('cc-sideeffects',0, ev.side_effects_unauthorized, 400);

  // Show verdict after animation
  setTimeout(() => {
    const vd = document.getElementById('cc-verdict');
    const vt = document.getElementById('cc-verdict-text');
    vd.style.display = 'flex';
    if (ev.chain_valid) {
      vt.innerHTML =
        `<b>${fmt(ev.total_attempts)}</b> attempts · ` +
        `<b>${fmt(ev.rejected)}</b> rejected · ` +
        `<b>1</b> canonical graph committed · ` +
        `<b>0</b> unauthorized side effects — GOVERNANCE SEAL VERIFIED`;
    } else {
      vt.style.color = 'var(--danger)';
      vt.textContent = 'CHAIN INTEGRITY VIOLATION — GOVERNANCE SEAL FAILED';
    }
  }, 1400);
}

function animateCount(elId, from, to, duration) {
  const el = document.getElementById(elId);
  if (!el) return;
  const start = performance.now();
  function step(now) {
    const t = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    const val = Math.round(from + (to - from) * ease);
    el.textContent = val.toLocaleString();
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = to.toLocaleString();
  }
  requestAnimationFrame(step);
}

// ════════════════════════════════════════════════════════════
// SSE HANDLER
// ════════════════════════════════════════════════════════════
function connectSSE(execId) {
  if (sse) { sse.close(); sse = null; }
  sse = new EventSource(`/api/stream/${execId}`);
  sse.onmessage = (e) => {
    let ev;
    try { ev = JSON.parse(e.data); } catch(_) { return; }
    handleEvent(ev);
  };
  sse.onerror = () => {
    if (fsmRunning) log('warn','warn','SSE connection interrupted');
  };
}

function handleEvent(ev) {
  const t = ev.type;
  if (t === 'connected' || t === 'heartbeat') return;

  if (t === 'fsm_transition') {
    setFSM(ev.to_state);
    const cls = ev.to_state === 'SUCCESS' ? 'fsm' : ev.to_state === 'RUNNING' ? 'step' : 'error';
    log(cls, 'fsm', `<b>${ev.delta}</b>`,
      ev.policy_hash ? `policy_hash: <code>${ev.policy_hash?.slice(0,16)}</code>` :
                       ev.error ? `error: <b>${ev.error}</b>` : null);
    if (ev.to_state === 'SUCCESS') { fsmRunning = false; enableBuyBtn(); }
    if (ev.to_state === 'FAILED' || ev.to_state.includes('EXCEEDED')) {
      fsmRunning = false; enableBuyBtn();
    }
  }

  else if (t === 'program_compile') {
    log('info','vm', `ExecutionVM: compiling <b>${ev.steps?.length || 7}</b> steps`,
      'program: <code>banner_print_v1</code> · adapter: <code>MockLLMAdapter</code> (no LLM calls)');
  }

  else if (t === 'vm_start') {
    log('step','vm', `<b>ExecutionVM.run()</b> called`,
      `program: <code>${ev.program_name}</code> · policy_id: <code>${ev.policy_id}</code>` +
      `<br>policy_hash: <code>${ev.policy_hash?.slice(0,16)}…</code>`);
  }

  else if (t === 'step_start') {
    setNode(ev.step_id, 'running');
    const inp = ev.input ? Object.entries(ev.input)
      .map(([k,v]) => `${k}: <code>${String(v).slice(0,40)}</code>`)
      .join(' · ') : '';
    log('step','step',
      `→ <b>${ev.step_id}</b> <span style="color:var(--ink3);font-size:9px">[${ev.step_type}]</span>`,
      inp || null);
  }

  else if (t === 'step_done') {
    setNode(ev.step_id, 'done');
    stepDone++;
    envCount++;
    document.getElementById('st-env').textContent = envCount;

    const out = ev.output ? Object.entries(ev.output)
      .slice(0, 6)
      .map(([k,v]) => `${k}: <b>${String(v).slice(0,50)}</b>`)
      .join('<br>') : '';

    const extras = [];
    if (ev.stripe_live) extras.push('stripe: <code>live_test_api</code>');
    if (ev.sanitizer)   extras.push(`sanitizer: <code>${ev.sanitizer}</code>`);
    if (ev.ast_engine)  extras.push(`ast: <code>${ev.ast_engine}</code>`);
    if (ev.engine)      extras.push(`engine: <code>${ev.engine}</code>`);

    const detail = [out, extras.join(' · ')].filter(Boolean).join('<br>');
    log('step','ok', `✓ <b>${ev.step_id}</b> completed`, detail || null,
      ev.canonical_hash
        ? hashRowHtml(ev.prev_hash?.slice(0,8) || '00000000',
                      ev.canonical_hash,
                      ev.envelope_index ?? envCount - 1)
        : null);
  }

  else if (t === 'execution_collapse') {
    showCollapseCounter(ev);
    log('fsm','gov',
      `Execution Collapse: <b>${(ev.total_attempts||0).toLocaleString()}</b> attempts → <b>1</b> canonical graph`,
      `rejected: <b>${(ev.rejected||0).toLocaleString()}</b> · accepted: <b>${ev.accepted}</b> steps · ` +
      `side_effects_unauthorized: <b>${ev.side_effects_unauthorized}</b>`);
  }

  else if (t === 'sabotage_injected') {
    const isInject = ev.sabotage_type === 'tool_injection';
    const typeMap = {
      skip_step:      'sab',
      corrupt_hash:   'error',
      double_exec:    'warn',
      tool_injection: 'error',
    };
    const cls = typeMap[ev.sabotage_type] || 'warn';
    const icon = isInject ? '🚫' : '⚠';
    log(cls, 'sab',
      `${icon} ${isInject ? 'TOOL INJECTION BLOCKED' : 'SABOTAGE'}: <b>${ev.sabotage_type}</b> → <code>${ev.step_id}</code>`,
      ev.message + (ev.fsm_note ? `<br><span style="color:var(--accent)">${ev.fsm_note}</span>` : ''));
    violCount++;
    document.getElementById('st-viol').textContent = violCount;
    document.getElementById('st-viol-wrap').className = 'stat danger';
    if (ev.sabotage_type === 'corrupt_hash') {
      chainOk = false;
      document.getElementById('st-chain').textContent = '⚠ BROKEN';
      document.getElementById('st-chain-wrap').className = 'stat danger';
    }
  }

  else if (t === 'stripe_note') {
    log('info','pay', `Stripe note: ${ev.message}`);
  }

  else if (t === 'envelope') {
    // counted via step_done
  }

  else if (t === 'trace_complete') {
    lastTraceId = ev.trace_id;
    document.getElementById('trace-disp').textContent = ev.trace_id?.slice(0,18) + '…';
    document.getElementById('st-dur').textContent = ev.duration_ms + 'ms';

    const stepLines = (ev.step_statuses || [])
      .map(s => `${s.step_id}: <b>${s.status}</b> (${s.duration_ms}ms)`)
      .join('<br>');

    log('fsm','gov',
      `GovernanceEnvelope chain sealed · <b>${ev.envelopes}</b> envelopes`,
      `merkle_root: <code>${ev.merkle_root}</code>` +
      `<br>state_snapshots: <b>${ev.state_snapshots?.length || 0}</b>` +
      (stepLines ? `<br>${stepLines}` : ''));

    if (ev.status === 'success') {
      setTimeout(() => downloadPDF(executionId), 300);
      setTimeout(() => showSuccessModal(ev), 600);
    } else {
      STEPS.forEach(s => {
        const n = document.getElementById('pn-' + s.id);
        if (n && n.classList.contains('running')) setNode(s.id, 'failed');
      });
    }
  }

  else if (t === 'execution_error') {
    log('error','err', `<b>Execution error</b>: ${ev.error?.slice(0,120)}`);
    if (ev.traceback) {
      log('error','err',
        `<pre style="font-size:8px;color:var(--ink3);white-space:pre-wrap">${ev.traceback}</pre>`);
    }
    setFSM('FAILED');
    fsmRunning = false;
    enableBuyBtn();
    STEPS.forEach(s => {
      const n = document.getElementById('pn-' + s.id);
      if (n && n.classList.contains('running')) setNode(s.id, 'failed');
    });
    showErrorModal('FSM Execution Failed', ev.error || 'Unknown error');
  }

  else if (t === 'gdpr_erase') {
    log('gdpr','gdpr',
      `GDPR E_gdpr_erase · <b>${ev.erased_count}</b> ref(s) tombstoned`,
      `ref_ids: <code>${ev.ref_ids?.join(', ')}</code>` +
      `<br>tombstone_value: <code>[REDACTED_TOMBSTONE]</code>` +
      `<br>hash_chain: <b>${ev.hash_chain}</b> · policy_hash: <code>${ev.policy_hash?.slice(0,16)}</code>`,
      hashRowHtml('—', ev.canonical_hash, 'gdpr'));
  }

  else if (t === 'program_compiled') {
    log('info','vm', `Program compiled: <b>${ev.program_name}</b> · ${ev.step_count} steps`);
  }
}

// ════════════════════════════════════════════════════════════
// BUY HANDLER
// ════════════════════════════════════════════════════════════
async function handleBuy() {
  if (fsmRunning) return;
  fsmRunning = true;

  const btn = document.getElementById('buy-btn');
  btn.disabled = true;
  btn.classList.add('loading');
  btn.textContent = 'Processing…';
  document.getElementById('stripe-errors').textContent = '';

  // Reset UI
  STEPS.forEach(s => setNode(s.id, 'pending'));
  stepDone = 0; envCount = 0; chainOk = true;
  document.getElementById('st-env').textContent = '0';
  document.getElementById('trace-disp').textContent = '—';
  document.getElementById('st-dur').textContent = '—';
  document.getElementById('st-chain').textContent = 'intact';
  document.getElementById('st-chain-wrap').className = 'stat ok';

  // Reset collapse counter
  const cp = document.getElementById('collapse-panel');
  cp.classList.remove('visible');
  document.getElementById('cc-verdict').style.display = 'none';
  ['cc-attempts','cc-rejected','cc-accepted','cc-sideeffects'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '—';
  });

  setFSM('RUNNING');

  try {
    const {paymentMethod, error} = await stripe.createPaymentMethod({
      type: 'card',
      card: cardEl,
    });

    if (error) {
      document.getElementById('stripe-errors').textContent = error.message;
      document.getElementById('sw').classList.add('err');
      log('error','err', `Stripe tokenization failed: ${error.message}`);
      fsmRunning = false;
      enableBuyBtn();
      return;
    }

    log('pay','pay',
      `PaymentMethod created: <code>${paymentMethod.id.slice(0,18)}…</code>`,
      `brand: <b>${paymentMethod.card.brand}</b> · last4: <b>${paymentMethod.card.last4}</b>`);

    // Build sabotage flags for backend
    const sabFlags = {};
    if (armedSabotage === 'skip_step')    sabFlags['sanitize_text'] = 'skip';
    if (armedSabotage === 'corrupt_hash') sabFlags['validate_config'] = 'corrupt';
    if (armedSabotage === 'tool_injection') sabFlags['create_payment_intent'] = 'tool_injection';

    const resp = await fetch('/api/run', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        payment_method_id: paymentMethod.id,
        config: {
          width_mm:   parseInt(document.getElementById('iw').value) || 3000,
          height_mm:  parseInt(document.getElementById('ih').value) || 1000,
          text:       document.getElementById('itext').value || 'BANNER',
          bg_color:   cfg.bg.id,
          text_color: cfg.tx.id,
          font:       cfg.font.id,
        },
        sabotage_flags: sabFlags,
      }),
    });

    const data = await resp.json();
    if (!resp.ok) throw new Error(data.detail || 'Backend error');

    executionId = data.execution_id;
    connectSSE(executionId);

    // Standalone sabotage (no run needed)
    if (armedSabotage === 'double_exec' || armedSabotage === 'reorder') {
      await fetch('/api/sabotage', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          execution_id: executionId,
          step_id: 'any',
          sabotage_type: armedSabotage === 'double_exec' ? 'double' : 'reorder',
        }),
      });
    }

    armedSabotage = null;
    clearSabotageArmed();

  } catch(err) {
    log('error','err', `Request failed: <b>${err.message}</b>`);
    showErrorModal('Request Failed', err.message);
    fsmRunning = false;
    enableBuyBtn();
    setFSM('FAILED');
  }
}

function enableBuyBtn() {
  const btn = document.getElementById('buy-btn');
  btn.disabled = false;
  btn.classList.remove('loading');
  btn.textContent = 'Generate PDF · $2.99';
}

// ════════════════════════════════════════════════════════════
// PDF DOWNLOAD
// ════════════════════════════════════════════════════════════
async function downloadPDF(execId) {
  try {
    const resp = await fetch(`/api/pdf/${execId}`);
    if (!resp.ok) { log('warn','warn','PDF not ready — retrying…'); return; }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `banner_${execId}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    log('pdf','pdf', `PDF downloaded: <b>banner_${execId.slice(0,12)}.pdf</b>`,
      `size: <b>${(blob.size/1024).toFixed(1)} KB</b> · engine: <b>reportlab</b>`);
  } catch(e) {
    log('warn','warn', `PDF download failed: ${e.message}`);
  }
}

// ════════════════════════════════════════════════════════════
// SABOTAGE
// ════════════════════════════════════════════════════════════
function sabotage(type) {
  if (fsmRunning) return;

  if (type === 'gdpr_erase') { doGdprErase(); return; }

  armedSabotage = type;
  clearSabotageArmed();

  const btnMap = {
    'skip_step':    'sab-skip',
    'corrupt_hash': 'sab-corrupt',
    'double_exec':  'sab-double',
    'reorder':      'sab-reorder',
    'tool_injection':'sab-inject',
  };
  const b = document.getElementById(btnMap[type]);
  if (b) b.classList.add('armed');

  const msgs = {
    'skip_step':     `ARMED: <b>skip_step</b> → intercepts <code>sanitize_text</code>`,
    'corrupt_hash':  `ARMED: <b>corrupt_hash</b> → GovernanceEnvelope chain will break at <code>validate_config</code>`,
    'double_exec':   `ARMED: <b>double_exec</b> → δ(SUCCESS|FAILED, *) = NOP · FSM absorbing state`,
    'reorder':       `ARMED: <b>reorder_steps</b> → DSL order immutable · ExecutionVM enforces sequence`,
    'tool_injection':`ARMED: <b>tool_injection</b> → LLM will attempt <code>wire_transfer($50,000)</code> — GovernedToolExecutor will REJECT`,
  };
  log('sab','sab', msgs[type]);
}

function clearSabotageArmed() {
  ['sab-skip','sab-corrupt','sab-double','sab-reorder','sab-inject'].forEach(id => {
    const b = document.getElementById(id);
    const armed = {'skip_step':'sab-skip','corrupt_hash':'sab-corrupt',
                   'double_exec':'sab-double','reorder':'sab-reorder',
                   'tool_injection':'sab-inject'}[armedSabotage];
    if (b && id !== armed) b.classList.remove('armed');
  });
}

async function doGdprErase() {
  if (!executionId && !lastTraceId) {
    log('warn','warn','No active execution — run a payment first to demo GDPR erasure');
    return;
  }
  const fakeRef  = 'vault://secret/' + Math.random().toString(36).slice(2,10);
  const fakeRef2 = 'vault://secret/' + Math.random().toString(36).slice(2,10);

  log('gdpr','gdpr',
    `E_gdpr_erase issued → <code>${fakeRef}</code>, <code>${fakeRef2}</code>`,
    'GdprEraseEvent via ExecutionVM.erase() · GDPR Art.17');

  try {
    const resp = await fetch('/api/gdpr-erase', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        execution_id: executionId || 'demo',
        ref_ids: [fakeRef, fakeRef2],
      }),
    });
    const data = await resp.json();
    log('gdpr','ok',
      `GDPR erasure complete · <b>${data.erased_count}</b> refs tombstoned`,
      `tombstone: <code>[REDACTED_TOMBSTONE]</code> · hash_chain: <b>preserved</b>` +
      `<br>canonical_hash: <code>${data.canonical_hash}</code>`);
  } catch(e) {
    log('error','err', `GDPR erase failed: ${e.message}`);
  }
}

// ════════════════════════════════════════════════════════════
// MODALS
// ════════════════════════════════════════════════════════════
function showSuccessModal(ev) {
  document.getElementById('mod-meta').innerHTML =
    `trace_id: ${ev.trace_id}<br>` +
    `envelopes: ${ev.envelopes} · merkle_root: ${ev.merkle_root?.slice(0,16)}<br>` +
    `duration: ${ev.duration_ms}ms · steps: ${ev.step_statuses?.length || 7}/7`;
  document.getElementById('mod-ok').classList.remove('hidden');
}

function showErrorModal(title, text) {
  document.getElementById('mod-err-title').textContent = title;
  document.getElementById('mod-err-text').textContent = text;
  document.getElementById('mod-err').classList.remove('hidden');
}

function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

// ════════════════════════════════════════════════════════════
// TRACE COPY / CLEAR
// ════════════════════════════════════════════════════════════
function copyTrace() {
  const text = logEntries
    .map(e => `[${e.ts}] [${e.tagId.toUpperCase()}] ${e.msg}${e.detail ? ' | '+e.detail : ''}`)
    .join('\n');
  navigator.clipboard.writeText(text).then(() => {
    const b = document.getElementById('copy-btn');
    b.classList.add('copied'); b.textContent = '✓ copied';
    setTimeout(() => { b.classList.remove('copied'); b.textContent = '⎘ copy'; }, 1500);
  });
}

function clearTrace() {
  const el = document.getElementById('tlog');
  el.innerHTML = '<div class="trace-empty">Trace cleared. Ready for new execution.</div>';
  logEntries = [];
  envCount = 0; violCount = 0; chainOk = true; stepDone = 0;
  document.getElementById('st-entries').textContent = '0';
  document.getElementById('st-env').textContent = '0';
  document.getElementById('st-viol').textContent = '0';
  document.getElementById('st-viol-wrap').className = 'stat';
  document.getElementById('st-chain').textContent = 'intact';
  document.getElementById('st-chain-wrap').className = 'stat ok';
  document.getElementById('st-dur').textContent = '—';
  document.getElementById('trace-disp').textContent = '—';

  // Reset collapse counter
  document.getElementById('collapse-panel').classList.remove('visible');
  document.getElementById('cc-verdict').style.display = 'none';

  setFSM('IDLE');
  STEPS.forEach(s => setNode(s.id, 'pending'));
  armedSabotage = null;
  clearSabotageArmed();
  if (sse) { sse.close(); sse = null; }
  fsmRunning = false;
  enableBuyBtn();
}

// ════════════════════════════════════════════════════════════
// BOOT
// ════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', init);
</script>
</body>
</html>
