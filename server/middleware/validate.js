/**
 * @file server/middleware/validate.js
 * @description Centralized server-side validation middleware.
 * Returns HTTP 400 with { error, code: 'VALIDATION_ERROR', fields: { field: message } }
 */

const { isValidEmail, isValidPhone, normalizePhone, sanitizeText } = require('../utils/validators');

/**
 * Creates an Express middleware that validates req.body according to a schema.
 * @param {Object} schema - Map of field names to validation rules.
 * @returns {Function} Express middleware
 */
function validate(schema) {
  return async (req, res, next) => {
    const errors = {};
    const data = req.body || {};

    for (const [field, rules] of Object.entries(schema)) {
      let val = data[field];

      // Trim strings
      if (typeof val === 'string') {
        val = val.trim();
        data[field] = val;
      }

      // Check required
      if (rules.required && (val === undefined || val === null || val === '')) {
        errors[field] = rules.message || `${rules.label || field} is required.`;
        continue;
      }

      // If empty and not required, skip further checks
      if (val === undefined || val === null || val === '') {
        continue;
      }

      // Type checks
      if (rules.type === 'email') {
        if (!isValidEmail(val)) {
          errors[field] = 'Please enter a valid email address.';
        }
      } else if (rules.type === 'phone') {
        if (!isValidPhone(val)) {
          errors[field] = 'Please enter a valid 10-digit mobile number.';
        } else {
          data[field] = normalizePhone(val);
        }
      } else if (rules.type === 'number') {
        const num = Number(val);
        if (isNaN(num)) {
          errors[field] = `${rules.label || field} must be a valid number.`;
        } else {
          if (rules.min !== undefined && num < rules.min) {
            errors[field] = `${rules.label || field} must be at least ${rules.min}.`;
          }
          if (rules.max !== undefined && num > rules.max) {
            errors[field] = `${rules.label || field} must not exceed ${rules.max}.`;
          }
        }
      } else if (rules.type === 'integer') {
        const intVal = parseInt(val, 10);
        if (isNaN(intVal) || String(intVal) !== String(val).trim()) {
          errors[field] = `${rules.label || field} must be an integer.`;
        } else {
          if (rules.min !== undefined && intVal < rules.min) {
            errors[field] = `${rules.label || field} must be at least ${rules.min}.`;
          }
          if (rules.max !== undefined && intVal > rules.max) {
            errors[field] = `${rules.label || field} must not exceed ${rules.max}.`;
          }
        }
      } else if (rules.type === 'string') {
        if (rules.minLength && val.length < rules.minLength) {
          errors[field] = `${rules.label || field} must be at least ${rules.minLength} characters.`;
        }
        if (rules.maxLength && val.length > rules.maxLength) {
          errors[field] = `${rules.label || field} cannot exceed ${rules.maxLength} characters.`;
        }
        if (rules.pattern && !rules.pattern.test(val)) {
          errors[field] = rules.message || `${rules.label || field} format is invalid.`;
        }
      } else if (rules.type === 'enum') {
        if (Array.isArray(rules.enum) && !rules.enum.includes(val)) {
          errors[field] = `${rules.label || field} must be one of: ${rules.enum.join(', ')}.`;
        }
      } else if (rules.type === 'date') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(val) || isNaN(new Date(val).getTime())) {
          errors[field] = 'Please provide a valid date in YYYY-MM-DD format.';
        }
      } else if (rules.type === 'time') {
        if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(val)) {
          errors[field] = 'Please provide a valid time in HH:MM format.';
        }
      }

      // Custom async/sync rule
      if (!errors[field] && typeof rules.custom === 'function') {
        try {
          const customErr = await rules.custom(val, req);
          if (customErr) errors[field] = customErr;
        } catch (e) {
          errors[field] = e.message;
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        error: 'Please fix the highlighted fields.',
        code: 'VALIDATION_ERROR',
        fields: errors
      });
    }

    next();
  };
}

module.exports = {
  validate
};
