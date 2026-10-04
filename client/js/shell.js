/**
 * @file client/js/shell.js
 * @description Unified Layout Shell for all authenticated pages.
 * Injects floating sidebar, topbar, debounced global search, theme toggle,
 * notifications bell, and user session management.
 */

async function initShell() {
  const shellContainer = document.getElementById('app-shell');
  if (!shellContainer) return;

  if (!window._shellPageStyleTrackingStarted) {
    document.head.querySelectorAll('style').forEach(style => style.setAttribute('data-spa-page-style', 'true'));
    window._shellPageStyleTrackingStarted = true;
  }

  // 1. Fetch current session user
  let user = null;
  try {
    const res = await api.get('/api/auth/me');
    user = res.user;
    window.currentUser = user;
  } catch (e) {
    window.location.href = '/shared/login.html';
    return;
  }

  // 2. Determine active page and role links
  const path = window.location.pathname;

  // Initialize theme from localStorage
  const savedTheme = localStorage.getItem('cc_theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);

  // Generate role-specific navigation items
  let navSections = [];

  if (user.role === 'owner') {
    navSections = [
      {
        caption: 'Overview',
        items: [
          { href: '/owner/dashboard.html', icon: 'bi-grid-1x2', label: 'Dashboard' },
          { href: '/owner/leads.html', icon: 'bi-megaphone', label: 'CRM Leads' }
        ]
      },
      {
        caption: 'Operations',
        items: [
          { href: '/owner/members.html', icon: 'bi-people', label: 'Members' },
          { href: '/owner/bookings.html', icon: 'bi-calendar-check', label: 'Bookings' },
          { href: '/owner/courts.html', icon: 'bi-geo-alt', label: 'Courts & Blocks' },
          { href: '/owner/orders.html', icon: 'bi-receipt', label: 'Orders & POS' },
          { href: '/owner/products.html', icon: 'bi-box-seam', label: 'Products & Stock' }
        ]
      },
      {
        caption: 'Finance & Admin',
        items: [
          { href: '/owner/payments.html', icon: 'bi-credit-card', label: 'Payments Ledger' },
          { href: '/owner/plans.html', icon: 'bi-award', label: 'Membership Plans' },
          { href: '/owner/staff.html', icon: 'bi-person-badge', label: 'Staff & Payroll' }
        ]
      }
    ];
  } else if (user.role === 'staff') {
    const area = user.assigned_area || 'general';
    const opItems = [];

    if (area === 'booking' || area === 'general') {
      opItems.push({ href: '/staff/dashboard.html', icon: 'bi-calendar-check', label: 'Court Booking Desk' });
    }
    if (area === 'shop' || area === 'general') {
      opItems.push({ href: '/staff/shop-dashboard.html', icon: 'bi-bag', label: 'Shop POS & Stock' });
    }
    if (area === 'bar' || area === 'general') {
      opItems.push({ href: '/staff/cafeteria.html', icon: 'bi-cup-hot', label: 'Bar & Cafeteria POS' });
      opItems.push({ href: '/staff/bar-dashboard.html', icon: 'bi-grid-3x3-gap', label: 'Kitchen & Tabs' });
    }

    navSections = [
      {
        caption: 'Staff Operations',
        items: opItems
      }
    ];
  } else if (user.role === 'member') {
    navSections = [
      {
        caption: 'My Club',
        items: [
          { href: '/member/dashboard.html', icon: 'bi-grid-1x2', label: 'Overview' },
          { href: '/member/membership.html', icon: 'bi-award', label: 'My Membership' }
        ]
      },
      {
        caption: 'Sports & Booking',
        items: [
          { href: '/member/book.html', icon: 'bi-calendar-plus', label: 'Book a Court' },
          { href: '/member/bookings.html', icon: 'bi-calendar-check', label: 'My Bookings' }
        ]
      },
      {
        caption: 'Store & Cafe',
        items: [
          { href: '/member/shop.html', icon: 'bi-bag', label: 'Pro Shop' },
          { href: '/member/cafeteria.html', icon: 'bi-cup-hot', label: 'Bar & Cafe' }
        ]
      }
    ];
  }

  // Build Navigation HTML
  let navHtml = '';
  navSections.forEach(sec => {
    navHtml += `<div class="nav-caption">${sec.caption}</div>`;
    sec.items.forEach(it => {
      const isActive = path === it.href || (it.href !== '/owner/dashboard.html' && path.includes(it.href.replace('.html', '')));
      navHtml += `
        <a href="${it.href}" class="sidebar-link ${isActive ? 'active' : ''}">
          <i class="bi ${it.icon}"></i>
          <span>${it.label}</span>
        </a>
      `;
    });
  });

  // Extract Page Title
  const pageTitle = document.title.split('–')[0].split('-')[0].trim() || 'Dashboard';
  const roleName = user.role === 'owner' ? 'Club Owner' : (user.role === 'staff' ? `Staff (${user.assigned_area || 'General'})` : 'Club Member');

  // 1. Inject Floating Sidebar into #app-shell
  shellContainer.innerHTML = `
    <aside class="app-sidebar" id="app-sidebar">
      <div class="sidebar-brand">
        <div class="brand-icon"><i class="bi bi-trophy-fill"></i></div>
        <div>
          <h1 class="brand-title">Champions Club</h1>
          <span class="brand-role-badge">${roleName}</span>
        </div>
        <button class="sidebar-close-btn d-lg-none" id="sidebar-close-btn" type="button" aria-label="Close Navigation">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>

      <nav class="sidebar-nav">
        ${navHtml}
      </nav>

      <div class="sidebar-footer">
        <div class="sidebar-user-card">
          <div class="user-avatar">${utils.initials(user.full_name)}</div>
          <div class="user-info">
            <div class="user-name">${utils.escapeHtml(user.full_name)}</div>
            <div class="user-role">${utils.escapeHtml(user.email)}</div>
          </div>
        </div>
        <button class="btn btn-sm btn-outline-light-custom w-100" id="shell-logout-btn">
          <i class="bi bi-box-arrow-right me-1"></i> Sign Out
        </button>
      </div>
    </aside>
  `;

  // 2. Inject Top Bar into main content container if not already existing
  const mainContent = document.querySelector('.app-main') || document.querySelector('.content-container') || document.querySelector('main');
  let existingTopbar = document.querySelector('.app-topbar');

  if (mainContent && !existingTopbar) {
    const topbarHeader = document.createElement('header');
    topbarHeader.className = 'app-topbar';
    topbarHeader.innerHTML = `
      <div class="d-flex align-items-center gap-3">
        <button class="icon-btn d-lg-none" id="sidebar-toggle-btn" aria-label="Toggle Navigation">
          <i class="bi bi-list fs-5"></i>
        </button>
        <div class="breadcrumb-block">
          <div class="breadcrumb-crumbs">
            <a href="${navSections[0]?.items[0]?.href || '#'}">Champions Club</a>
            <span>/</span>
            <span>${pageTitle}</span>
          </div>
          <h2 class="page-title">${pageTitle}</h2>
        </div>
      </div>

      <div class="topbar-actions">
        <!-- Theme Toggle -->
        <button class="icon-btn" id="theme-toggle-btn" title="Toggle Light/Dark Theme" aria-label="Toggle Theme">
          <i class="bi ${savedTheme === 'dark' ? 'bi-sun-fill text-warning' : 'bi-moon-stars-fill'}"></i>
        </button>

        <!-- Notifications Bell -->
        <button class="icon-btn" id="notif-btn" title="Notifications" aria-label="View Notifications">
          <i class="bi bi-bell"></i>
          <span class="notification-badge d-none" id="notif-badge">0</span>
        </button>
      </div>
    `;
    mainContent.insertBefore(topbarHeader, mainContent.firstChild);
    window._shellDefaultTopbarTemplate = topbarHeader.cloneNode(true);
  }

  ensureMobileSidebarToggle(document.querySelector('.app-topbar'));
  attachShellControlHandlers();

  // Attach Event Handlers
  // 1. Logout
  document.getElementById('shell-logout-btn')?.addEventListener('click', async () => {
    const confirmed = await ui.confirmDialog({
      title: 'Sign Out',
      message: 'Are you sure you want to end your current session?',
      confirmText: 'Sign Out',
      danger: false
    });
    if (confirmed) {
      await api.post('/api/auth/logout');
      window.location.href = '/shared/login.html';
    }
  });

  // 6. Fetch Unread Notifications Count
  try {
    const notifRes = await api.get('/api/notifications');
    const badge = document.getElementById('notif-badge');
    if (badge && notifRes.unreadCount > 0) {
      badge.textContent = notifRes.unreadCount;
      badge.classList.remove('d-none');
    }
  } catch (e) {}

  if (user.must_change_password) {
    await enforcePasswordChange(user);
  }

  // 7. Attach SPA Smooth Router
  attachSPARouter();
}

async function enforcePasswordChange(user) {
  if (window._passwordChangePromptOpen) return;
  window._passwordChangePromptOpen = true;

  const modalElement = document.createElement('div');
  modalElement.className = 'modal fade';
  modalElement.id = 'required-password-change-modal';
  modalElement.tabIndex = -1;
  modalElement.setAttribute('aria-labelledby', 'requiredPasswordTitle');
  modalElement.setAttribute('aria-hidden', 'true');
  modalElement.innerHTML = `
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header">
          <h2 class="modal-title fs-5 fw-bold" id="requiredPasswordTitle">Set a new password</h2>
        </div>
        <form id="requiredPasswordForm">
          <div class="modal-body">
            <p class="small text-muted">Your membership is approved. Choose a new password before continuing.</p>
            <div class="mb-3">
              <label class="form-label" for="requiredCurrentPassword">Temporary password</label>
              <input class="form-control" id="requiredCurrentPassword" name="current_password" type="password" autocomplete="current-password" required>
            </div>
            <div class="mb-3">
              <label class="form-label" for="requiredNewPassword">New password</label>
              <input class="form-control" id="requiredNewPassword" name="new_password" type="password" autocomplete="new-password" minlength="8" pattern="(?=.*[A-Za-z])(?=.*\\d).{8,}" required>
              <small class="text-muted">At least 8 characters, with a letter and a number.</small>
            </div>
            <div class="mb-3">
              <label class="form-label" for="requiredConfirmPassword">Confirm new password</label>
              <input class="form-control" id="requiredConfirmPassword" type="password" autocomplete="new-password" required>
            </div>
            <div class="alert alert-danger py-2 small d-none mb-0" id="requiredPasswordError" role="alert"></div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-accent" type="submit" id="requiredPasswordSubmit">Save new password</button>
          </div>
        </form>
      </div>
    </div>`;

  document.body.appendChild(modalElement);
  const modal = new bootstrap.Modal(modalElement, { backdrop: 'static', keyboard: false });
  const form = modalElement.querySelector('#requiredPasswordForm');
  const errorBox = modalElement.querySelector('#requiredPasswordError');
  const submitButton = modalElement.querySelector('#requiredPasswordSubmit');

  await new Promise(resolve => {
    modalElement.addEventListener('shown.bs.modal', () => modalElement.querySelector('#requiredCurrentPassword').focus(), { once: true });
    modalElement.addEventListener('hidden.bs.modal', () => {
      modal.dispose();
      modalElement.remove();
      window._passwordChangePromptOpen = false;
      resolve();
    }, { once: true });

    form.addEventListener('submit', async event => {
      event.preventDefault();
      errorBox.classList.add('d-none');
      if (form.new_password.value !== modalElement.querySelector('#requiredConfirmPassword').value) {
        errorBox.textContent = 'The new passwords do not match.';
        errorBox.classList.remove('d-none');
        return;
      }

      submitButton.disabled = true;
      try {
        await api.post('/api/auth/change-password', {
          current_password: form.current_password.value,
          new_password: form.new_password.value
        });
        user.must_change_password = false;
        window.currentUser = user;
        modal.hide();
        ui.toast('Password updated. Welcome to the club.', 'success');
      } catch (err) {
        errorBox.textContent = err.message || 'Could not update password.';
        errorBox.classList.remove('d-none');
        submitButton.disabled = false;
      }
    });

    modal.show();
  });
}

function ensureMobileSidebarToggle(topbar) {
  if (!topbar || topbar.querySelector('#sidebar-toggle-btn')) return;
  const button = document.createElement('button');
  button.className = 'icon-btn d-lg-none';
  button.id = 'sidebar-toggle-btn';
  button.type = 'button';
  button.setAttribute('aria-label', 'Toggle Navigation');
  button.innerHTML = '<i class="bi bi-list fs-5"></i>';
  const titleGroup = topbar.querySelector('.breadcrumb-block')?.parentElement || topbar.firstElementChild;
  if (titleGroup) titleGroup.insertBefore(button, titleGroup.firstChild);
  else topbar.insertBefore(button, topbar.firstChild);
}

function attachShellControlHandlers() {
  if (window._shellControlsAttached) return;
  window._shellControlsAttached = true;
  document.addEventListener('click', event => {
    if (event.target.closest('#sidebar-toggle-btn')) {
      document.getElementById('app-sidebar')?.classList.toggle('show');
    }
    if (event.target.closest('#sidebar-close-btn')) {
      document.getElementById('app-sidebar')?.classList.remove('show');
    }
    if (event.target.closest('#theme-toggle-btn')) {
      const current = document.documentElement.getAttribute('data-theme') || 'light';
      const nextTheme = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', nextTheme);
      localStorage.setItem('cc_theme', nextTheme);
      const icon = document.querySelector('#theme-toggle-btn i');
      if (icon) icon.className = `bi ${nextTheme === 'dark' ? 'bi-sun-fill text-warning' : 'bi-moon-stars-fill'}`;
    }
  });
}

async function navigateShellPage(targetPath, addHistory = true) {
  const mainContent = document.querySelector('.app-main') || document.querySelector('.content-container') || document.querySelector('main');
  if (!mainContent) {
    window.location.href = targetPath;
    return;
  }

  mainContent.style.opacity = '0.45';
  try {
    const res = await fetch(targetPath, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    if (!res.ok) throw new Error(`Page request failed: ${res.status}`);
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const newMain = doc.querySelector('.app-main') || doc.querySelector('.content-container') || doc.querySelector('main');
    if (!newMain) throw new Error('Page content was not found');

    if (typeof window._shellPageCleanup === 'function') {
      window._shellPageCleanup();
      window._shellPageCleanup = null;
    }

    syncShellPageStyles(doc, targetPath);
    document.title = doc.title;
    if (addHistory) history.pushState({}, '', targetPath);

    const incomingTopbar = newMain.querySelector('.app-topbar')?.cloneNode(true);
    mainContent.innerHTML = newMain.innerHTML;
    mainContent.className = newMain.className;
    if (!mainContent.querySelector('.app-topbar')) {
      const fallbackTopbar = window._shellDefaultTopbarTemplate?.cloneNode(true) || createFallbackTopbar();
      mainContent.insertBefore(fallbackTopbar, mainContent.firstChild);
    }
    ensureMobileSidebarToggle(mainContent.querySelector('.app-topbar'));

    document.querySelectorAll('[data-spa-modal="true"]').forEach(modal => modal.remove());
    doc.querySelectorAll('.modal').forEach(modal => {
      if (newMain.contains(modal)) return;
      const modalClone = modal.cloneNode(true);
      modalClone.setAttribute('data-spa-modal', 'true');
      document.body.appendChild(modalClone);
    });

    const pageTitle = doc.title.split(/[–-]/)[0].trim();
    const titleElement = mainContent.querySelector('.page-title');
    const crumbElement = mainContent.querySelector('.breadcrumb-crumbs span:last-child');
    if (titleElement) titleElement.textContent = pageTitle;
    if (crumbElement) crumbElement.textContent = pageTitle;

    document.querySelectorAll('.sidebar-link').forEach(link => {
      link.classList.toggle('active', new URL(link.href, window.location.origin).pathname === targetPath);
    });

    for (const source of doc.querySelectorAll('script')) {
      if (source.src) {
        const src = source.src;
        if (Array.from(document.scripts).some(script => script.src === src)) continue;
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = src;
          script.onload = resolve;
          script.onerror = reject;
          document.body.appendChild(script);
        });
        continue;
      }

      const code = source.textContent.trim();
      if (!code) continue;

      const functionNames = [...code.matchAll(/\bfunction\s+([\w$]+)\s*\(/g)].map(match => match[1]);
      const exports = [...new Set(functionNames)].map(name =>
        `if (typeof ${name} === 'function') window[${JSON.stringify(name)}] = ${name};`
      ).join('\n');
      const originalAddEventListener = document.addEventListener;
      document.addEventListener = function (type, listener, options) {
        if (type === 'DOMContentLoaded') {
          Promise.resolve().then(() => listener.call(document, new Event(type)));
          return;
        }
        return originalAddEventListener.call(document, type, listener, options);
      };
      try {
        new Function(`${code}\n${exports}`)();
      } finally {
        document.addEventListener = originalAddEventListener;
      }
    }

    mainContent.style.opacity = '1';
    document.getElementById('app-sidebar')?.classList.remove('show');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    window.location.href = targetPath;
  }
}

function syncShellPageStyles(pageDocument, targetPath) {
  document.head.querySelectorAll('[data-spa-page-style="true"]').forEach(node => node.remove());
  const targetUrl = new URL(targetPath, window.location.origin);

  pageDocument.head.querySelectorAll('style, link[rel~="stylesheet"]').forEach(source => {
    const clone = source.cloneNode(true);
    if (source.tagName === 'LINK') {
      const href = new URL(source.getAttribute('href'), targetUrl).href;
      const existing = Array.from(document.head.querySelectorAll('link[rel~="stylesheet"]'))
        .some(link => link.href === href);
      if (existing) return;
      clone.href = href;
    }
    clone.setAttribute('data-spa-page-style', 'true');
    document.head.appendChild(clone);
  });
}

function createFallbackTopbar() {
  const topbar = document.createElement('header');
  topbar.className = 'app-topbar';
  topbar.innerHTML = `
    <div class="d-flex align-items-center gap-3">
      <div class="breadcrumb-block">
        <div class="breadcrumb-crumbs"><a href="#">Champions Club</a><span>/</span><span></span></div>
        <h2 class="page-title"></h2>
      </div>
    </div>
    <div class="topbar-actions">
      <button class="icon-btn" id="theme-toggle-btn" title="Toggle Light/Dark Theme" aria-label="Toggle Theme"><i class="bi bi-moon-stars-fill"></i></button>
    </div>`;
  return topbar;
}

function attachSPARouter() {
  if (window._spaRouterAttached) return;
  window._spaRouterAttached = true;

  document.addEventListener('click', event => {
    const link = event.target.closest('a.sidebar-link');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const targetPath = new URL(link.href, window.location.origin).pathname;
    if (targetPath === window.location.pathname) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    navigateShellPage(targetPath);
  });

  window.addEventListener('popstate', () => navigateShellPage(window.location.pathname, false));
}

document.addEventListener('DOMContentLoaded', initShell);
