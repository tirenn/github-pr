import { checkAuthStatus, parsePRsWithRegex } from './lib/parser.js';
import { syncGitHubSessionRule } from './lib/session.js';

const REVIEW_URL = 'https://github.com/pulls/review-requested';
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
 * Fetch and process review requests from GitHub
 */
export async function checkReviewRequests() {
  try {
    // 1. Sync session cookies with declarativeNetRequest rule
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

    // 2. Fetch page (declarativeNetRequest rule injects session cookies automatically)
    const response = await fetch(REVIEW_URL, {
      cache: 'no-store'
    });

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

    // Read notification settings and previous seen PR IDs
    const storage = await chrome.storage.local.get([
      'notifications_enabled',
      'seen_pr_ids'
    ]);

    const notificationsEnabled = storage.notifications_enabled === true;
    const previousSeenIds = Array.isArray(storage.seen_pr_ids) ? storage.seen_pr_ids : [];

    // Find genuinely new PRs
    const currentIds = prs.map((p) => p.id);
    const newPrs = prs.filter((p) => !previousSeenIds.includes(p.id));

    // Fire notification if enabled and there are new PRs
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

    // Save to local storage
    await chrome.storage.local.set({
      loggedIn: true,
      username: auth.username || session.username || '',
      pr_count: count,
      cached_prs: prs,
      seen_pr_ids: currentIds,
      auth_error: '',
      last_checked: Date.now()
    });

    await updateBadge(count, true);

    return { loggedIn: true, count, prs, username: auth.username || session.username };
  } catch (error) {
    console.error('Error checking review requests:', error);
    return { error: error.message };
  }
}

// Extension Lifecycle: onInstalled
chrome.runtime.onInstalled.addListener(async () => {
  const { notifications_enabled } = await chrome.storage.local.get('notifications_enabled');
  if (typeof notifications_enabled === 'undefined') {
    await chrome.storage.local.set({ notifications_enabled: false });
  }

  // Setup periodic polling alarm
  chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: DEFAULT_PERIOD_MINUTES
  });

  // Run immediate initial check
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

// Handle messages from Popup (e.g. manual refresh)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'refresh') {
    checkReviewRequests().then((result) => sendResponse(result));
    return true; // Keep message channel open for async response
  }

  if (message.action === 'updateBadge') {
    updateBadge(message.count, message.loggedIn);
    sendResponse({ success: true });
    return false;
  }
});
