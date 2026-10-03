/**
 * @file client/landing/landing.js
 * @description Client-side enhancements for the Champions Club Public Landing Page.
 * Handles public lead submission, dynamic plan data verification, and smooth navigation.
 */

document.addEventListener('DOMContentLoaded', () => {
  // ── Smooth scrolling for in-page anchors ─────────────────────────────────────
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const targetId = this.getAttribute('href');
      if (targetId === '#' || !targetId) return;
      const targetEl = document.querySelector(targetId);
      if (targetEl) {
        e.preventDefault();
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

        // Close mobile navbar if open
        const navCollapse = document.getElementById('landingNavCollapse');
        if (navCollapse && navCollapse.classList.contains('show')) {
          const bsCollapse = bootstrap.Collapse.getInstance(navCollapse);
          if (bsCollapse) bsCollapse.hide();
        }
      }
    });
  });

  // ── Pre-fill contact plan dropdown dynamically from /api/plans ───────────────
  const planSelect = document.getElementById('contactPlanSelect');
  if (planSelect) {
    fetch('/api/plans')
      .then(res => res.json())
      .then(plans => {
        if (Array.isArray(plans) && plans.length > 0) {
          planSelect.innerHTML = '<option value="">-- Select a Plan (Optional) --</option>';
          plans.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = `${p.name} (₹${Number(p.annual_fee).toLocaleString('en-IN')}/yr)`;
            planSelect.appendChild(opt);
          });
        }
      })
      .catch(() => {
        // Fallback already statically rendered in HTML
      });
  }

  // ── Public Lead / Membership Inquiry Form ────────────────────────────────────
  const contactForm = document.getElementById('landingContactForm');
  if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const btn = document.getElementById('contactSubmitBtn');
      const spinner = document.getElementById('contactSpinner');
      const successAlert = document.getElementById('contactSuccess');
      const errAlert = document.getElementById('contactError');

      const name = document.getElementById('contactName').value.trim();
      const email = document.getElementById('contactEmail').value.trim();
      const phone = document.getElementById('contactPhone').value.trim();
      const interestedPlanId = document.getElementById('contactPlanSelect').value || null;
      const message = document.getElementById('contactMessage').value.trim();

      if (!name) {
        errAlert.textContent = 'Please provide your full name.';
        errAlert.classList.remove('d-none');
        return;
      }

      btn.disabled = true;
      spinner.classList.remove('d-none');
      errAlert.classList.add('d-none');
      successAlert.classList.add('d-none');

      try {
        const response = await fetch('/api/leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            email: email || null,
            phone: phone || null,
            interested_plan_id: interestedPlanId,
            message: message || null
          })
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Failed to submit inquiry. Please try again.');
        }

        successAlert.classList.remove('d-none');
        contactForm.reset();
      } catch (err) {
        errAlert.textContent = err.message || 'An error occurred. Please try again.';
        errAlert.classList.remove('d-none');
      } finally {
        btn.disabled = false;
        spinner.classList.add('d-none');
      }
    });
  }
});
