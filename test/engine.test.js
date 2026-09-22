'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { evaluate, format, CalcError } = require('../engine.js');

const deg = (expr) => evaluate(expr, { angleMode: 'deg' });
const rad = (expr) => evaluate(expr, { angleMode: 'rad' });
const near = (actual, expected, epsilon = 1e-10) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} is not close to ${expected}`);

test('arithmetic and precedence', () => {
  assert.strictEqual(deg('1+2'), 3);
  assert.strictEqual(deg('2+3×4'), 14);
  assert.strictEqual(deg('(2+3)×4'), 20);
  assert.strictEqual(deg('10÷4'), 2.5);
  assert.strictEqual(deg('7mod3'), 1);
  assert.strictEqual(deg('-7mod3'), 2, 'mod follows the sign of the divisor');
});

test('unary minus binds looser than a power', () => {
  assert.strictEqual(deg('-2^2'), -4);
  assert.strictEqual(deg('(-2)^2'), 4);
  assert.strictEqual(deg('2^-3'), 0.125);
  assert.strictEqual(deg('--5'), 5);
});

test('powers are right associative', () => {
  assert.strictEqual(deg('2^3^2'), 512);
});

test('implicit multiplication', () => {
  near(deg('2π'), 2 * Math.PI);
  assert.strictEqual(deg('2(3+4)'), 14);
  assert.strictEqual(deg('(1+2)(3+4)'), 21);
  assert.strictEqual(deg('2√9'), 6);
  near(deg('2e'), 2 * Math.E);
});

test('functions apply without parentheses too', () => {
  assert.strictEqual(deg('√9+1'), 4);
  assert.strictEqual(deg('√(9+7)'), 4);
  near(deg('sin30'), 0.5);
  near(deg('sin2^2'), Math.pow(Math.sin(2 * Math.PI / 180), 2), 1e-12);
});

test('trigonometry in degrees gives exact landmark values', () => {
  // sin(30) is 0.49999999999999994 in binary floating point; the display
  // rounding in format() is what turns it back into 0.5.
  near(deg('sin(30)'), 0.5);
  assert.strictEqual(format(deg('sin(30)')), '0.5');
  // These, on the other hand, must be exact: no amount of display rounding
  // turns Math.sin(Math.PI) = 1.2e-16 back into a clean 0.
  assert.strictEqual(deg('sin(180)'), 0);
  assert.strictEqual(deg('cos(90)'), 0);
  assert.strictEqual(deg('cos(180)'), -1);
  assert.strictEqual(deg('tan(0)'), 0);
  assert.strictEqual(format(deg('asin(0.5)')), '30');
  assert.strictEqual(deg('acos(0)'), 90);
  assert.throws(() => deg('tan(90)'), CalcError);
});

test('trigonometry in radians', () => {
  near(rad('sin(0)'), 0);
  near(rad('cos(0)'), 1);
  near(rad('sin(π÷2)'), 1);
  near(rad('atan(1)'), Math.PI / 4);
});

test('logarithms, roots and exponentials', () => {
  assert.strictEqual(deg('ln(e)'), 1);
  assert.strictEqual(deg('log(1000)'), 3);
  assert.strictEqual(deg('log2(8)'), 3);
  assert.strictEqual(deg('√(9)'), 3);
  assert.strictEqual(deg('∛(27)'), 3);
  assert.strictEqual(deg('∛(-27)'), -3);
  near(deg('exp(1)'), Math.E);
  assert.strictEqual(deg('abs(-4.5)'), 4.5);
  near(deg('sinh(1)'), Math.sinh(1));
});

test('factorial and percent', () => {
  assert.strictEqual(deg('5!'), 120);
  assert.strictEqual(deg('0!'), 1);
  assert.strictEqual(deg('3!^2'), 36, 'factorial binds tighter than a power');
  assert.strictEqual(deg('50%'), 0.5);
  assert.strictEqual(deg('200×10%'), 20);
  assert.throws(() => deg('(-1)!'), CalcError);
  assert.throws(() => deg('2.5!'), CalcError);
  assert.throws(() => deg('200!'), CalcError);
});

test('Ans carries the previous result', () => {
  assert.strictEqual(evaluate('Ans×2', { ans: 21 }), 42);
  assert.strictEqual(evaluate('ans+ans', { ans: 1.5 }), 3);
});

test('a missing closing parenthesis is forgiven', () => {
  assert.strictEqual(deg('2×(3+4'), 14);
  assert.strictEqual(deg('√(16'), 4);
});

test('bad input raises a CalcError, never a crash', () => {
  const bad = ['', '2+', '×5', '2++', '(2+3))', '1.2.3', 'wat', '1÷0', '()', '^2', '%5'];
  for (const expr of bad) {
    assert.throws(() => deg(expr), CalcError, `expected "${expr}" to be rejected`);
  }
});

test('division by zero is named, not silently infinite', () => {
  assert.throws(() => deg('1÷0'), { message: 'Cannot divide by zero' });
  assert.throws(() => deg('5mod0'), { message: 'Cannot divide by zero' });
});

test('whitespace, unicode operators and ASCII spellings are interchangeable', () => {
  assert.strictEqual(deg(' 2 * 3 '), 6);
  assert.strictEqual(deg('2 × 3'), 6);
  assert.strictEqual(deg('8 − 3'), 5);
  assert.strictEqual(deg('8 - 3'), 5);
  near(deg('SIN(30)'), 0.5);
  assert.strictEqual(deg('sqrt(25)'), 5);
  assert.strictEqual(deg('log10(100)'), 2);
  assert.strictEqual(deg('5²'), 25);
});

test('formatting hides floating-point noise', () => {
  assert.strictEqual(format(deg('0.1+0.2')), '0.3');
  assert.strictEqual(format(deg('1÷3')), '0.333333333333');
  assert.strictEqual(format(0), '0');
  assert.strictEqual(format(-0), '0');
  assert.strictEqual(format(42), '42');
  assert.strictEqual(format(-2.5), '-2.5');
});

test('formatting switches to exponential at the extremes', () => {
  assert.strictEqual(format(1.5e15), '1.5e+15');
  assert.strictEqual(format(2e-12), '2e-12');
  assert.strictEqual(format(deg('20!')), '2.43290200818e+18');
});

test('formatting can group thousands', () => {
  assert.strictEqual(format(1234567.25, { group: true }), '1,234,567.25');
  assert.strictEqual(format(-1000, { group: true }), '-1,000');
  assert.strictEqual(format(999, { group: true }), '999');
});
