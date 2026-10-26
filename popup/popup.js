import { checkAuthStatus, parsePRsWithDOM } from '../lib/parser.js';
import { syncGitHubSessionRule } from '../lib/session.js';

const REVIEW_URL = 'https://github.com/pulls/review-requested';

// DOM Elements
const badgeCountEl = document.getElementById('badge-count');
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
 * Fetch latest review requests and update UI
 */
async function loadReviewRequests(showSpinner = false) {
  if (isRefreshing) return;
  isRefreshing = true;

  if (showSpinner) {
    refreshIcon.classList.add('spinning');
  }

  try {
    // 1. Sync session cookies with declarativeNetRequest rule
    const session = await syncGitHubSessionRule();

    if (!session.authenticated) {
      if (loggedOutMsg) {
        loggedOutMsg.textContent = session.error || 'Log in to your GitHub account in Chrome to see pull requests awaiting your review.';
      }
      showState('logged-out');
      badgeCountEl.classList.add('hidden');
      statusUserEl.textContent = 'Not logged in';
      statusUpdatedEl.textContent = 'Sign-in required';
      
      chrome.runtime.sendMessage({ action: 'updateBadge', count: 0, loggedIn: false });
      return;
    }

    // 2. Fetch with declarativeNetRequest rule handling cookies at network layer
    const response = await fetch(REVIEW_URL, {
      cache: 'no-store'
    });

    const html = await response.text();
    const auth = checkAuthStatus(html, response.url, session.username);

    if (!auth.loggedIn) {
      if (loggedOutMsg) {
        loggedOutMsg.textContent = 'Session expired or redirect to login. Please ensure you are logged into github.com.';
      }
      showState('logged-out');
      badgeCountEl.classList.add('hidden');
      statusUserEl.textContent = 'Not logged in';
      statusUpdatedEl.textContent = 'Sign-in required';
      
      chrome.runtime.sendMessage({ action: 'updateBadge', count: 0, loggedIn: false });
      return;
    }

    // User is logged in
    const { count, prs } = parsePRsWithDOM(html);

    // Update Header Badge
    if (count > 0) {
      badgeCountEl.textContent = count;
      badgeCountEl.classList.remove('hidden');
    } else {
      badgeCountEl.classList.add('hidden');
    }

    // Update PR list or empty state
    if (prs.length === 0) {
      showState('empty');
    } else {
      renderPRs(prs);
      showState('prs');
    }

    // Update Footer
    const displayUser = auth.username || session.username;
    if (displayUser) {
      statusUserEl.textContent = `@${displayUser}`;
    } else {
      statusUserEl.textContent = 'GitHub Connected';
    }
    statusUpdatedEl.textContent = 'Updated just now';

    // Cache results & seen IDs
    const now = Date.now();
    await chrome.storage.local.set({
      loggedIn: true,
      username: displayUser || '',
      pr_count: count,
      cached_prs: prs,
      seen_pr_ids: prs.map((p) => p.id),
      last_checked: now
    });

    // Notify service worker to update badge
    chrome.runtime.sendMessage({ action: 'updateBadge', count, loggedIn: true });

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
  // 1. Load notification preference
  const storage = await chrome.storage.local.get([
    'notifications_enabled',
    'cached_prs',
    'pr_count',
    'last_checked',
    'loggedIn',
    'username'
  ]);

  updateNotificationUI(storage.notifications_enabled === true);

  // 2. Render cached data immediately for instant display
  if (storage.loggedIn === false) {
    showState('logged-out');
  } else if (Array.isArray(storage.cached_prs) && storage.cached_prs.length > 0) {
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

  // 3. Fetch fresh data in background
  await loadReviewRequests(false);

  // Setup Event Listeners
  btnRefresh.addEventListener('click', () => {
    loadReviewRequests(true);
  });

  btnToggleNotif.addEventListener('click', async () => {
    const current = await chrome.storage.local.get('notifications_enabled');
    const newState = !(current.notifications_enabled === true);
    await chrome.storage.local.set({ notifications_enabled: newState });
    updateNotificationUI(newState);
  });
}

document.addEventListener('DOMContentLoaded', init);
