/**
 * @file client/js/validators.js
 * @description Frontend Form Validation Engine.
 * Validates inputs client-side, displays inline error messages under each field,
 * sets aria-invalid, and maps server-side field errors back to inputs.
 */

const validators = {
  /**
   * Clears inline error from a specific input element.
   */
  clearFieldError(inputEl) {
    if (!inputEl) return;
    inputEl.classList.remove('is-invalid');
    inputEl.removeAttribute('aria-invalid');
    const parent = inputEl.closest('.form-group') || inputEl.parentElement;
    const msgEl = parent.querySelector('.field-error-msg');
    if (msgEl) msgEl.remove();
  },

  /**
   * Displays an inline error message beneath an input element.
   */
  showFieldError(inputEl, message) {
    if (!inputEl) return;
    this.clearFieldError(inputEl);
    inputEl.classList.add('is-invalid');
    inputEl.setAttribute('aria-invalid', 'true');

    const errorEl = document.createElement('div');
    errorEl.className = 'field-error-msg';
    errorEl.innerHTML = `<i class="bi bi-exclamation-circle-fill me-1"></i>${utils.escapeHtml(message)}`;

    const parent = inputEl.closest('.form-group') || inputEl.parentElement;
    parent.appendChild(errorEl);
  },

  /**
   * Maps server-returned field errors { [field]: message } to form inputs.
   */
  showServerErrors(formEl, fieldErrors = {}) {
    if (!formEl || !fieldErrors) return;
    let firstInvalid = null;

    for (const [field, message] of Object.entries(fieldErrors)) {
      const input = formEl.querySelector(`[name="${field}"], #${field}, #e_${field}, #edit_${field}`);
      if (input) {
        this.showFieldError(input, message);
        if (!firstInvalid) firstInvalid = input;
      }
    }

    if (firstInvalid) firstInvalid.focus();
  },

  /**
   * Validates a form against a declarative rules object.
   * @param {HTMLFormElement} formEl
   * @param {Object} rules - Map of input name/ID to rules
   * @returns {boolean} true if valid
   */
  validateForm(formEl, rules = {}) {
    if (!formEl) return true;
    let isValid = true;
    let firstInvalid = null;

    for (const [field, rule] of Object.entries(rules)) {
      const input = formEl.querySelector(`[name="${field}"], #${field}, #e_${field}, #edit_${field}`);
      if (!input) continue;

      this.clearFieldError(input);
      const val = input.value.trim();

      // Required check
      if (rule.required && !val) {
        isValid = false;
        this.showFieldError(input, rule.message || `${rule.label || 'This field'} is required.`);
        if (!firstInvalid) firstInvalid = input;
        continue;
      }

      if (!val) continue;

      // Email check
      if (rule.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
        isValid = false;
        this.showFieldError(input, 'Please enter a valid email address.');
        if (!firstInvalid) firstInvalid = input;
        continue;
      }

      // Phone check (Indian 10-digit)
      if (rule.type === 'phone') {
        const digits = val.replace(/[\s\-+]/g, '').slice(-10);
        if (!/^[6-9]\d{9}$/.test(digits)) {
          isValid = false;
          this.showFieldError(input, 'Please enter a valid 10-digit mobile number.');
          if (!firstInvalid) firstInvalid = input;
          continue;
        }
      }

      // Min/Max length
      if (rule.minLength && val.length < rule.minLength) {
        isValid = false;
        this.showFieldError(input, `Must be at least ${rule.minLength} characters.`);
        if (!firstInvalid) firstInvalid = input;
        continue;
      }

      // Custom regex pattern
      if (rule.pattern && !rule.pattern.test(val)) {
        isValid = false;
        this.showFieldError(input, rule.message || 'Invalid format.');
        if (!firstInvalid) firstInvalid = input;
        continue;
      }
    }

    if (firstInvalid) firstInvalid.focus();
    return isValid;
  },

  /**
   * Attaches live error clearing to all inputs in a form.
   */
  bindLiveClear(formEl) {
    if (!formEl) return;
    formEl.querySelectorAll('input, select, textarea').forEach(input => {
      input.addEventListener('input', () => this.clearFieldError(input));
      input.addEventListener('change', () => this.clearFieldError(input));
    });
  }
};

window.validators = validators;
