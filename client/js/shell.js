/**
 * @file client/js/shell.js
 * @description Unified Layout Shell for all authenticated pages.
 * Injects floating sidebar, topbar, debounced global search, theme toggle,
 * notifications bell, and user session management.
 */

async function initShell() {
  const shellContainer = document.getElementById('app-shell');
  if (!shellContainer) return;

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
          { href: '/owner/staff.html', icon: 'bi-person-badge', label: 'Staff & Roster' }
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

  // Inject Shell HTML
  shellContainer.innerHTML = `
    <!-- Floating Sidebar -->
    <aside class="app-sidebar" id="app-sidebar">
      <div class="sidebar-brand">
        <div class="brand-icon"><i class="bi bi-trophy-fill"></i></div>
        <div>
          <h1 class="brand-title">Champions Club</h1>
          <span class="brand-role-badge">${roleName}</span>
        </div>
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
        <button class="btn btn-sm btn-outline-custom w-100 text-white border-secondary border-opacity-25" id="shell-logout-btn">
          <i class="bi bi-box-arrow-right me-1"></i> Sign Out
        </button>
      </div>
    </aside>

    <!-- Top Bar -->
    <header class="app-topbar">
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
        <!-- Debounced Global Search -->
        <div class="global-search-box d-none d-md-block">
          <i class="bi bi-search global-search-icon"></i>
          <input type="text" class="global-search-input" id="global-search-input" placeholder="Search members, bookings, items... (press /)" role="search" aria-label="Global search">
          <div id="global-search-dropdown" class="dropdown-menu shadow-lg p-2 w-100 mt-1" style="max-height: 380px; overflow-y: auto; display: none;"></div>
        </div>

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
    </header>
  `;

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

  // 2. Mobile Sidebar Toggle
  document.getElementById('sidebar-toggle-btn')?.addEventListener('click', () => {
    document.getElementById('app-sidebar')?.classList.toggle('show');
  });

  // 3. Theme Toggle
  document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const nextTheme = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nextTheme);
    localStorage.setItem('cc_theme', nextTheme);

    const icon = document.querySelector('#theme-toggle-btn i');
    if (icon) {
      icon.className = `bi ${nextTheme === 'dark' ? 'bi-sun-fill text-warning' : 'bi-moon-stars-fill'}`;
    }
  });

  // 4. Keyboard shortcut '/' to focus search
  window.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault();
      document.getElementById('global-search-input')?.focus();
    }
  });

  // 5. Global Debounced Search
  const searchInput = document.getElementById('global-search-input');
  const searchDropdown = document.getElementById('global-search-dropdown');
  let searchAbort = null;

  if (searchInput && searchDropdown) {
    searchInput.addEventListener('input', utils.debounce(async (e) => {
      const q = e.target.value.trim();
      if (q.length < 2) {
        searchDropdown.style.display = 'none';
        return;
      }

      if (searchAbort) searchAbort.abort();
      searchAbort = new AbortController();

      try {
        const res = await api.get('/api/search', { q }, { signal: searchAbort.signal });
        let html = '';

        if (res.members && res.members.length) {
          html += '<h6 class="dropdown-header text-uppercase small fw-bold">Members</h6>';
          res.members.forEach(m => {
            html += `<a class="dropdown-item py-2" href="/owner/members.html"><i class="bi bi-person me-2 text-accent"></i>${utils.escapeHtml(m.full_name)} <code class="small">${utils.escapeHtml(m.member_code)}</code></a>`;
          });
        }
        if (res.bookings && res.bookings.length) {
          html += '<h6 class="dropdown-header text-uppercase small fw-bold">Bookings</h6>';
          res.bookings.forEach(b => {
            html += `<a class="dropdown-item py-2" href="/owner/bookings.html"><i class="bi bi-calendar-check me-2 text-primary"></i>${utils.escapeHtml(b.booking_code)} · ${utils.escapeHtml(b.court_name)} (${b.booking_date})</a>`;
          });
        }
        if (res.products && res.products.length) {
          html += '<h6 class="dropdown-header text-uppercase small fw-bold">Products</h6>';
          res.products.forEach(p => {
            html += `<a class="dropdown-item py-2" href="/owner/products.html"><i class="bi bi-box-seam me-2 text-success"></i>${utils.escapeHtml(p.name)} · ₹${p.price}</a>`;
          });
        }

        if (!html) {
          html = '<div class="p-3 text-muted text-center small">No matches found for "' + utils.escapeHtml(q) + '"</div>';
        }

        searchDropdown.innerHTML = html;
        searchDropdown.style.display = 'block';
      } catch (err) {
        if (err.name !== 'AbortError') console.warn(err);
      }
    }, 300));

    document.addEventListener('click', (e) => {
      if (!searchInput.contains(e.target) && !searchDropdown.contains(e.target)) {
        searchDropdown.style.display = 'none';
      }
    });
  }

  // 6. Fetch Unread Notifications Count
  try {
    const notifRes = await api.get('/api/notifications');
    const badge = document.getElementById('notif-badge');
    if (badge && notifRes.unreadCount > 0) {
      badge.textContent = notifRes.unreadCount;
      badge.classList.remove('d-none');
    }
  } catch (e) {}
}

document.addEventListener('DOMContentLoaded', initShell);
