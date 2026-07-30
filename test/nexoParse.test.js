// Fixtures are real responses captured from an S1F2L terminal. The first version of
// the confirmation flow read Result from InputResponse.Response, which is always
// undefined, so a shopper tapping "Yes" was reported as "did not answer" and the
// payment was never sent.
const test = require('node:test');
const assert = require('node:assert');
const { readInputResult, readEnableServiceResult } = require('../nexoParse');

const CONFIRMED = {
  SaleToPOIResponse: {
    InputResponse: {
      InputResult: {
        Device: 'CustomerInput',
        InfoQualify: 'Input',
        Input: { ConfirmedFlag: true, InputCommand: 'GetConfirmation' },
        Response: { Result: 'Success' }
      },
      OutputResult: {
        Device: 'CustomerDisplay',
        InfoQualify: 'Display',
        Response: { Result: 'Success' }
      }
    }
  }
};

const REJECTED = {
  SaleToPOIResponse: {
    InputResponse: {
      InputResult: {
        Device: 'CustomerDisplay',
        InfoQualify: 'Display',
        Response: {
          AdditionalResponse: 'message=PredefinedContent%20field%20missing%20and%20required.',
          ErrorCondition: 'MessageFormat',
          Result: 'Failure'
        }
      }
    }
  }
};

test('a confirmed GetConfirmation is read as a success', () => {
  const parsed = readInputResult(CONFIRMED);
  assert.strictEqual(parsed.result, 'Success');
  assert.strictEqual(parsed.confirmed, true);
});

test('a declined GetConfirmation succeeds but is not confirmed', () => {
  const declined = structuredClone(CONFIRMED);
  declined.SaleToPOIResponse.InputResponse.InputResult.Input.ConfirmedFlag = false;
  const parsed = readInputResult(declined);
  assert.strictEqual(parsed.result, 'Success');
  assert.strictEqual(parsed.confirmed, false);
});

test('a rejected input request reports the terminal explanation', () => {
  const parsed = readInputResult(REJECTED);
  assert.strictEqual(parsed.result, 'Failure');
  assert.strictEqual(parsed.errorCondition, 'MessageFormat');
  assert.strictEqual(parsed.message, 'PredefinedContent field missing and required.');
  assert.strictEqual(parsed.confirmed, false);
});

test('a Response directly under InputResponse is still accepted', () => {
  const parsed = readInputResult({
    SaleToPOIResponse: { InputResponse: { Response: { Result: 'Success' } } }
  });
  assert.strictEqual(parsed.result, 'Success');
});

test('an empty response yields no result rather than throwing', () => {
  assert.strictEqual(readInputResult({}).result, '');
  assert.strictEqual(readInputResult(undefined).confirmed, false);
});

test('an EnableService release is read as a success', () => {
  const parsed = readEnableServiceResult({
    SaleToPOIResponse: { EnableServiceResponse: { Response: { Result: 'Success' } } }
  });
  assert.strictEqual(parsed.result, 'Success');
});

test('an EnableService failure reports its error condition', () => {
  const parsed = readEnableServiceResult({
    SaleToPOIResponse: {
      EnableServiceResponse: {
        Response: { Result: 'Failure', ErrorCondition: 'UnavailableService' }
      }
    }
  });
  assert.strictEqual(parsed.result, 'Failure');
  assert.strictEqual(parsed.errorCondition, 'UnavailableService');
});
