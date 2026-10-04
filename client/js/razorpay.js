/**
 * @file client/js/razorpay.js
 * @description Centralized Razorpay Payment Gateway Client Integration.
 */

(function () {
  'use strict';

  const RazorpayHelper = {
    loadScript: function () {
      return new Promise(function (resolve) {
        if (window.Razorpay) return resolve(true);
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.async = true;
        script.onload = function () { resolve(true); };
        script.onerror = function () { resolve(false); };
        document.head.appendChild(script);
      });
    },

    /**
     * Trigger Razorpay Checkout Modal and verify payment
     * @param {Object} options
     * @param {number} options.amount - Amount in INR (e.g. 1500)
     * @param {string} options.name - Business/Club Title
     * @param {string} options.description - Item or Plan summary
     * @param {string} options.source - 'membership' | 'court' | 'shop' | 'bar' | 'general'
     * @param {string|number} options.reference_id - Order ID or Booking ID or Member ID
     * @param {Object} options.prefill - { name, email, phone }
     * @param {Object} options.notes - Extra metadata
     * @returns {Promise<Object>} Verification details
     */
    openCheckout: async function (options) {
      const self = this;
      const {
        amount,
        name = 'The Champions Club',
        description = 'Club Payment',
        source = 'general',
        reference_id = null,
        prefill = {},
        notes = {}
      } = options || {};

      if (!amount || Number(amount) <= 0) {
        throw new Error('Payment amount must be greater than zero.');
      }

      const scriptLoaded = await self.loadScript();
      if (!scriptLoaded) {
        throw new Error('Unable to connect to Razorpay payment gateway. Please check your network connection.');
      }

      // Step 1: Create Order on backend
      const orderData = await api.post('/api/payments/razorpay/create-order', {
        amount: Number(amount),
        notes: { source, reference_id, ...notes }
      });

      if (!orderData || !orderData.orderId) {
        throw new Error('Failed to initialize Razorpay payment transaction.');
      }

      // Auto-resolve user profile details for prefill if not provided
      let resolvedPrefill = {
        name: prefill.name || '',
        email: prefill.email || '',
        contact: prefill.contact || prefill.phone || ''
      };

      if (!resolvedPrefill.name || !resolvedPrefill.email || !resolvedPrefill.contact) {
        try {
          const authRes = await api.get('/api/auth/me');
          if (authRes && authRes.user) {
            resolvedPrefill.name = resolvedPrefill.name || authRes.user.full_name || '';
            resolvedPrefill.email = resolvedPrefill.email || authRes.user.email || '';
            resolvedPrefill.contact = resolvedPrefill.contact || authRes.user.phone || '';
          }
        } catch (e) {
          // Fallback if not logged in
        }
      }

      // Step 2: Open Razorpay Popup
      return new Promise(function (resolve, reject) {
        const isTestMode = (orderData.keyId || '').startsWith('rzp_test_');
        const rzpOptions = {
          key: orderData.keyId || 'rzp_test_RhVYKPOupv38C4',
          amount: orderData.amount,
          currency: orderData.currency || 'INR',
          name: name,
          description: description,
          order_id: orderData.orderId,
          prefill: resolvedPrefill,
          theme: {
            color: '#0F766E'
          },
          handler: async function (response) {
            try {
              // Step 3: Backend signature verification
              const verifyRes = await api.post('/api/payments/razorpay/verify', {
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                source: source,
                reference_id: reference_id,
                amount: Number(amount),
                notes: description
              });

              resolve({
                verified: true,
                order_id: response.razorpay_order_id,
                payment_id: response.razorpay_payment_id,
                signature: response.razorpay_signature,
                ...verifyRes
              });
            } catch (err) {
              reject(new Error('Server verification failed: ' + (err.message || 'Signature mismatch')));
            }
          },
          modal: {
            ondismiss: function () {
              reject(new Error('Payment was cancelled by the user.'));
            }
          }
        };

        const rzpInstance = new window.Razorpay(rzpOptions);
        rzpInstance.on('payment.failed', function (res) {
          reject(new Error(res.error ? res.error.description : 'Payment transaction failed'));
        });
        rzpInstance.open();
      });
    }
  };

  window.RazorpayHelper = RazorpayHelper;
})();
