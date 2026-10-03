/**
 * @file client/js/ui.js
 * @description Bootstrap 5.3 UI Component Wrappers.
 * Replaces all native alert()/confirm() with styled accessible modals,
 * toasts, skeleton loaders, and pagination.
 */

const ui = {
  /**
   * Displays a stacked toast message in the top-right corner.
   * @param {string} message
   * @param {'success'|'error'|'warning'|'info'} [type='success']
   * @param {number} [duration=4000]
   */
  toast(message, type = 'success', duration = 4000) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container position-fixed top-0 end-0 p-3';
      container.style.zIndex = '1090';
      document.body.appendChild(container);
    }

    const toastEl = document.createElement('div');
    toastEl.className = 'toast align-items-center border-0 shadow-lg';
    toastEl.setAttribute('role', 'alert');
    toastEl.setAttribute('aria-live', 'assertive');
    toastEl.setAttribute('aria-atomic', 'true');

    let bgClass = 'bg-dark text-white';
    let iconClass = 'bi-check-circle-fill text-success';
    if (type === 'error') {
      bgClass = 'bg-danger text-white';
      iconClass = 'bi-x-circle-fill text-white';
    } else if (type === 'warning') {
      bgClass = 'bg-warning text-dark';
      iconClass = 'bi-exclamation-triangle-fill text-dark';
    } else if (type === 'info') {
      bgClass = 'bg-info text-white';
      iconClass = 'bi-info-circle-fill text-white';
    }

    toastEl.innerHTML = `
      <div class="d-flex ${bgClass} rounded-3 p-2">
        <div class="toast-body d-flex align-items-center gap-2">
          <i class="bi ${iconClass} fs-5"></i>
          <span>${utils.escapeHtml(message)}</span>
        </div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
      </div>
    `;

    container.appendChild(toastEl);
    const bsToast = new bootstrap.Toast(toastEl, { delay: duration });
    bsToast.show();

    toastEl.addEventListener('hidden.bs.toast', () => {
      toastEl.remove();
    });
  },

  /**
   * Shows an asynchronous confirmation dialog.
   * Returns a Promise resolving to true (confirmed) or false (cancelled).
   */
  confirmDialog({
    title = 'Confirm Action',
    message = 'Are you sure you want to proceed?',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    danger = false
  } = {}) {
    return new Promise((resolve) => {
      let modalEl = document.getElementById('global-confirm-modal');
      if (modalEl) modalEl.remove();

      modalEl = document.createElement('div');
      modalEl.id = 'global-confirm-modal';
      modalEl.className = 'modal fade';
      modalEl.setAttribute('tabindex', '-1');
      modalEl.innerHTML = `
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title d-flex align-items-center gap-2">
                <i class="bi ${danger ? 'bi-exclamation-triangle-fill text-danger' : 'bi-question-circle-fill text-accent'}"></i>
                ${utils.escapeHtml(title)}
              </h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body py-3">
              <p class="mb-0 text-muted">${utils.escapeHtml(message)}</p>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-outline-custom" id="confirm-cancel-btn" data-bs-dismiss="modal">${utils.escapeHtml(cancelText)}</button>
              <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-accent'}" id="confirm-proceed-btn">${utils.escapeHtml(confirmText)}</button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(modalEl);
      const bsModal = new bootstrap.Modal(modalEl);

      let confirmed = false;
      document.getElementById('confirm-proceed-btn').addEventListener('click', () => {
        confirmed = true;
        bsModal.hide();
      });

      modalEl.addEventListener('hidden.bs.modal', () => {
        modalEl.remove();
        resolve(confirmed);
      });

      bsModal.show();
    });
  },

  /**
   * Helper to open Bootstrap modal.
   */
  openModal(modalId) {
    const el = typeof modalId === 'string' ? document.getElementById(modalId) : modalId;
    if (!el) return null;
    const modal = bootstrap.Modal.getOrCreateInstance(el);
    modal.show();
    return modal;
  },

  /**
   * Helper to close Bootstrap modal.
   */
  closeModal(modalId) {
    const el = typeof modalId === 'string' ? document.getElementById(modalId) : modalId;
    if (!el) return;
    const modal = bootstrap.Modal.getInstance(el);
    if (modal) modal.hide();
  },

  /**
   * Renders skeleton rows for table loading states.
   */
  skeleton(rows = 5, cols = 6) {
    let html = '';
    for (let r = 0; r < rows; r++) {
      html += '<tr>';
      for (let c = 0; c < cols; c++) {
        html += `<td><div class="placeholder-glow"><span class="placeholder col-${(c % 3) + 7} bg-secondary opacity-25 rounded"></span></div></td>`;
      }
      html += '</tr>';
    }
    return html;
  },

  /**
   * Renders empty state block with icon, message, and call-to-action.
   */
  emptyState({
    icon = 'bi-inbox',
    headline = 'No records found',
    message = 'Try refining your search or filter criteria.',
    actionText = null,
    actionId = null
  } = {}) {
    return `
      <div class="text-center py-5">
        <div class="d-inline-flex align-items-center justify-content-center bg-light rounded-circle text-muted mb-3" style="width: 64px; height: 64px; font-size: 2rem;">
          <i class="bi ${icon}"></i>
        </div>
        <h6 class="fw-bold mb-1">${utils.escapeHtml(headline)}</h6>
        <p class="text-muted small mb-3" style="max-width: 320px; margin: 0 auto;">${utils.escapeHtml(message)}</p>
        ${actionText ? `<button class="btn btn-sm btn-accent" id="${actionId || 'empty-action-btn'}">${utils.escapeHtml(actionText)}</button>` : ''}
      </div>
    `;
  },

  /**
   * Renders numbered pagination bar.
   */
  renderPagination({ page, totalPages, total, limit, onPageChange }) {
    if (totalPages <= 1) {
      return `<span class="text-muted small">Showing all ${total} record(s)</span>`;
    }

    const startRecord = (page - 1) * limit + 1;
    const endRecord = Math.min(page * limit, total);

    let pagesHtml = '';
    for (let p = 1; p <= totalPages; p++) {
      if (p === 1 || p === totalPages || (p >= page - 1 && p <= page + 1)) {
        pagesHtml += `
          <button class="btn btn-sm ${p === page ? 'btn-accent' : 'btn-outline-custom'}" onclick="${onPageChange}(${p})">
            ${p}
          </button>
        `;
      } else if (p === page - 2 || p === page + 2) {
        pagesHtml += '<span class="px-1 text-muted">…</span>';
      }
    }

    return `
      <div class="text-muted small">Showing ${startRecord}–${endRecord} of ${total} entries</div>
      <div class="d-flex align-items-center gap-1">
        <button class="btn btn-sm btn-outline-custom" ${page <= 1 ? 'disabled' : ''} onclick="${onPageChange}(${page - 1})" title="Previous Page">
          <i class="bi bi-chevron-left"></i>
        </button>
        ${pagesHtml}
        <button class="btn btn-sm btn-outline-custom" ${page >= totalPages ? 'disabled' : ''} onclick="${onPageChange}(${page + 1})" title="Next Page">
          <i class="bi bi-chevron-right"></i>
        </button>
      </div>
    `;
  }
};

window.ui = ui;
window.showAlert = (msg, type = 'success') => ui.toast(msg, type);
