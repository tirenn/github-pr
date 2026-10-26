/**
 * Parser utilities for GitHub Pull Requests review page
 */

/**
 * Check if the response indicates the user is logged into GitHub
 * @param {string} html 
 * @param {string} responseUrl 
 * @param {string} [cookieUser]
 * @returns {{ loggedIn: boolean, username?: string }}
 */
export function checkAuthStatus(html, responseUrl = '', cookieUser = '') {
  // If redirected to login or session page, definitely not logged in
  if (responseUrl.includes('/login') || responseUrl.includes('/session')) {
    return { loggedIn: false };
  }

  // If we already detected the user from GitHub's dotcom_user session cookie
  if (cookieUser && cookieUser.trim() !== '') {
    return { loggedIn: true, username: cookieUser.trim() };
  }

  // Check user login meta tags
  const userLoginMatch = html.match(/<meta\s+name="user-login"\s+content="([^"]*)"/i) ||
                         html.match(/<meta\s+name="octolytics-actor-login"\s+content="([^"]*)"/i) ||
                         html.match(/data-login="([^"]*)"/i) ||
                         html.match(/data-current-user="([^"]*)"/i);

  if (userLoginMatch && userLoginMatch[1] && userLoginMatch[1].trim() !== '') {
    return { loggedIn: true, username: userLoginMatch[1].trim() };
  }

  // Check specifically for GitHub login form input elements
  const hasLoginForm = html.includes('id="login_field"') || 
                       html.includes('action="/session"') && html.includes('type="password"');

  if (hasLoginForm) {
    return { loggedIn: false };
  }

  // If response URL is still the review page and no login form, assume authenticated
  return { loggedIn: true };
}

/**
 * Parse PR list using DOMParser (for Popup UI)
 * @param {string} html 
 * @returns {{ count: number, prs: Array<Object> }}
 */
export function parsePRsWithDOM(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Check counter tab if present (e.g., <span class="Counter">3</span>)
  let count = 0;
  const reviewTab = doc.querySelector('a[href*="/pulls/review-requested"] .Counter, a[href*="/pulls/review-requested"] .counter');
  if (reviewTab) {
    const rawCount = parseInt(reviewTab.textContent.replace(/,/g, '').trim(), 10);
    if (!isNaN(rawCount)) {
      count = rawCount;
    }
  }

  const prs = [];
  // Find issue rows
  const rows = doc.querySelectorAll('.Box-row, [id^="issue_"]');

  rows.forEach((row) => {
    // Locate the PR link
    const titleLink = row.querySelector('a[href*="/pull/"][id*="issue_"], a.Link--primary[href*="/pull/"], a.markdown-title[href*="/pull/"]');
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

    // Time / Date
    let timeAgo = '';
    let createdAt = '';
    const timeEl = row.querySelector('relative-time');
    if (timeEl) {
      timeAgo = timeEl.textContent.trim() || timeEl.getAttribute('title') || '';
      createdAt = timeEl.getAttribute('datetime') || '';
    }

    // Check if team review requested
    const isTeam = row.textContent.toLowerCase().includes('team') || row.querySelector('svg.octicon-organization, svg.octicon-people') !== null;

    // Check if draft
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
      createdAt,
      isTeam,
      isDraft
    });
  });

  return {
    count: Math.max(count, prs.length),
    prs
  };
}

/**
 * Fast regex parsing for Service Worker (where DOMParser is unavailable)
 * @param {string} html 
 * @returns {{ count: number, prs: Array<Object> }}
 */
export function parsePRsWithRegex(html) {
  let count = 0;

  // Try extracting count from review-requested counter
  const counterMatch = html.match(/href="[^"]*\/pulls\/review-requested[^"]*"[^>]*>[\s\S]*?<span[^>]*class="[^"]*Counter[^"]*"[^>]*>([0-9,]+)<\/span>/i);
  if (counterMatch && counterMatch[1]) {
    count = parseInt(counterMatch[1].replace(/,/g, ''), 10) || 0;
  }

  // Regex extract PR items matching /owner/repo/pull/123
  const prs = [];
  const seenIds = new Set();
  
  // Match link hrefs: href="/(org/repo)/pull/(\d+)"
  const prRegex = /href="\/([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+)\/pull\/(\d+)"[^>]*class="[^"]*(?:Link--primary|markdown-title)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = prRegex.exec(html)) !== null) {
    const repo = match[1];
    const number = match[2];
    const id = `${repo}#${number}`;

    if (!seenIds.has(id)) {
      seenIds.add(id);
      const title = match[3]
        .replace(/<[^>]+>/g, '') // remove inner HTML tags
        .replace(/\s+/g, ' ')
        .trim();

      prs.push({
        id,
        repo,
        number: `#${number}`,
        title,
        url: `https://github.com/${repo}/pull/${number}`
      });
    }
  }

  return {
    count: Math.max(count, prs.length),
    prs
  };
}
