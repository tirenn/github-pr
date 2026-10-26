import { checkAuthStatus, parsePRsWithDOM } from '../lib/parser.js';
import { syncGitHubSessionRule } from '../lib/session.js';

const REVIEW_URL = 'https://github.com/pulls/reviews';

// DOM Elements
const badgeCountEl = document.getElementById('badge-count');
const btnToggleFolder = document.getElementById('btn-toggle-folder');
const btnToggleNotif = document.getElementById('btn-toggle-notif');
const iconNotifOn = document.getElementById('icon-notif-on');
const iconNotifOff = document.getElementById('icon-notif-off');
const btnRefresh = document.getElementById('btn-refresh');
const refreshIcon = btnRefresh.querySelector('.icon-refresh');

const stateLoading = document.getElementById('state-loading');
const stateLoggedOut = document.getElementById('state-logged-out');
const loggedOutMsg = document.getElementById('logged-out-msg');
const stateEmpty = document.getElementById('state-empty');
const statePrs = document.getElementById('state-prs');
const prListEl = document.getElementById('pr-list');

const statusUserEl = document.getElementById('status-user');
const statusUpdatedEl = document.getElementById('status-updated');

let isRefreshing = false;

/**
 * Format relative time for footer
 */
function formatTimeAgo(timestamp) {
  if (!timestamp) return 'Just now';
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

/**
 * Update UI state
 */
function showState(state) {
  stateLoading.classList.add('hidden');
  stateLoggedOut.classList.add('hidden');
  stateEmpty.classList.add('hidden');
  statePrs.classList.add('hidden');

  if (state === 'loading') stateLoading.classList.remove('hidden');
  if (state === 'logged-out') stateLoggedOut.classList.remove('hidden');
  if (state === 'empty') stateEmpty.classList.remove('hidden');
  if (state === 'prs') statePrs.classList.remove('hidden');
}

/**
 * Update notification toggle button appearance
 */
function updateNotificationUI(enabled) {
  if (enabled) {
    btnToggleNotif.classList.add('active');
    btnToggleNotif.title = 'Notifications: Enabled (click to mute)';
    iconNotifOn.classList.remove('hidden');
    iconNotifOff.classList.add('hidden');
  } else {
    btnToggleNotif.classList.remove('active');
    btnToggleNotif.title = 'Notifications: Muted (click to enable)';
    iconNotifOn.classList.add('hidden');
    iconNotifOff.classList.remove('hidden');
  }
}

/**
 * Update Live Folder toggle button appearance
 */
function updateFolderUI(enabled) {
  if (!btnToggleFolder) return;
  if (enabled) {
    btnToggleFolder.classList.add('active');
    btnToggleFolder.title = 'Arc Live Folder: Enabled (click to hide from tab bar)';
  } else {
    btnToggleFolder.classList.remove('active');
    btnToggleFolder.title = 'Arc Live Folder: Disabled (click to add to tab bar)';
  }
}

/**
 * Render the PR cards
 */
function renderPRs(prs) {
  prListEl.innerHTML = '';

  prs.forEach((pr) => {
    const li = document.createElement('li');
    li.className = 'pr-item';
    li.tabIndex = 0;

    // Header row with repo and tags
    const topRow = document.createElement('div');
    topRow.className = 'pr-item-top';

    const repoSpan = document.createElement('span');
    repoSpan.className = 'pr-repo';
    repoSpan.textContent = pr.repo;
    topRow.appendChild(repoSpan);

    if (pr.isTeam || pr.isDraft) {
      const tagSpan = document.createElement('span');
      tagSpan.className = `pr-tag ${pr.isTeam ? 'pr-tag-team' : 'pr-tag-draft'}`;
      tagSpan.textContent = pr.isTeam ? 'Team review' : 'Draft';
      topRow.appendChild(tagSpan);
    }
    li.appendChild(topRow);

    // Title
    const titleEl = document.createElement('div');
    titleEl.className = 'pr-title';
    titleEl.textContent = pr.title;
    li.appendChild(titleEl);

    // Metadata row
    const metaRow = document.createElement('div');
    metaRow.className = 'pr-meta';

    // Author
    const authorWrap = document.createElement('div');
    authorWrap.className = 'pr-author-wrap';

    if (pr.avatarUrl) {
      const avatar = document.createElement('img');
      avatar.className = 'pr-avatar';
      avatar.src = pr.avatarUrl;
      avatar.alt = pr.author;
      avatar.loading = 'lazy';
      authorWrap.appendChild(avatar);
    }

    const authorSpan = document.createElement('span');
    authorSpan.textContent = `@${pr.author}`;
    authorWrap.appendChild(authorSpan);
    metaRow.appendChild(authorWrap);

    // Separator
    const sep1 = document.createElement('span');
    sep1.className = 'pr-dot-sep';
    sep1.textContent = '•';
    metaRow.appendChild(sep1);

    // PR Number
    const numberSpan = document.createElement('span');
    numberSpan.className = 'pr-number';
    numberSpan.textContent = pr.number;
    metaRow.appendChild(numberSpan);

    // Time Ago
    if (pr.timeAgo) {
      const sep2 = document.createElement('span');
      sep2.className = 'pr-dot-sep';
      sep2.textContent = '•';
      metaRow.appendChild(sep2);

      const timeSpan = document.createElement('span');
      timeSpan.textContent = pr.timeAgo;
      metaRow.appendChild(timeSpan);
    }

    li.appendChild(metaRow);

    // Click handler to open PR in new tab
    const openPR = () => {
      chrome.tabs.create({ url: pr.url });
    };

    li.addEventListener('click', openPR);
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openPR();
      }
    });

    prListEl.appendChild(li);
  });
}

/**
 * Query open GitHub tabs to fetch review requests directly via same-origin session
 */
async function tryFetchViaGitHubTab() {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://github.com/*' });
    if (!tabs || tabs.length === 0) return null;

    for (const tab of tabs) {
      try {
        const res = await chrome.tabs.sendMessage(tab.id, { action: 'fetch_prs_from_page' });
        if (res && res.success) {
          return res;
        }
      } catch (e) {
        // Tab might be in background or not ready
      }
    }
  } catch (err) {
    console.warn('Error querying GitHub tabs:', err);
  }
  return null;
}

/**
 * Apply PR results to UI and storage
 */
async function applyPRs(prs, count, username) {
  if (count > 0) {
    badgeCountEl.textContent = count;
    badgeCountEl.classList.remove('hidden');
  } else {
    badgeCountEl.classList.add('hidden');
  }

  if (prs.length === 0) {
    showState('empty');
  } else {
    renderPRs(prs);
    showState('prs');
  }

  if (username) {
    statusUserEl.textContent = `@${username}`;
  } else {
    statusUserEl.textContent = 'GitHub Connected';
  }
  statusUpdatedEl.textContent = 'Updated just now';

  const now = Date.now();
  await chrome.storage.local.set({
    loggedIn: true,
    username: username || '',
    pr_count: count,
    cached_prs: prs,
    seen_pr_ids: prs.map((p) => p.id),
    last_checked: now
  });

  chrome.runtime.sendMessage({ action: 'updateBadge', count, loggedIn: true });
}

/**
 * Fetch latest review requests and update UI
 */
async function loadReviewRequests(showSpinner = false) {
  if (isRefreshing) return;
  isRefreshing = true;

  if (showSpinner) {
    refreshIcon.classList.add('spinning');
  }

  try {
    // Strategy 1: Fetch via an active GitHub tab (same-origin session)
    const tabRes = await tryFetchViaGitHubTab();
    if (tabRes && tabRes.success) {
      if (tabRes.prs && tabRes.prs.length > 0) {
        await applyPRs(tabRes.prs, tabRes.count, tabRes.username);
        return;
      }
    }

    // Strategy 2: DeclarativeNetRequest network injection fallback
    const session = await syncGitHubSessionRule();

    if (!session.authenticated) {
      // Check if we already have cached PRs
      const storage = await chrome.storage.local.get('cached_prs');
      if (Array.isArray(storage.cached_prs) && storage.cached_prs.length > 0) {
        return; // Retain cached display
      }
      showState('logged-out');
      badgeCountEl.classList.add('hidden');
      statusUserEl.textContent = 'Sync required';
      statusUpdatedEl.textContent = 'Open GitHub tab';
      chrome.runtime.sendMessage({ action: 'updateBadge', count: 0, loggedIn: false });
      return;
    }

    const response = await fetch(REVIEW_URL, { cache: 'no-store' });
    const html = await response.text();
    const auth = checkAuthStatus(html, response.url, session.username);

    if (!auth.loggedIn) {
      const storage = await chrome.storage.local.get('cached_prs');
      if (Array.isArray(storage.cached_prs) && storage.cached_prs.length > 0) {
        return;
      }
      showState('logged-out');
      badgeCountEl.classList.add('hidden');
      statusUserEl.textContent = 'Sync required';
      statusUpdatedEl.textContent = 'Open GitHub tab';
      chrome.runtime.sendMessage({ action: 'updateBadge', count: 0, loggedIn: false });
      return;
    }

    const { count, prs } = parsePRsWithDOM(html);
    if (prs.length > 0) {
      await applyPRs(prs, count, auth.username || session.username);
    }

  } catch (err) {
    console.error('Failed to fetch review requests:', err);
    statusUpdatedEl.textContent = 'Sync error';
  } finally {
    isRefreshing = false;
    refreshIcon.classList.remove('spinning');
  }
}

/**
 * Initialize popup
 */
async function init() {
  const storage = await chrome.storage.local.get([
    'notifications_enabled',
    'live_folder_enabled',
    'cached_prs',
    'pr_count',
    'last_checked',
    'loggedIn',
    'username'
  ]);

  updateNotificationUI(storage.notifications_enabled === true);
  updateFolderUI(storage.live_folder_enabled !== false);

  // Render cached data immediately if available
  if (Array.isArray(storage.cached_prs) && storage.cached_prs.length > 0) {
    renderPRs(storage.cached_prs);
    badgeCountEl.textContent = storage.pr_count || storage.cached_prs.length;
    badgeCountEl.classList.remove('hidden');
    showState('prs');

    if (storage.username) statusUserEl.textContent = `@${storage.username}`;
    if (storage.last_checked) statusUpdatedEl.textContent = `Updated ${formatTimeAgo(storage.last_checked)}`;
  } else if (storage.pr_count === 0 && storage.last_checked) {
    showState('empty');
    if (storage.username) statusUserEl.textContent = `@${storage.username}`;
    statusUpdatedEl.textContent = `Updated ${formatTimeAgo(storage.last_checked)}`;
  } else {
    showState('loading');
  }

  // Attempt refresh
  await loadReviewRequests(false);

  // Event Listeners
  btnRefresh.addEventListener('click', () => {
    loadReviewRequests(true);
  });

  btnToggleNotif.addEventListener('click', async () => {
    const current = await chrome.storage.local.get('notifications_enabled');
    const newState = !(current.notifications_enabled === true);
    await chrome.storage.local.set({ notifications_enabled: newState });
    updateNotificationUI(newState);
  });

  if (btnToggleFolder) {
    btnToggleFolder.addEventListener('click', async () => {
      const current = await chrome.storage.local.get('live_folder_enabled');
      const newState = current.live_folder_enabled === false ? true : false;
      await chrome.storage.local.set({ live_folder_enabled: newState });
      updateFolderUI(newState);
      chrome.runtime.sendMessage({ action: 'toggle_live_folder', enabled: newState });
    });
  }

  // Reactive listener: whenever content script syncs PRs from visiting GitHub, update popup immediately!
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.cached_prs && changes.cached_prs.newValue) {
      const prs = changes.cached_prs.newValue;
      const count = changes.pr_count ? changes.pr_count.newValue : prs.length;
      if (prs.length > 0) {
        renderPRs(prs);
        badgeCountEl.textContent = count;
        badgeCountEl.classList.remove('hidden');
        showState('prs');
      } else {
        showState('empty');
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
