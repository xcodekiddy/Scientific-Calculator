/**
 * Scientific Calculator - expression engine.
 *
 * Pure logic, no DOM. It loads as a plain <script> in the browser (as
 * window.CalcEngine) and through require() in Node, so the UI and the test
 * suite run exactly the same code.
 *
 * Pipeline: normalise -> tokenize -> shunting-yard to RPN -> evaluate.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CalcEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** Anything the user could reasonably be told about. */
  class CalcError extends Error {
    constructor(message) {
      super(message);
      this.name = 'CalcError';
    }
  }

  var DEG_PER_RAD = 180 / Math.PI;

  function mod(a, n) {
    return ((a % n) + n) % n;
  }

  function toRadians(x, angleMode) {
    return angleMode === 'rad' ? x : x / DEG_PER_RAD;
  }

  function fromRadians(x, angleMode) {
    return angleMode === 'rad' ? x : x * DEG_PER_RAD;
  }

  // Degrees get the exact answers people expect: sin(180) is 0, not 1.2e-16.
  function sinOf(x, angleMode) {
    if (angleMode === 'deg') {
      var m = mod(x, 360);
      if (m === 0 || m === 180) return 0;
      if (m === 90) return 1;
      if (m === 270) return -1;
    }
    return Math.sin(toRadians(x, angleMode));
  }

  function cosOf(x, angleMode) {
    if (angleMode === 'deg') {
      var m = mod(x, 360);
      if (m === 90 || m === 270) return 0;
      if (m === 0) return 1;
      if (m === 180) return -1;
    }
    return Math.cos(toRadians(x, angleMode));
  }

  function tanOf(x, angleMode) {
    if (angleMode === 'deg') {
      var m = mod(x, 180);
      if (m === 0) return 0;
      if (m === 90) throw new CalcError('tan is undefined at ' + x + ' degrees');
    }
    return Math.tan(toRadians(x, angleMode));
  }

  function factorial(n) {
    if (!Number.isInteger(n) || n < 0) {
      throw new CalcError('x! needs a whole number that is 0 or more');
    }
    if (n > 170) throw new CalcError('That factorial is too large to show');
    var result = 1;
    for (var i = 2; i <= n; i++) result *= i;
    return result;
  }

  var FUNCS = {
    sin: function (x, ctx) { return sinOf(x, ctx.angleMode); },
    cos: function (x, ctx) { return cosOf(x, ctx.angleMode); },
    tan: function (x, ctx) { return tanOf(x, ctx.angleMode); },
    asin: function (x, ctx) {
      if (x < -1 || x > 1) throw new CalcError('sin⁻¹ needs a number from -1 to 1');
      return fromRadians(Math.asin(x), ctx.angleMode);
    },
    acos: function (x, ctx) {
      if (x < -1 || x > 1) throw new CalcError('cos⁻¹ needs a number from -1 to 1');
      return fromRadians(Math.acos(x), ctx.angleMode);
    },
    atan: function (x, ctx) { return fromRadians(Math.atan(x), ctx.angleMode); },
    sinh: function (x) { return Math.sinh(x); },
    cosh: function (x) { return Math.cosh(x); },
    tanh: function (x) { return Math.tanh(x); },
    asinh: function (x) { return Math.asinh(x); },
    acosh: function (x) {
      if (x < 1) throw new CalcError('cosh⁻¹ needs a number of 1 or more');
      return Math.acosh(x);
    },
    atanh: function (x) {
      if (x <= -1 || x >= 1) throw new CalcError('tanh⁻¹ needs a number between -1 and 1');
      return Math.atanh(x);
    },
    ln: function (x) {
      if (x <= 0) throw new CalcError('ln needs a number greater than 0');
      return Math.log(x);
    },
    log: function (x) {
      if (x <= 0) throw new CalcError('log needs a number greater than 0');
      return Math.log10(x);
    },
    log2: function (x) {
      if (x <= 0) throw new CalcError('log₂ needs a number greater than 0');
      return Math.log2(x);
    },
    exp: function (x) { return Math.exp(x); },
    sqrt: function (x) {
      if (x < 0) throw new CalcError('√ needs a number that is 0 or more');
      return Math.sqrt(x);
    },
    cbrt: function (x) { return Math.cbrt(x); },
    abs: function (x) { return Math.abs(x); },
    sign: function (x) { return Math.sign(x); },
    floor: function (x) { return Math.floor(x); },
    ceil: function (x) { return Math.ceil(x); },
    round: function (x) { return Math.round(x); }
  };

  // Spellings people type instead of the canonical names above.
  var ALIASES = {
    arcsin: 'asin', arccos: 'acos', arctan: 'atan',
    arsinh: 'asinh', arcosh: 'acosh', artanh: 'atanh',
    lg: 'log', log10: 'log', lb: 'log2'
  };

  var CONSTS = {
    pi: function () { return Math.PI; },
    e: function () { return Math.E; },
    ans: function (ctx) { return ctx.ans; }
  };

  var OPS = {
    '+': { prec: 1, right: false, apply: function (a, b) { return a + b; } },
    '-': { prec: 1, right: false, apply: function (a, b) { return a - b; } },
    '*': { prec: 2, right: false, apply: function (a, b) { return a * b; } },
    '/': {
      prec: 2, right: false,
      apply: function (a, b) {
        if (b === 0) throw new CalcError('Cannot divide by zero');
        return a / b;
      }
    },
    mod: {
      prec: 2, right: false,
      apply: function (a, b) {
        if (b === 0) throw new CalcError('Cannot divide by zero');
        return mod(a, b);
      }
    },
    '^': { prec: 4, right: true, apply: function (a, b) { return Math.pow(a, b); } }
  };

  // Prefix operators. Unary minus binds looser than ^ so -2^2 is -4, while a
  // function binds tighter so sin2^2 is (sin 2)^2, as written on paper.
  function unaryPrec(name) {
    return name === 'neg' ? 3 : 5;
  }

  var REPLACEMENTS = [
    [/[×·∙•]/g, '*'],
    [/[÷∕]/g, '/'],
    [/[−–—]/g, '-'],
    [/π/g, 'pi'],
    [/√/g, 'sqrt'],
    [/∛/g, 'cbrt'],
    [/²/g, '^2'],
    [/³/g, '^3'],
    [/,/g, ''],
    [/\s+/g, '']
  ];

  function normalize(source) {
    var text = String(source);
    for (var i = 0; i < REPLACEMENTS.length; i++) {
      text = text.replace(REPLACEMENTS[i][0], REPLACEMENTS[i][1]);
    }
    return text.toLowerCase();
  }

  function resolveName(word) {
    if (Object.prototype.hasOwnProperty.call(ALIASES, word)) word = ALIASES[word];
    if (Object.prototype.hasOwnProperty.call(FUNCS, word)) return { kind: 'func', name: word };
    if (Object.prototype.hasOwnProperty.call(CONSTS, word)) return { kind: 'const', name: word };
    if (word === 'mod') return { kind: 'op', name: 'mod' };
    return null;
  }

  var NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)/;
  // Trailing digits so "log2" reads as one name; the longest-match loop in
  // tokenize() gives them back when they are not part of a name ("sin2").
  var WORD = /^[a-z]+\d*/;

  function tokenize(source) {
    var text = normalize(source);
    var tokens = [];
    var i = 0;
    // True when the next token has to start a value: at the start, after an
    // operator, and after '('. Drives unary minus and implicit multiplication.
    var expectValue = true;

    function implicitTimes() {
      if (!expectValue) tokens.push({ t: 'op', v: '*' });
    }

    // Reads one name at the cursor, longest match first, so "log2" wins over
    // "log" and "esin" splits into "e" then "sin". Returns how much it ate.
    function readName(word) {
      for (var len = word.length; len > 0; len--) {
        var found = resolveName(word.slice(0, len));
        if (!found) continue;

        if (found.kind === 'op') {
          if (expectValue) throw new CalcError('"mod" needs a number before it');
          tokens.push({ t: 'op', v: 'mod' });
          expectValue = true;
        } else if (found.kind === 'func') {
          implicitTimes();
          tokens.push({ t: 'un', v: found.name });
          expectValue = true;
        } else {
          implicitTimes();
          tokens.push({ t: 'const', v: found.name });
          expectValue = false;
        }
        return len;
      }
      throw new CalcError('I do not recognise "' + word + '"');
    }

    while (i < text.length) {
      var ch = text.charAt(i);

      if ((ch >= '0' && ch <= '9') || ch === '.') {
        var num = NUMBER.exec(text.slice(i));
        if (!num) throw new CalcError('Misplaced decimal point');
        i += num[0].length;
        if (text.charAt(i) === '.') throw new CalcError('Too many decimal points');
        implicitTimes();
        tokens.push({ t: 'num', v: parseFloat(num[0]) });
        expectValue = false;
        continue;
      }

      if (ch >= 'a' && ch <= 'z') {
        i += readName(WORD.exec(text.slice(i))[0]);
        continue;
      }

      if (ch === '(') {
        implicitTimes();
        tokens.push({ t: 'lparen' });
        expectValue = true;
        i++;
        continue;
      }

      if (ch === ')') {
        if (expectValue) throw new CalcError('Something is missing before ")"');
        tokens.push({ t: 'rparen' });
        expectValue = false;
        i++;
        continue;
      }

      if (ch === '!' || ch === '%') {
        if (expectValue) throw new CalcError('"' + ch + '" needs a number before it');
        tokens.push({ t: 'post', v: ch });
        expectValue = false;
        i++;
        continue;
      }

      if (ch === '+' || ch === '-') {
        if (expectValue) {
          if (ch === '-') tokens.push({ t: 'un', v: 'neg' });
          // A leading '+' means nothing, so drop it.
        } else {
          tokens.push({ t: 'op', v: ch });
          expectValue = true;
        }
        i++;
        continue;
      }

      if (ch === '*' || ch === '/' || ch === '^') {
        if (expectValue) throw new CalcError('"' + ch + '" needs a number before it');
        tokens.push({ t: 'op', v: ch });
        expectValue = true;
        i++;
        continue;
      }

      throw new CalcError('I do not understand "' + ch + '"');
    }

    return tokens;
  }

  function toRPN(tokens) {
    var out = [];
    var stack = [];

    for (var i = 0; i < tokens.length; i++) {
      var tk = tokens[i];

      if (tk.t === 'num' || tk.t === 'const' || tk.t === 'post') {
        // Postfix '!' and '%' bind tighter than anything else, so they can go
        // straight to the output right after their operand.
        out.push(tk);
      } else if (tk.t === 'un') {
        // Prefix operators never pop: their operand has not been read yet.
        stack.push(tk);
      } else if (tk.t === 'op') {
        var op = OPS[tk.v];
        while (stack.length) {
          var top = stack[stack.length - 1];
          if (top.t === 'lparen') break;
          var topPrec = top.t === 'un' ? unaryPrec(top.v) : OPS[top.v].prec;
          if (topPrec > op.prec || (topPrec === op.prec && !op.right)) out.push(stack.pop());
          else break;
        }
        stack.push(tk);
      } else if (tk.t === 'lparen') {
        stack.push(tk);
      } else if (tk.t === 'rparen') {
        var matched = false;
        while (stack.length) {
          var popped = stack.pop();
          if (popped.t === 'lparen') { matched = true; break; }
          out.push(popped);
        }
        if (!matched) throw new CalcError('There is a ")" with no matching "("');
      }
    }

    while (stack.length) {
      var last = stack.pop();
      if (last.t === 'lparen') continue; // A missing ')' is closed for you.
      out.push(last);
    }

    return out;
  }

  function evalRPN(rpn, ctx) {
    var stack = [];

    function pop() {
      if (!stack.length) throw new CalcError('That calculation looks unfinished');
      return stack.pop();
    }

    for (var i = 0; i < rpn.length; i++) {
      var tk = rpn[i];
      if (tk.t === 'num') {
        stack.push(tk.v);
      } else if (tk.t === 'const') {
        stack.push(CONSTS[tk.v](ctx));
      } else if (tk.t === 'un') {
        var x = pop();
        stack.push(tk.v === 'neg' ? -x : FUNCS[tk.v](x, ctx));
      } else if (tk.t === 'post') {
        var operand = pop();
        stack.push(tk.v === '!' ? factorial(operand) : operand / 100);
      } else {
        var b = pop();
        var a = pop();
        stack.push(OPS[tk.v].apply(a, b));
      }
    }

    if (stack.length !== 1) throw new CalcError('That calculation looks unfinished');
    return stack[0];
  }

  /**
   * Work out an expression.
   * @param {string} source      e.g. "sin(30) + 2×(3−4)"
   * @param {object} [options]   { angleMode: 'deg' | 'rad', ans: number }
   * @returns {number}
   */
  function evaluate(source, options) {
    var ctx = { angleMode: 'deg', ans: 0 };
    if (options) {
      if (options.angleMode) ctx.angleMode = options.angleMode;
      if (typeof options.ans === 'number') ctx.ans = options.ans;
    }

    var tokens = tokenize(source);
    if (!tokens.length) throw new CalcError('There is nothing to calculate');

    var value = evalRPN(toRPN(tokens), ctx);
    if (Number.isNaN(value)) throw new CalcError('That calculation has no answer');
    if (!Number.isFinite(value)) throw new CalcError('The answer is too large to show');
    return value;
  }

  function trimZeros(mantissa) {
    if (mantissa.indexOf('.') === -1) return mantissa;
    return mantissa.replace(/0+$/, '').replace(/\.$/, '');
  }

  function toExponentialString(value) {
    var parts = value.toExponential(11).split('e'); // 12 significant digits
    return trimZeros(parts[0]) + 'e' + parts[1];
  }

  function groupDigits(text) {
    var negative = text.charAt(0) === '-';
    var body = negative ? text.slice(1) : text;
    var dot = body.indexOf('.');
    var whole = dot === -1 ? body : body.slice(0, dot);
    var fraction = dot === -1 ? '' : body.slice(dot);
    return (negative ? '-' : '') + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + fraction;
  }

  /**
   * Turn a result into something worth reading: floating-point noise rounded
   * away at 12 significant digits, exponential notation at the extremes.
   * @param {number} value
   * @param {object} [options]  { group: boolean } for thousands separators
   */
  function format(value, options) {
    if (!Number.isFinite(value)) return 'Error';
    if (value === 0) return '0';

    var magnitude = Math.abs(value);
    if (magnitude >= 1e12 || magnitude < 1e-9) return toExponentialString(value);

    var rounded = Number(value.toPrecision(12));
    var text = String(rounded);
    if (text.indexOf('e') !== -1) return toExponentialString(rounded);
    return options && options.group ? groupDigits(text) : text;
  }

  return {
    CalcError: CalcError,
    evaluate: evaluate,
    format: format,
    tokenize: tokenize,
    FUNCS: FUNCS,
    CONSTS: CONSTS
  };
});
