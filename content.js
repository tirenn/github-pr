/**
 * Content Script running on https://github.com/*
 * Captures pull requests directly from GitHub's live DOM
 */

function extractPRs() {
  const prs = [];
  const seenIds = new Set();

  const links = document.querySelectorAll('a[href*="/pull/"]');

  links.forEach((link) => {
    try {
      const urlObj = new URL(link.href, window.location.origin);
      const parts = urlObj.pathname.split('/').filter(Boolean);
      // Expected structure: ['owner', 'repo', 'pull', 'number', ...]
      if (parts.length >= 4 && parts[2].toLowerCase() === 'pull') {
        const repo = `${parts[0]}/${parts[1]}`;
        const number = parts[3];
        const id = `${repo}#${number}`;

        if (seenIds.has(id)) return;

        const rawTitle = link.textContent.trim().replace(/\s+/g, ' ');
        // Ignore links that are just numbers, commit hashes, or icons
        if (!rawTitle || rawTitle.length < 2 || rawTitle.startsWith('#') || rawTitle === number) {
          return;
        }

        seenIds.add(id);

        const row = link.closest('.Box-row, [id^="issue_"], li, tr, [data-testid="issue-row"], [data-testid="list-item"]') || link.parentElement;

        let author = '';
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
          author: author || 'reviewer',
          avatarUrl,
          timeAgo: timeAgo || 'recently',
          isTeam,
          isDraft
        });
      }
    } catch (e) {
      // Ignore URL errors
    }
  });

  // Extract count
  let count = prs.length;
  const counterEl = document.querySelector('a[href*="review-requested"] .Counter, a[href*="review-requested"] span[class*="Counter"], [data-component="counter"]');
  if (counterEl) {
    const rawCount = parseInt(counterEl.textContent.replace(/,/g, '').trim(), 10);
    if (!isNaN(rawCount)) {
      count = Math.max(count, rawCount);
    }
  }

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

  const userMeta = document.querySelector('meta[name="user-login"]') ||
                   document.querySelector('meta[name="octolytics-actor-login"]');
  const username = userMeta ? userMeta.getAttribute('content') : '';

  return { prs, count, username };
}

function isReviewRequestedPage() {
  const path = window.location.pathname.toLowerCase();
  const search = decodeURIComponent(window.location.search).toLowerCase();
  return path.includes('/pulls/review-requested') ||
         (path.includes('/pulls') && (search.includes('review-requested') || search.includes('review-requested:@me')));
}

let syncTimeout = null;
function scheduleSync() {
  if (!isReviewRequestedPage()) return;

  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => {
    const data = extractPRs();
    console.log('[GitHub PR Reviewer] Extracted from DOM:', data);
    chrome.runtime.sendMessage({
      action: 'sync_prs_from_dom',
      ...data
    });
  }, 350);
}

// Initial sync
scheduleSync();

// Lifecycle & navigation listeners
document.addEventListener('turbo:load', scheduleSync);
document.addEventListener('turbo:render', scheduleSync);
window.addEventListener('popstate', scheduleSync);

// Watch for asynchronous React DOM updates
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

// Respond to messages from the popup or service worker
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetch_prs_from_page') {
    // If this tab is on review-requested, return the live DOM!
    if (isReviewRequestedPage()) {
      const data = extractPRs();
      sendResponse({ success: true, ...data });
      return false;
    }

    // Otherwise, fetch and return
    fetch('https://github.com/pulls/review-requested', { headers: { 'Accept': 'text/html' } })
      .then((res) => res.text())
      .then((html) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const links = doc.querySelectorAll('a[href*="/pull/"]');
        const prs = [];
        const seenIds = new Set();

        links.forEach((link) => {
          try {
            const urlObj = new URL(link.getAttribute('href') || '', 'https://github.com');
            const parts = urlObj.pathname.split('/').filter(Boolean);
            if (parts.length >= 4 && parts[2].toLowerCase() === 'pull') {
              const repo = `${parts[0]}/${parts[1]}`;
              const number = parts[3];
              const id = `${repo}#${number}`;

              if (seenIds.has(id)) return;

              const rawTitle = link.textContent.trim().replace(/\s+/g, ' ');
              if (!rawTitle || rawTitle.length < 2 || rawTitle.startsWith('#') || rawTitle === number) return;

              seenIds.add(id);
              prs.push({
                id,
                repo,
                number: `#${number}`,
                title: rawTitle,
                url: `https://github.com/${repo}/pull/${number}`,
                author: 'reviewer',
                avatarUrl: '',
                timeAgo: 'recently',
                isTeam: false,
                isDraft: false
              });
            }
          } catch (e) {}
        });

        sendResponse({ success: true, prs, count: prs.length, username: '' });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });

    return true;
  }
});
