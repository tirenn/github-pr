/**
 * Content Script running on https://github.com/*
 * Because this script executes directly on github.com, all DOM access and
 * fetch requests have 100% same-origin session credentials.
 */

function extractPRsFromDocument(doc) {
  const prs = [];
  const rows = doc.querySelectorAll('.Box-row, [id^="issue_"]');

  rows.forEach((row) => {
    // Locate the PR link
    const titleLink = row.querySelector('a[href*="/pull/"][id*="issue_"], a.Link--primary[href*="/pull/"], a.markdown-title[href*="/pull/"], a[href*="/pull/"]');
    if (!titleLink) return;

    const href = titleLink.getAttribute('href') || '';
    const match = href.match(/^\/([^/]+\/[^/]+)\/pull\/(\d+)/);
    if (!match) return;

    const repo = match[1];
    const number = match[2];
    const title = titleLink.textContent.trim().replace(/\s+/g, ' ');
    const url = `https://github.com${href}`;

    // Author
    let author = 'unknown';
    const authorLink = row.querySelector('a[data-hovercard-type="user"], .opened-by a.Link--muted, a.muted-link');
    if (authorLink) {
      author = authorLink.textContent.trim();
    }

    // Avatar
    let avatarUrl = '';
    const avatarImg = row.querySelector('img.avatar, .avatar img');
    if (avatarImg) {
      avatarUrl = avatarImg.getAttribute('src') || '';
    }

    // Time
    let timeAgo = '';
    const timeEl = row.querySelector('relative-time');
    if (timeEl) {
      timeAgo = timeEl.textContent.trim() || timeEl.getAttribute('title') || '';
    }

    // Team review vs Draft
    const isTeam = row.textContent.toLowerCase().includes('team') || row.querySelector('svg.octicon-organization, svg.octicon-people') !== null;
    const isDraft = row.textContent.toLowerCase().includes('draft') || row.querySelector('.octicon-git-pull-request-draft') !== null;

    prs.push({
      id: `${repo}#${number}`,
      repo,
      number: `#${number}`,
      title,
      url,
      author,
      avatarUrl,
      timeAgo: timeAgo || 'recently',
      isTeam,
      isDraft
    });
  });

  // Extract open counter
  let count = prs.length;
  const counterEl = doc.querySelector('a[href*="/pulls/review-requested"] .Counter, a[href*="/pulls/review-requested"] .counter');
  if (counterEl) {
    const rawCount = parseInt(counterEl.textContent.replace(/,/g, '').trim(), 10);
    if (!isNaN(rawCount)) {
      count = Math.max(count, rawCount);
    }
  }

  // Extract user login
  const userMeta = doc.querySelector('meta[name="user-login"]') ||
                   doc.querySelector('meta[name="octolytics-actor-login"]');
  const username = userMeta ? userMeta.getAttribute('content') : '';

  return { prs, count, username };
}

// 1. If currently on the /pulls/review-requested page, sync immediately from the live DOM!
if (window.location.pathname.includes('/pulls/review-requested') || 
    (window.location.pathname.startsWith('/pulls') && window.location.search.includes('review-requested'))) {
  // Allow DOM to settle if dynamically rendered
  setTimeout(() => {
    const data = extractPRsFromDocument(document);
    chrome.runtime.sendMessage({
      action: 'sync_prs_from_dom',
      ...data
    });
  }, 500);
}

// 2. Listen for requests from extension to fetch /pulls/review-requested using this tab's session
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetch_prs_from_page') {
    fetch('https://github.com/pulls/review-requested', {
      headers: {
        'Accept': 'text/html'
      }
    })
      .then((res) => res.text())
      .then((html) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const data = extractPRsFromDocument(doc);
        sendResponse({ success: true, ...data });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });

    return true; // Keep channel open for async response
  }
});
