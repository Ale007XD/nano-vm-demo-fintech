/**
 * stripe-mock-adapter.js  v1.2
 * ─────────────────────────────────────────────────────────────────────────────
 * Drop-in replacement for Stripe.js when backend runs against stripe-mock.
 *
 * Changes vs v1.1:
 *  [A1] Debounce on card number input — no validate() on every keystroke
 *  [A2] Expiry year normalisation fixed — 2-digit → 4-digit correctly
 *  [A3] Auto-advance focus: number→exp→cvc after field completes
 *  [A4] unmount() actually removes the style tag and clears handlers
 *  [A5] Luhn is only called on complete-length numbers (≥13 digits)
 *  [A6] _onChange fires with brand on every keystroke (matches real Stripe.js)
 *  [A7] No global state leak — all state scoped to factory call
 *
 * Loaded dynamically by index.html when /config/stripe-pk returns {mock:true}.
 * Installs as window.StripeMock — call StripeMock(pk) instead of Stripe(pk).
 */

(function (root) {
  'use strict';

  // ── Helpers ────────────────────────────────────────────────────────────────

  function luhn(num) {
    // [A5] Only meaningful on complete card numbers
    let s = 0, alt = false;
    for (let i = num.length - 1; i >= 0; i--) {
      let d = parseInt(num[i], 10);
      if (alt) { d *= 2; if (d > 9) d -= 9; }
      s += d;
      alt = !alt;
    }
    return s % 10 === 0;
  }

  function detectBrand(n) {
    if (/^4/.test(n))            return 'visa';
    if (/^5[1-5]/.test(n))      return 'mastercard';
    if (/^2[2-7]/.test(n))      return 'mastercard'; // Mastercard 2-series
    if (/^3[47]/.test(n))       return 'amex';
    if (/^6(?:011|5)/.test(n))  return 'discover';
    if (/^35/.test(n))          return 'jcb';
    return 'unknown';
  }

  function brandIcon(b) {
    return { visa: '💙', mastercard: '🟠', amex: '💚', discover: '🔶', jcb: '🟣' }[b] || '💳';
  }

  function fmtCard(val) {
    const digits = val.replace(/\D/g, '').slice(0, 16);
    // Amex: 4-6-5 grouping; everything else: 4-4-4-4
    if (/^3[47]/.test(digits)) {
      return digits.replace(/^(\d{0,4})(\d{0,6})(\d{0,5}).*/, (_, a, b, c) =>
        [a, b, c].filter(Boolean).join(' '));
    }
    return digits.replace(/(.{4})/g, '$1 ').trim();
  }

  function fmtExp(val) {
    const digits = val.replace(/\D/g, '').slice(0, 4);
    if (digits.length >= 3) return digits.slice(0, 2) + '/' + digits.slice(2);
    return digits;
  }

  // [A1] Simple debounce — avoids validate() on every keystroke
  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  // ── CSS (injected once) ────────────────────────────────────────────────────
  const STYLE_ID = '__sm_style_v12__';
  const CARD_CSS = `
    .sm-card{display:flex;gap:8px;align-items:center;width:100%}
    .sm-inp{
      background:transparent;border:none;outline:none;
      color:#e2eaf3;font-family:'JetBrains Mono',monospace;
      font-size:13px;font-weight:500;
    }
    .sm-inp::placeholder{color:#404d5c}
    .sm-inp.sm-num{flex:1;min-width:0}
    .sm-inp.sm-exp{width:56px;flex-shrink:0;text-align:center}
    .sm-inp.sm-cvc{width:42px;flex-shrink:0;text-align:center}
    .sm-div{color:#404d5c;font-size:11px;flex-shrink:0;user-select:none}
    .sm-brand{font-size:14px;flex-shrink:0;transition:transform .15s}
    .sm-brand.flip{transform:scale(1.3)}
  `;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CARD_CSS;
    document.head.appendChild(style);
  }

  // [A4] Remove style if no instances remain
  let _instanceCount = 0;
  function removeStyleIfUnused() {
    _instanceCount = Math.max(0, _instanceCount - 1);
    if (_instanceCount === 0) {
      const el = document.getElementById(STYLE_ID);
      if (el) el.remove();
    }
  }

  // ── CardElement factory ────────────────────────────────────────────────────
  function createCardElement(_opts) {
    // Per-instance state — [A7] no global leak
    const state = {
      number: '', exp_month: '', exp_year: '', cvc: '',
      complete: false, error: null, brand: 'unknown',
    };

    let _mountEl   = null;
    let _cardWrap  = null;
    let _numInp    = null;
    let _expInp    = null;
    let _cvcInp    = null;
    let _brandSpan = null;

    let _onChange = null;
    let _onFocus  = null;
    let _onBlur   = null;

    // ── Validation ───────────────────────────────────────────────────────────

    function validate() {
      const n  = state.number.replace(/\s/g, '');
      const em = parseInt(state.exp_month, 10);
      const ey = parseInt(state.exp_year,  10);

      if (!n || n.length < 13)
        return 'Your card number is incomplete.';
      // [A5] luhn only on complete-length numbers
      if (n.length >= 13 && !luhn(n))
        return 'Your card number is invalid.';
      if (!em || em < 1 || em > 12)
        return 'Your card expiration month is invalid.';

      // [A2] always normalise to 4-digit year
      const fy = ey < 100 ? 2000 + ey : ey;
      const now = new Date();
      if (!ey || fy < now.getFullYear() ||
          (fy === now.getFullYear() && em < now.getMonth() + 1))
        return 'Your card has expired.';

      const isAmex = /^3[47]/.test(n);
      const cvcMin = isAmex ? 4 : 3;
      if (!state.cvc || state.cvc.length < cvcMin)
        return `Your card's security code is incomplete.`;

      return null;
    }

    function checkComplete() {
      const n     = state.number.replace(/\s/g, '');
      const error = validate();
      state.error    = error;
      state.complete = !error;
      state.brand    = detectBrand(n);

      if (_onChange) {
        _onChange({
          complete: state.complete,
          error:    error ? { message: error } : undefined,
          brand:    state.brand,
          value:    { postalCode: '' },
        });
      }
    }

    // Debounced version for keystroke events — [A1]
    const checkCompleteDebounced = debounce(checkComplete, 120);

    // ── DOM ──────────────────────────────────────────────────────────────────

    function buildDOM() {
      injectStyle();
      _instanceCount++;

      const wrap = document.createElement('div');
      wrap.className = 'sm-card';

      // Brand icon
      const brand = document.createElement('span');
      brand.className = 'sm-brand';
      brand.textContent = '💳';
      _brandSpan = brand;

      // Card number
      const numInp = document.createElement('input');
      numInp.className    = 'sm-inp sm-num';
      numInp.placeholder  = '1234 5678 9012 3456';
      numInp.inputMode    = 'numeric';
      numInp.maxLength    = 19;   // 16 digits + 3 spaces (4-4-4-4)
      numInp.autocomplete = 'cc-number';
      numInp.setAttribute('aria-label', 'Card number');
      _numInp = numInp;

      numInp.addEventListener('input', (e) => {
        const fmt  = fmtCard(e.target.value);
        e.target.value = fmt;
        state.number   = fmt;
        const digits   = fmt.replace(/\s/g, '');
        const newBrand = detectBrand(digits);
        if (newBrand !== state.brand) {
          // [A6] brand change → animate + fire onChange immediately
          brand.classList.add('flip');
          brand.textContent = brandIcon(newBrand);
          setTimeout(() => brand.classList.remove('flip'), 150);
        }
        // [A1] debounce validation; [A6] fire onChange on every keystroke for brand
        _onChange && _onChange({
          complete: false,
          error:    undefined,
          brand:    newBrand,
          value:    { postalCode: '' },
        });
        checkCompleteDebounced();
        // [A3] auto-advance when number is full
        if (digits.length === 16 || (newBrand === 'amex' && digits.length === 15)) {
          _expInp && _expInp.focus();
        }
      });
      numInp.addEventListener('focus', () => _onFocus && _onFocus());
      numInp.addEventListener('blur',  () => _onBlur  && _onBlur());

      const div1 = document.createElement('span');
      div1.className   = 'sm-div';
      div1.textContent = '·';
      div1.setAttribute('aria-hidden', 'true');

      // Expiry
      const expInp = document.createElement('input');
      expInp.className    = 'sm-inp sm-exp';
      expInp.placeholder  = 'MM/YY';
      expInp.inputMode    = 'numeric';
      expInp.maxLength    = 5;
      expInp.autocomplete = 'cc-exp';
      expInp.setAttribute('aria-label', 'Expiry date');
      _expInp = expInp;

      expInp.addEventListener('input', (e) => {
        const fmt = fmtExp(e.target.value);
        e.target.value = fmt;
        const [m, y]   = fmt.split('/');
        state.exp_month = m || '';
        state.exp_year  = y || '';
        checkCompleteDebounced();
        // [A3] auto-advance when expiry is complete (MM/YY = 5 chars)
        if (fmt.length === 5) {
          _cvcInp && _cvcInp.focus();
        }
      });
      // Handle backspace at start of field → jump back to number
      expInp.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && expInp.value === '') {
          _numInp && _numInp.focus();
        }
      });
      expInp.addEventListener('focus', () => _onFocus && _onFocus());
      expInp.addEventListener('blur',  () => _onBlur  && _onBlur());

      const div2 = document.createElement('span');
      div2.className   = 'sm-div';
      div2.textContent = '·';
      div2.setAttribute('aria-hidden', 'true');

      // CVC
      const cvcInp = document.createElement('input');
      cvcInp.className    = 'sm-inp sm-cvc';
      cvcInp.placeholder  = 'CVC';
      cvcInp.inputMode    = 'numeric';
      cvcInp.maxLength    = 4;
      cvcInp.autocomplete = 'cc-csc';
      cvcInp.setAttribute('aria-label', 'Security code');
      cvcInp.type = 'password';   // mask CVC on screen
      _cvcInp = cvcInp;

      cvcInp.addEventListener('input', (e) => {
        const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
        e.target.value = digits;
        state.cvc = digits;
        checkCompleteDebounced();
      });
      // Handle backspace at start of CVC → jump back to expiry
      cvcInp.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && cvcInp.value === '') {
          _expInp && _expInp.focus();
        }
      });
      cvcInp.addEventListener('focus', () => _onFocus && _onFocus());
      cvcInp.addEventListener('blur',  () => _onBlur  && _onBlur());

      wrap.append(brand, numInp, div1, expInp, div2, cvcInp);
      return wrap;
    }

    // ── Public CardElement API ────────────────────────────────────────────────

    return {
      mount(selector) {
        _mountEl = typeof selector === 'string'
          ? document.querySelector(selector)
          : selector;
        if (!_mountEl) {
          console.error('[stripe-mock-adapter] mount target not found:', selector);
          return;
        }
        _cardWrap = buildDOM();
        _mountEl.appendChild(_cardWrap);
      },

      on(event, handler) {
        if (event === 'change') _onChange = handler;
        if (event === 'focus')  _onFocus  = handler;
        if (event === 'blur')   _onBlur   = handler;
      },

      // [A4] proper cleanup — removes DOM, style, handlers
      unmount() {
        if (_mountEl && _cardWrap && _mountEl.contains(_cardWrap)) {
          _mountEl.removeChild(_cardWrap);
        }
        _cardWrap = null; _numInp = null; _expInp = null;
        _cvcInp   = null; _brandSpan = null; _mountEl = null;
        _onChange = null; _onFocus = null; _onBlur = null;
        removeStyleIfUnused();
      },

      // Expose current state for createPaymentMethod
      _getState() { return state; },
      _validate()  { return validate(); },
    };
  }

  // ── Elements factory ───────────────────────────────────────────────────────

  function Elements(_opts) {
    let _card = null;
    return {
      create(type, opts) {
        if (type === 'card') {
          _card = createCardElement(opts);
          return _card;
        }
        console.warn('[stripe-mock-adapter] only "card" element supported, got:', type);
        _card = createCardElement(opts);
        return _card;
      },
      getElement(type) {
        if (type === 'card') return _card;
        return null;
      },
    };
  }

  // ── MockStripe ─────────────────────────────────────────────────────────────

  function MockStripe(_pk) {
    let _elements = null;

    return {
      elements(opts) {
        _elements = Elements(opts);
        return _elements;
      },

      async createPaymentMethod({ type, card }) {
        // card here is the CardElement instance
        const state = card && card._getState ? card._getState() : {};
        const err   = card && card._validate  ? card._validate()  : 'No card element';

        if (err) return { error: { message: err } };

        const n     = (state.number || '').replace(/\s/g, '');
        const brand = detectBrand(n);
        const last4 = n.slice(-4);

        // [A2] correct 4-digit year
        const rawYear = parseInt(state.exp_year || '0', 10);
        const expYear = rawYear < 100 ? 2000 + rawYear : rawYear;
        const pmId    = 'pm_mock_' + Math.random().toString(36).slice(2, 14);

        return {
          paymentMethod: {
            id:     pmId,
            object: 'payment_method',
            type:   'card',
            card: {
              brand,
              last4,
              exp_month: parseInt(state.exp_month || '0', 10),
              exp_year:  expYear,
              funding:   'credit',
            },
            created:  Math.floor(Date.now() / 1000),
            livemode: false,
          },
        };
      },

      async confirmCardPayment(clientSecret, _data) {
        // stripe-mock handles confirm on backend — frontend resolves immediately
        return {
          paymentIntent: {
            status: 'succeeded',
            id: clientSecret ? clientSecret.split('_secret_')[0] : 'pi_mock',
          },
        };
      },

      async retrievePaymentIntent(_clientSecret) {
        return {
          paymentIntent: { status: 'succeeded', id: 'pi_mock' },
        };
      },
    };
  }

  // ── Install ────────────────────────────────────────────────────────────────
  root.StripeMock = MockStripe;
  console.info('[stripe-mock-adapter v1.2] installed — window.StripeMock ready');

}(window));
