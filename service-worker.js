import { checkAuthStatus, parsePRsWithRegex } from './lib/parser.js';
import { syncGitHubSessionRule } from './lib/session.js';
import { syncLiveFolder, removeLiveFolder } from './lib/live-folder.js';

const REVIEW_URL = 'https://github.com/pulls/reviews';
const ALARM_NAME = 'check-github-prs';
const DEFAULT_PERIOD_MINUTES = 5;

/**
 * Update extension icon badge
 */
export async function updateBadge(count, loggedIn = true) {
  if (!loggedIn) {
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setBadgeBackgroundColor({ color: '#6e7681' });
    return;
  }

  if (count > 0) {
    const text = count > 99 ? '99+' : String(count);
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color: '#0969da' });
  } else {
    await chrome.action.setBadgeText({ text: '' });
  }
}

/**
 * Handle new PR list updates and notifications
 */
async function processPRsResult(prs, count, username) {
  const storage = await chrome.storage.local.get([
    'notifications_enabled',
    'seen_pr_ids'
  ]);

  const notificationsEnabled = storage.notifications_enabled === true;
  const previousSeenIds = Array.isArray(storage.seen_pr_ids) ? storage.seen_pr_ids : [];

  const currentIds = prs.map((p) => p.id);
  const newPrs = prs.filter((p) => !previousSeenIds.includes(p.id));

  if (notificationsEnabled && newPrs.length > 0 && previousSeenIds.length > 0) {
    if (newPrs.length === 1) {
      const item = newPrs[0];
      chrome.notifications.create(item.url, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
        title: 'New PR Review Requested',
        message: `${item.repo}: ${item.title}`,
        priority: 2
      });
    } else {
      chrome.notifications.create(REVIEW_URL, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
        title: `${newPrs.length} New PRs Need Review`,
        message: `${newPrs[0].repo} and ${newPrs.length - 1} other pull request(s) await your review.`,
        priority: 2
      });
    }
  }

  await chrome.storage.local.set({
    loggedIn: true,
    username: username || '',
    pr_count: count,
    cached_prs: prs,
    seen_pr_ids: currentIds,
    auth_error: '',
    last_checked: Date.now()
  });

  await updateBadge(count, true);

  // Sync Arc-style native Chrome tab group Live Folder
  await syncLiveFolder(prs);
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
 * Fetch and process review requests from GitHub
 */
export async function checkReviewRequests() {
  try {
    // Strategy A: If a GitHub tab is open, fetch directly through it (100% same-origin session)
    const tabData = await tryFetchViaGitHubTab();
    if (tabData && tabData.success) {
      await processPRsResult(tabData.prs, tabData.count, tabData.username);
      return { loggedIn: true, count: tabData.count, prs: tabData.prs, username: tabData.username };
    }

    // Strategy B: DeclarativeNetRequest network injection fallback
    const session = await syncGitHubSessionRule();

    if (!session.authenticated) {
      await chrome.storage.local.set({
        loggedIn: false,
        cached_prs: [],
        pr_count: 0,
        auth_error: session.error || '',
        last_checked: Date.now()
      });
      await updateBadge(0, false);
      return { loggedIn: false, count: 0, prs: [], error: session.error };
    }

    const response = await fetch(REVIEW_URL, { cache: 'no-store' });
    const html = await response.text();
    const auth = checkAuthStatus(html, response.url, session.username);

    if (!auth.loggedIn) {
      await chrome.storage.local.set({
        loggedIn: false,
        cached_prs: [],
        pr_count: 0,
        last_checked: Date.now()
      });
      await updateBadge(0, false);
      return { loggedIn: false, count: 0, prs: [] };
    }

    const { count, prs } = parsePRsWithRegex(html);
    const username = auth.username || session.username;

    await processPRsResult(prs, count, username);
    return { loggedIn: true, count, prs, username };
  } catch (error) {
    console.error('Error checking review requests:', error);
    return { error: error.message };
  }
}

// Extension Lifecycle: onInstalled
chrome.runtime.onInstalled.addListener(async () => {
  const { notifications_enabled, live_folder_enabled } = await chrome.storage.local.get([
    'notifications_enabled',
    'live_folder_enabled'
  ]);

  if (typeof notifications_enabled === 'undefined') {
    await chrome.storage.local.set({ notifications_enabled: false });
  }

  if (typeof live_folder_enabled === 'undefined') {
    await chrome.storage.local.set({ live_folder_enabled: true });
  }

  chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: DEFAULT_PERIOD_MINUTES
  });

  await checkReviewRequests();
});

// Extension Lifecycle: onStartup
chrome.runtime.onStartup.addListener(async () => {
  await checkReviewRequests();
});

// Alarm Listener
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await checkReviewRequests();
  }
});

// Notification Click: open target PR or Review page
chrome.notifications.onClicked.addListener((url) => {
  if (url && (url.startsWith('https://github.com') || url.startsWith('http'))) {
    chrome.tabs.create({ url });
  } else {
    chrome.tabs.create({ url: REVIEW_URL });
  }
});

// Handle messages from Content Script and Popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'sync_prs_from_dom') {
    processPRsResult(message.prs, message.count, message.username);
    sendResponse({ success: true });
    return false;
  }

  if (message.action === 'toggle_live_folder') {
    if (message.enabled) {
      chrome.storage.local.get('cached_prs').then((st) => syncLiveFolder(st.cached_prs || []));
    } else {
      removeLiveFolder();
    }
    sendResponse({ success: true });
    return false;
  }

  if (message.action === 'refresh') {
    checkReviewRequests().then((result) => sendResponse(result));
    return true;
  }

  if (message.action === 'updateBadge') {
    updateBadge(message.count, message.loggedIn);
    sendResponse({ success: true });
    return false;
  }
});
