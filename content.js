/**
 * Content Script running on https://github.com/*
 * Automatically syncs GitHub PR review requests from live DOM and Turbo navigations
 */

function extractPRs() {
  const prs = [];
  const seenIds = new Set();

  // Find all links to pull requests
  const links = document.querySelectorAll('a[href*="/pull/"]');

  links.forEach((link) => {
    const href = link.getAttribute('href') || '';
    const match = href.match(/^(?:https:\/\/github\.com)?\/([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+)\/pull\/(\d+)(?:$|[?#])/i);
    if (!match) return;

    const repo = match[1];
    const number = match[2];
    const id = `${repo}#${number}`;

    if (seenIds.has(id)) return;

    // Filter out non-title links
    const rawTitle = link.textContent.trim().replace(/\s+/g, ' ');
    if (!rawTitle || rawTitle.length < 2 || rawTitle.startsWith('#') || rawTitle === number) {
      return;
    }

    seenIds.add(id);

    // Find row/container for additional metadata
    const row = link.closest('.Box-row, [id^="issue_"], li, tr, [data-testid="issue-row"]') || link.parentElement;

    let author = 'unknown';
    let avatarUrl = '';
    let timeAgo = '';
    let isTeam = false;
    let isDraft = false;

    if (row) {
      const authorEl = row.querySelector('a[data-hovercard-type="user"], .opened-by a, a.Link--muted[href^="/"]');
      if (authorEl && authorEl.textContent.trim()) {
        author = authorEl.textContent.trim();
      }

      const avatarImg = row.querySelector('img.avatar, .avatar img');
      if (avatarImg) {
        avatarUrl = avatarImg.getAttribute('src') || '';
      }

      const timeEl = row.querySelector('relative-time');
      if (timeEl) {
        timeAgo = timeEl.textContent.trim() || timeEl.getAttribute('title') || '';
      }

      const rowText = row.textContent.toLowerCase();
      isTeam = rowText.includes('team review') || row.querySelector('.octicon-organization, .octicon-people') !== null;
      isDraft = rowText.includes('draft') || row.querySelector('.octicon-git-pull-request-draft') !== null;
    }

    prs.push({
      id,
      repo,
      number: `#${number}`,
      title: rawTitle,
      url: `https://github.com/${repo}/pull/${number}`,
      author,
      avatarUrl,
      timeAgo: timeAgo || 'recently',
      isTeam,
      isDraft
    });
  });

  // Extract open counter
  let count = prs.length;
  const counterEl = document.querySelector('a[href*="review-requested"] .Counter, a[href*="review-requested"] span[class*="Counter"], [data-component="counter"]');
  if (counterEl) {
    const rawCount = parseInt(counterEl.textContent.replace(/,/g, '').trim(), 10);
    if (!isNaN(rawCount)) {
      count = Math.max(count, rawCount);
    }
  }

  // Also check "X Open" text
  const openTextEl = document.querySelector('.table-list-header-toggle, [data-testid="filters-summary"]');
  if (openTextEl) {
    const openMatch = openTextEl.textContent.match(/([0-9,]+)\s+Open/i);
    if (openMatch && openMatch[1]) {
      const openCount = parseInt(openMatch[1].replace(/,/g, ''), 10);
      if (!isNaN(openCount)) {
        count = Math.max(count, openCount);
      }
    }
  }

  // Extract username
  const userMeta = document.querySelector('meta[name="user-login"]') ||
                   document.querySelector('meta[name="octolytics-actor-login"]');
  const username = userMeta ? userMeta.getAttribute('content') : '';

  return { prs, count, username };
}

/**
 * Check if the current page is a review-requested view or pull requests list
 */
function isReviewRequestedPage() {
  const path = window.location.pathname;
  const search = decodeURIComponent(window.location.search);
  return path.includes('/pulls/review-requested') ||
         (path.startsWith('/pulls') && (search.includes('review-requested') || search.includes('review-requested:@me')));
}

let syncTimeout = null;
function scheduleSync() {
  if (!isReviewRequestedPage()) return;

  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => {
    const data = extractPRs();
    chrome.runtime.sendMessage({
      action: 'sync_prs_from_dom',
      ...data
    });
  }, 400);
}

// 1. Initial check on script injection
scheduleSync();

// 2. Listen to Turbo navigation & history popstate
document.addEventListener('turbo:load', scheduleSync);
document.addEventListener('turbo:render', scheduleSync);
window.addEventListener('popstate', scheduleSync);

// 3. Monitor DOM changes (handles React/Catalyst asynchronous hydration)
const observer = new MutationObserver(() => {
  if (isReviewRequestedPage()) {
    scheduleSync();
  }
});

if (document.body) {
  observer.observe(document.body, { childList: true, subtree: true });
} else {
  document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

// 4. Listen for on-demand fetch requests from the extension popup/service worker
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetch_prs_from_page') {
    fetch('https://github.com/pulls/review-requested', {
      headers: { 'Accept': 'text/html' }
    })
      .then((res) => res.text())
      .then((html) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        // Extract using same logic on the parsed document
        const links = doc.querySelectorAll('a[href*="/pull/"]');
        const prs = [];
        const seenIds = new Set();

        links.forEach((link) => {
          const href = link.getAttribute('href') || '';
          const match = href.match(/^(?:https:\/\/github\.com)?\/([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+)\/pull\/(\d+)(?:$|[?#])/i);
          if (!match) return;

          const repo = match[1];
          const number = match[2];
          const id = `${repo}#${number}`;

          if (seenIds.has(id)) return;

          const rawTitle = link.textContent.trim().replace(/\s+/g, ' ');
          if (!rawTitle || rawTitle.length < 2 || rawTitle.startsWith('#') || rawTitle === number) {
            return;
          }

          seenIds.add(id);

          prs.push({
            id,
            repo,
            number: `#${number}`,
            title: rawTitle,
            url: `https://github.com/${repo}/pull/${number}`,
            author: 'author',
            avatarUrl: '',
            timeAgo: 'recently',
            isTeam: false,
            isDraft: false
          });
        });

        sendResponse({ success: true, prs, count: prs.length, username: '' });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });

    return true;
  }
});
