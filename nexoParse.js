// Reading results out of a SaleToPOIResponse is easy to get wrong, because where
// the Response object sits differs per message. These helpers keep that knowledge
// in one place so it can be tested against real terminal payloads instead of being
// rediscovered by watching a terminal hang.

// An InputResponse reports its outcome inside InputResult, not directly under
// InputResponse. That holds for both the success and the MessageFormat rejection.
// The direct location is still accepted as a fallback, since the spec allows it and
// other terminal models may use it.
function readInputResult(data) {
  const inputResponse = data?.SaleToPOIResponse?.InputResponse;
  const response = inputResponse?.InputResult?.Response || inputResponse?.Response;
  return {
    result: response?.Result || '',
    errorCondition: response?.ErrorCondition || '',
    message: readAdditionalMessage(response),
    // Only meaningful for a GetConfirmation: true is the right-hand button.
    confirmed: inputResponse?.InputResult?.Input?.ConfirmedFlag === true
  };
}

// EnableService is documented as reporting Response directly, but the same
// InputResult-style nesting is tolerated so a successful release is never reported
// as a failure.
function readEnableServiceResult(data) {
  const enableResponse = data?.SaleToPOIResponse?.EnableServiceResponse;
  const response = enableResponse?.Response || enableResponse?.EnableServiceResult?.Response;
  return {
    result: response?.Result || '',
    errorCondition: response?.ErrorCondition || '',
    message: readAdditionalMessage(response)
  };
}

// AdditionalResponse carries the terminal's own explanation as form-encoded text.
function readAdditionalMessage(response) {
  try {
    return new URLSearchParams(response?.AdditionalResponse || '').get('message') || '';
  } catch {
    return '';
  }
}

module.exports = { readInputResult, readEnableServiceResult, readAdditionalMessage };
