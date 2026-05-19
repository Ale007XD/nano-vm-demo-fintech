/**
 * stripe-mock-adapter.js  v1.1
 * ─────────────────────────────
 * Drop-in replacement for Stripe.js when backend runs against stripe-mock HTTP server.
 *
 * What it does:
 *  - Renders a native card input element (no iframes, no Stripe.js network calls)
 *  - createPaymentMethod() validates locally, returns pm_mock_<random> without network
 *  - confirmCardPayment() is a no-op (backend handles confirm via stripe-mock REST)
 *  - Luhn validation + brand detection + expiry check
 *
 * Loaded dynamically by index.html when /config/stripe-pk returns { mock: true }.
 * Installs as window.StripeMock — call StripeMock(pk) instead of Stripe(pk).
 */

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  const state = {
    number: '', exp_month: '', exp_year: '', cvc: '',
    complete: false, error: null,
  };

  let _mountEl = null;
  let _onChange = null, _onFocus = null, _onBlur = null;

  // ── Helpers ────────────────────────────────────────────────────────────────
  function luhn(num) {
    let s = 0, alt = false;
    for (let i = num.length - 1; i >= 0; i--) {
      let d = parseInt(num[i], 10);
      if (alt) { d *= 2; if (d > 9) d -= 9; }
      s += d; alt = !alt;
    }
    return s % 10 === 0;
  }

  function detectBrand(n) {
    if (/^4/.test(n))       return 'visa';
    if (/^5[1-5]/.test(n)) return 'mastercard';
    if (/^3[47]/.test(n))  return 'amex';
    if (/^6(?:011|5)/.test(n)) return 'discover';
    return 'unknown';
  }

  function brandEmoji(b) {
    return { visa: '💙', mastercard: '🟠', amex: '💚', discover: '🔶' }[b] || '💳';
  }

  function fmtCard(val) {
    return val.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
  }

  function validate() {
    const n = state.number.replace(/\s/g, '');
    const em = parseInt(state.exp_month, 10);
    const ey = parseInt(state.exp_year, 10);
    const now = new Date();
    if (!n || n.length < 13)          return 'Your card number is incomplete.';
    if (!luhn(n))                      return 'Your card number is invalid.';
    if (!em || em < 1 || em > 12)     return 'Your card expiration month is invalid.';
    const fy = ey < 100 ? 2000 + ey : ey;
    if (!ey || fy < now.getFullYear() ||
        (fy === now.getFullYear() && em < now.getMonth() + 1))
      return 'Your card has expired.';
    if (!state.cvc || state.cvc.length < 3)
      return "Your card's security code is incomplete.";
    return null;
  }

  function checkComplete() {
    const n = state.number.replace(/\s/g, '');
    state.error = validate();
    state.complete = !state.error && n.length >= 13 &&
      state.exp_month.length >= 1 && state.exp_year.length >= 2 &&
      state.cvc.length >= 3;
    if (_onChange) {
      _onChange({
        complete: state.complete,
        error: state.error ? { message: state.error } : undefined,
        brand: detectBrand(n),
        value: { postalCode: '' },
      });
    }
  }

  // ── Card element DOM ───────────────────────────────────────────────────────
  const CARD_CSS = `
    .sm-card{display:flex;gap:8px;align-items:center;width:100%}
    .sm-inp{
      background:transparent;border:none;outline:none;
      color:#e2eaf3;font-family:'JetBrains Mono',monospace;font-size:13px;
      font-weight:500;width:100%;
    }
    .sm-inp::placeholder{color:#404d5c}
    .sm-inp.sm-num{flex:1;min-width:0}
    .sm-inp.sm-exp{width:52px;flex-shrink:0;text-align:center}
    .sm-inp.sm-cvc{width:38px;flex-shrink:0;text-align:center}
    .sm-div{color:#404d5c;font-size:11px;flex-shrink:0;user-select:none}
    .sm-brand{font-size:14px;flex-shrink:0}
  `;

  function buildCardDOM() {
    if (!document.getElementById('__sm_style__')) {
      const style = document.createElement('style');
      style.id = '__sm_style__';
      style.textContent = CARD_CSS;
      document.head.appendChild(style);
    }

    const wrap = document.createElement('div');
    wrap.className = 'sm-card';

    const brand = document.createElement('span');
    brand.className = 'sm-brand';
    brand.id = '__sm_brand__';
    brand.textContent = '💳';

    const numInp = document.createElement('input');
    numInp.className = 'sm-inp sm-num';
    numInp.placeholder = '1234 5678 9012 3456';
    numInp.inputMode = 'numeric';
    numInp.maxLength = 19;
    numInp.autocomplete = 'cc-number';
    numInp.addEventListener('input', e => {
      const fmt = fmtCard(e.target.value);
      e.target.value = fmt;
      state.number = fmt;
      const n = fmt.replace(/\s/g, '');
      brand.textContent = brandEmoji(detectBrand(n));
      checkComplete();
    });
    numInp.addEventListener('focus', () => _onFocus && _onFocus());
    numInp.addEventListener('blur',  () => _onBlur  && _onBlur());

    const div1 = document.createElement('span');
    div1.className = 'sm-div'; div1.textContent = '·';

    const expInp = document.createElement('input');
    expInp.className = 'sm-inp sm-exp';
    expInp.placeholder = 'MM/YY';
    expInp.inputMode = 'numeric';
    expInp.maxLength = 5;
    expInp.autocomplete = 'cc-exp';
    expInp.addEventListener('input', e => {
      let v = e.target.value.replace(/\D/g, '').slice(0, 4);
      if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2);
      e.target.value = v;
      const [m, y] = v.split('/');
      state.exp_month = m || '';
      state.exp_year = y || '';
      checkComplete();
    });
    expInp.addEventListener('focus', () => _onFocus && _onFocus());
    expInp.addEventListener('blur',  () => _onBlur  && _onBlur());

    const div2 = document.createElement('span');
    div2.className = 'sm-div'; div2.textContent = '·';

    const cvcInp = document.createElement('input');
    cvcInp.className = 'sm-inp sm-cvc';
    cvcInp.placeholder = 'CVC';
    cvcInp.inputMode = 'numeric';
    cvcInp.maxLength = 4;
    cvcInp.autocomplete = 'cc-csc';
    cvcInp.addEventListener('input', e => {
      state.cvc = e.target.value.replace(/\D/g, '').slice(0, 4);
      e.target.value = state.cvc;
      checkComplete();
    });
    cvcInp.addEventListener('focus', () => _onFocus && _onFocus());
    cvcInp.addEventListener('blur',  () => _onBlur  && _onBlur());

    wrap.append(brand, numInp, div1, expInp, div2, cvcInp);
    return wrap;
  }

  // ── CardElement ────────────────────────────────────────────────────────────
  const CardElement = {
    _el: null,
    mount(selector) {
      _mountEl = typeof selector === 'string'
        ? document.querySelector(selector)
        : selector;
      if (!_mountEl) {
        console.error('[stripe-mock-adapter] mount target not found:', selector);
        return;
      }
      this._el = buildCardDOM();
      _mountEl.appendChild(this._el);
    },
    on(event, handler) {
      if (event === 'change') _onChange = handler;
      if (event === 'focus')  _onFocus  = handler;
      if (event === 'blur')   _onBlur   = handler;
    },
    unmount() {
      if (_mountEl && this._el) _mountEl.removeChild(this._el);
    },
  };

  // ── Elements factory ───────────────────────────────────────────────────────
  function Elements(_opts) {
    return {
      create(type, _style) {
        if (type === 'card') return CardElement;
        console.warn('[stripe-mock-adapter] only "card" element supported, got:', type);
        return CardElement;
      },
      getElement(type) {
        if (type === 'card') return CardElement;
        return null;
      },
    };
  }

  // ── MockStripe ─────────────────────────────────────────────────────────────
  function MockStripe(_pk) {
    return {
      elements(opts) { return Elements(opts); },

      async createPaymentMethod({ type, card }) {
        const err = validate();
        if (err) return { error: { message: err } };

        const n = state.number.replace(/\s/g, '');
        const brand = detectBrand(n);
        const last4 = n.slice(-4);
        const pmId = 'pm_mock_' + Math.random().toString(36).slice(2, 14);

        return {
          paymentMethod: {
            id: pmId,
            object: 'payment_method',
            type: 'card',
            card: {
              brand, last4,
              exp_month: parseInt(state.exp_month, 10),
              exp_year: 2000 + parseInt(state.exp_year.slice(-2), 10),
              funding: 'credit',
            },
            created: Math.floor(Date.now() / 1000),
            livemode: false,
          },
        };
      },

      async confirmCardPayment(clientSecret, _data) {
        // stripe-mock handles confirm on backend — frontend just resolves
        return {
          paymentIntent: {
            status: 'succeeded',
            id: clientSecret ? clientSecret.split('_secret_')[0] : 'pi_mock',
          },
        };
      },

      async retrievePaymentIntent(clientSecret) {
        return {
          paymentIntent: { status: 'succeeded', id: 'pi_mock' },
        };
      },
    };
  }

  // ── Install ────────────────────────────────────────────────────────────────
  window.StripeMock = MockStripe;
  console.info('[stripe-mock-adapter v1.1] installed — window.StripeMock ready');

})();
