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
  if (responseUrl.includes('/login') || responseUrl.includes('/session')) {
    return { loggedIn: false };
  }

  if (cookieUser && cookieUser.trim() !== '') {
    return { loggedIn: true, username: cookieUser.trim() };
  }

  const userLoginMatch = html.match(/<meta\s+name="user-login"\s+content="([^"]*)"/i) ||
                         html.match(/<meta\s+name="octolytics-actor-login"\s+content="([^"]*)"/i) ||
                         html.match(/data-login="([^"]*)"/i) ||
                         html.match(/data-current-user="([^"]*)"/i);

  if (userLoginMatch && userLoginMatch[1] && userLoginMatch[1].trim() !== '') {
    return { loggedIn: true, username: userLoginMatch[1].trim() };
  }

  const hasLoginForm = html.includes('id="login_field"') || 
                       html.includes('action="/session"') && html.includes('type="password"');

  if (hasLoginForm) {
    return { loggedIn: false };
  }

  return { loggedIn: true };
}

/**
 * Universal PR extraction from DOM document (works on both classic and modern React GitHub UI)
 * @param {Document} doc 
 * @returns {{ count: number, prs: Array<Object> }}
 */
export function parsePRsWithDOM(docOrHtml) {
  let doc = docOrHtml;
  if (typeof docOrHtml === 'string') {
    doc = new DOMParser().parseFromString(docOrHtml, 'text/html');
  }

  const prs = [];
  const seenIds = new Set();

  // Find all links to pull requests
  const links = doc.querySelectorAll('a[href*="/pull/"]');

  links.forEach((link) => {
    const href = link.getAttribute('href') || '';
    // Match /owner/repo/pull/123 (excluding #comments, /commits, etc.)
    const match = href.match(/^(?:https:\/\/github\.com)?\/([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+)\/pull\/(\d+)(?:$|[?#])/i);
    if (!match) return;

    const repo = match[1];
    const number = match[2];
    const id = `${repo}#${number}`;

    if (seenIds.has(id)) return;

    // Filter out metadata links (e.g. comment count icons or commit hashes)
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
  const counterEl = doc.querySelector('a[href*="/pulls/reviews"] .Counter, a[href*="review"] .Counter, [data-component="counter"], .Counter');
  if (counterEl) {
    const rawCount = parseInt(counterEl.textContent.replace(/,/g, '').trim(), 10);
    if (!isNaN(rawCount)) {
      count = Math.max(count, rawCount);
    }
  }

  // Also check "X Open" text
  const openTextEl = doc.querySelector('.table-list-header-toggle, [data-testid="filters-summary"]');
  if (openTextEl) {
    const openMatch = openTextEl.textContent.match(/([0-9,]+)\s+Open/i);
    if (openMatch && openMatch[1]) {
      const openCount = parseInt(openMatch[1].replace(/,/g, ''), 10);
      if (!isNaN(openCount)) {
        count = Math.max(count, openCount);
      }
    }
  }

  return {
    count: Math.max(count, prs.length),
    prs
  };
}

/**
 * Fast regex parsing for Service Worker
 * @param {string} html 
 * @returns {{ count: number, prs: Array<Object> }}
 */
export function parsePRsWithRegex(html) {
  let count = 0;

  // Counter match
  const counterMatch = html.match(/href="[^"]*review-requested[^"]*"[^>]*>[\s\S]*?<span[^>]*class="[^"]*Counter[^"]*"[^>]*>([0-9,]+)<\/span>/i) ||
                       html.match(/([0-9,]+)\s+Open/i);
  if (counterMatch && counterMatch[1]) {
    count = parseInt(counterMatch[1].replace(/,/g, ''), 10) || 0;
  }

  const prs = [];
  const seenIds = new Set();
  
  // Universal regex matching any link href="/(owner/repo)/pull/(\d+)"
  const prRegex = /href="(?:\/|https:\/\/github\.com\/)([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+)\/pull\/(\d+)(?:$|[?#"])[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = prRegex.exec(html)) !== null) {
    const repo = match[1];
    const number = match[2];
    const id = `${repo}#${number}`;

    if (!seenIds.has(id)) {
      const rawTitle = match[3].replace(/<[^>]+>/g, '').trim().replace(/\s+/g, ' ');
      // Filter out commit/comment/number-only links
      if (rawTitle && rawTitle.length > 2 && !rawTitle.startsWith('#') && rawTitle !== number) {
        seenIds.add(id);
        prs.push({
          id,
          repo,
          number: `#${number}`,
          title: rawTitle,
          url: `https://github.com/${repo}/pull/${number}`
        });
      }
    }
  }

  return {
    count: Math.max(count, prs.length),
    prs
  };
}
