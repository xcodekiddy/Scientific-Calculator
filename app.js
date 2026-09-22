/**
 * Scientific Calculator - user interface.
 *
 * Everything mathematical lives in engine.js; this file only decides what the
 * expression string should look like after a key press, and draws the result.
 */
(function () {
  'use strict';

  var engine = window.CalcEngine;
  var STORAGE_KEY = 'scientific-calculator/v1';
  var OPERATORS = ['+', '−', '×', '÷', '^'];
  var HISTORY_LIMIT = 20;

  // Multi-character insertions, longest first, so backspace removes a whole
  // "sin(" rather than leaving a stray "si".
  var CHUNKS = [
    'asin(', 'acos(', 'atan(', 'sinh(', 'cosh(', 'tanh(', 'log2(', 'sqrt(', 'cbrt(',
    'sin(', 'cos(', 'tan(', 'log(', 'abs(', 'ln(', '√(', '∛(',
    '^(−1)', '^(1÷', 'Ans', 'mod', '10^', 'e^'
  ];

  var el = {
    expression: document.getElementById('expression'),
    result: document.getElementById('result'),
    keys: document.getElementById('keys'),
    angleKey: document.getElementById('angle-key'),
    secondKey: document.getElementById('second-key'),
    angleFlag: document.getElementById('angle-flag'),
    secondFlag: document.getElementById('second-flag'),
    memoryFlag: document.getElementById('memory-flag'),
    history: document.getElementById('history-list'),
    historyEmpty: document.getElementById('history-empty'),
    historyClear: document.getElementById('clear-history')
  };

  var state = {
    expression: '',
    angleMode: 'deg',
    second: false,
    memory: 0,
    ans: 0,
    history: [],
    justEvaluated: false,
    error: null
  };

  /* Storage ------------------------------------------------------------ */
  // Best effort only: private windows and blocked site data make this throw.

  function load() {
    try {
      var saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
      if (saved.angleMode === 'rad' || saved.angleMode === 'deg') state.angleMode = saved.angleMode;
      if (typeof saved.memory === 'number' && isFinite(saved.memory)) state.memory = saved.memory;
      if (typeof saved.ans === 'number' && isFinite(saved.ans)) state.ans = saved.ans;
      if (Array.isArray(saved.history)) state.history = saved.history.slice(0, HISTORY_LIMIT);
    } catch (err) {
      /* carry on with the defaults */
    }
  }

  function save() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        angleMode: state.angleMode,
        memory: state.memory,
        ans: state.ans,
        history: state.history
      }));
    } catch (err) {
      /* nothing worth interrupting the user for */
    }
  }

  /* Helpers ------------------------------------------------------------ */

  function context() {
    return { angleMode: state.angleMode, ans: state.ans };
  }

  function forDisplay(value) {
    return engine.format(value, { group: true }).replace(/-/g, '−');
  }

  function trailingOperator(expr) {
    if (/mod$/.test(expr)) return 'mod';
    var last = expr.slice(-1);
    return OPERATORS.indexOf(last) === -1 ? '' : last;
  }

  function endsWithDecimal(expr) {
    return /[0-9.]*$/.exec(expr)[0].indexOf('.') !== -1;
  }

  /* Editing ------------------------------------------------------------ */

  function insert(text, kind) {
    state.error = null;

    if (state.justEvaluated) {
      // An operator continues from the answer; anything else starts afresh.
      state.expression = kind === 'op' ? 'Ans' : '';
      state.justEvaluated = false;
    }

    var expr = state.expression;

    if (kind === 'op') {
      var dangling = trailingOperator(expr);
      // Keep a minus after × ÷ ^ so negative operands can be typed.
      var isNegation = text.charAt(0) === '−' && '×÷^'.indexOf(dangling) !== -1;
      if (dangling && !isNegation) expr = expr.slice(0, expr.length - dangling.length);
    } else if (text === '.') {
      if (endsWithDecimal(expr)) return;
    } else if (text.length > 1 && /^[0-9]/.test(text) && /[0-9.]$/.test(expr)) {
      // "10^" straight after a number would silently join onto it.
      expr += '×';
    }

    state.expression = expr + text;
    render();
  }

  function backspace() {
    state.error = null;
    state.justEvaluated = false;

    var expr = state.expression;
    for (var i = 0; i < CHUNKS.length; i++) {
      if (expr.slice(-CHUNKS[i].length) === CHUNKS[i]) {
        state.expression = expr.slice(0, expr.length - CHUNKS[i].length);
        render();
        return;
      }
    }

    state.expression = expr.slice(0, -1);
    render();
  }

  function clearAll() {
    state.expression = '';
    state.error = null;
    state.justEvaluated = false;
    render();
  }

  /* Working it out ------------------------------------------------------ */

  function currentValue() {
    if (!state.expression.trim()) return state.ans;
    return engine.evaluate(state.expression, context());
  }

  function showError(err) {
    if (!(err instanceof engine.CalcError)) throw err;
    state.error = err.message;
    state.justEvaluated = false;
    render();
  }

  function equals() {
    if (!state.expression.trim()) return;
    try {
      var value = engine.evaluate(state.expression, context());
      state.ans = value;
      state.error = null;
      state.justEvaluated = true;
      state.history.unshift({ expr: state.expression, result: forDisplay(value) });
      state.history = state.history.slice(0, HISTORY_LIMIT);
      save();
      render();
    } catch (err) {
      showError(err);
    }
  }

  function memory(delta) {
    try {
      var value = currentValue();
      state.memory += delta * value;
      state.ans = value;
      state.error = null;
      state.justEvaluated = true;
      save();
      render();
    } catch (err) {
      showError(err);
    }
  }

  /* Keys ---------------------------------------------------------------- */

  function runAction(action) {
    switch (action) {
      case 'second':
        state.second = !state.second;
        applySecond();
        render();
        break;
      case 'angle':
        state.angleMode = state.angleMode === 'deg' ? 'rad' : 'deg';
        save();
        render();
        break;
      case 'clear': clearAll(); break;
      case 'back': backspace(); break;
      case 'equals': equals(); break;
      case 'mem-clear':
        state.memory = 0;
        save();
        render();
        break;
      case 'mem-recall':
        insert(engine.format(state.memory), 'value');
        break;
      case 'mem-add': memory(1); break;
      case 'mem-sub': memory(-1); break;
    }
  }

  function press(key) {
    var action = key.getAttribute('data-action');
    if (action) runAction(action);
    else insert(key.getAttribute('data-insert'), key.getAttribute('data-kind') || 'value');

    // 2nd is a one-shot shift, as on a real calculator.
    if (state.second && action !== 'second') {
      state.second = false;
      applySecond();
      render();
    }
  }

  function applySecond() {
    var keys = el.keys.querySelectorAll('[data-alt-label]');
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var data = key.dataset;
      key.textContent = state.second ? data.altLabel : data.baseLabel;
      if (data.altInsert) key.setAttribute('data-insert', state.second ? data.altInsert : data.baseInsert);
      if (data.altAction) key.setAttribute('data-action', state.second ? data.altAction : data.baseAction);
    }
    el.secondKey.setAttribute('aria-pressed', String(state.second));
  }

  function flash(key) {
    if (!key) return;
    key.classList.add('is-active');
    window.setTimeout(function () { key.classList.remove('is-active'); }, 110);
  }

  function findKey(selector, value) {
    var keys = el.keys.querySelectorAll('[' + selector + ']');
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].getAttribute(selector) === value) return keys[i];
    }
    return null;
  }

  /* Drawing -------------------------------------------------------------- */

  function render() {
    el.expression.textContent = state.expression;
    el.expression.scrollLeft = el.expression.scrollWidth;

    el.result.classList.remove('is-preview', 'is-error');

    if (state.error) {
      el.result.textContent = state.error;
      el.result.classList.add('is-error');
    } else if (state.justEvaluated) {
      el.result.textContent = forDisplay(state.ans);
    } else if (!state.expression.trim()) {
      el.result.textContent = '0';
      el.result.classList.add('is-preview');
    } else {
      var preview = '';
      try {
        preview = forDisplay(engine.evaluate(state.expression, context()));
      } catch (err) {
        preview = ''; // half-typed expressions simply have no preview yet
      }
      el.result.textContent = preview;
      el.result.classList.add('is-preview');
    }

    var angle = state.angleMode.toUpperCase();
    el.angleKey.textContent = angle;
    el.angleFlag.textContent = angle;
    el.secondFlag.hidden = !state.second;
    el.memoryFlag.hidden = state.memory === 0;

    renderHistory();
  }

  function renderHistory() {
    el.history.textContent = '';

    for (var i = 0; i < state.history.length; i++) {
      var entry = state.history[i];
      var item = document.createElement('li');
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'history-entry';
      button.dataset.index = String(i);

      var from = document.createElement('span');
      from.className = 'from';
      from.textContent = entry.expr;

      var to = document.createElement('span');
      to.className = 'to';
      to.textContent = '= ' + entry.result;

      button.appendChild(from);
      button.appendChild(to);
      item.appendChild(button);
      el.history.appendChild(item);
    }

    var empty = state.history.length === 0;
    el.historyEmpty.hidden = !empty;
    el.historyClear.hidden = empty;
  }

  /* Wiring ---------------------------------------------------------------- */

  function init() {
    // Remember each key's unshifted face before 2nd ever swaps it.
    var shiftable = el.keys.querySelectorAll('[data-alt-label]');
    for (var i = 0; i < shiftable.length; i++) {
      var key = shiftable[i];
      key.dataset.baseLabel = key.textContent;
      if (key.hasAttribute('data-insert')) key.dataset.baseInsert = key.getAttribute('data-insert');
      if (key.hasAttribute('data-action')) key.dataset.baseAction = key.getAttribute('data-action');
    }

    el.keys.addEventListener('click', function (event) {
      var key = event.target.closest('.key');
      if (key) press(key);
    });

    el.history.addEventListener('click', function (event) {
      var entry = event.target.closest('.history-entry');
      if (!entry) return;
      var item = state.history[Number(entry.dataset.index)];
      if (!item) return;
      state.expression = item.expr;
      state.justEvaluated = false;
      state.error = null;
      render();
    });

    el.historyClear.addEventListener('click', function () {
      state.history = [];
      save();
      render();
    });

    document.addEventListener('keydown', onKeyDown);

    load();
    applySecond();
    render();
  }

  function isKeyboardFocused() {
    var active = document.activeElement;
    if (!active || active === document.body) return false;
    try {
      return active.matches(':focus-visible');
    } catch (err) {
      return active.tagName === 'BUTTON' || active.tagName === 'SUMMARY';
    }
  }

  function onKeyDown(event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    var key = event.key;
    var pressed = null;

    if (key === 'Enter' || key === '=') {
      // If the user tabbed to a control, Enter belongs to that control and the
      // browser will click it. A control merely left focused by a mouse click
      // does not match :focus-visible, so Enter still means "work it out".
      if (isKeyboardFocused()) return;
      equals();
      pressed = findKey('data-action', 'equals');
    } else if (key === 'Backspace') {
      backspace();
      pressed = findKey('data-action', 'back');
    } else if (key === 'Escape' || key === 'Delete') {
      clearAll();
      pressed = findKey('data-action', 'clear');
    } else if (/^[0-9.]$/.test(key)) {
      insert(key, 'value');
      pressed = findKey('data-insert', key);
    } else if (key === '+' || key === '^') {
      insert(key, 'op');
      pressed = findKey('data-insert', key);
    } else if (key === '-' || key === '*' || key === '/') {
      var symbol = key === '-' ? '−' : key === '*' ? '×' : '÷';
      insert(symbol, 'op');
      pressed = findKey('data-insert', symbol);
    } else if (key === '(' || key === ')' || key === '%' || key === '!') {
      insert(key, key === '%' || key === '!' ? 'op' : 'value');
      pressed = findKey('data-insert', key);
    } else if (/^[a-z]$/i.test(key)) {
      // Function names can simply be typed: s, i, n, ( ...
      insert(key.toLowerCase(), 'value');
    } else {
      return;
    }

    flash(pressed);
    event.preventDefault();
  }

  init();
})();
