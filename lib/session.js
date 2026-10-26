/**
 * Helper to sync GitHub browser cookies with declarativeNetRequest
 * so that fetch requests from the extension bypass SameSite=Lax restrictions
 */
export async function syncGitHubSessionRule() {
  try {
    const cookies = await chrome.cookies.getAll({ domain: 'github.com' });
    const userSessionCookie = cookies.find((c) => c.name === 'user_session');
    const dotcomUserCookie = cookies.find((c) => c.name === 'dotcom_user');

    if (!userSessionCookie) {
      return {
        authenticated: false,
        username: '',
        error: 'No active GitHub session cookie found in this Chrome profile.'
      };
    }

    const username = dotcomUserCookie ? dotcomUserCookie.value : '';

    // Construct Cookie header from all github.com cookies
    const cookieString = cookies
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');

    // Register dynamic rule to set Cookie and Referer headers at the network layer
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1001],
      addRules: [
        {
          id: 1001,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'Cookie', operation: 'set', value: cookieString },
              { header: 'Referer', operation: 'set', value: 'https://github.com/' }
            ]
          },
          condition: {
            urlFilter: 'https://github.com/pulls/*',
            resourceTypes: ['xmlhttprequest']
          }
        }
      ]
    });

    return {
      authenticated: true,
      username
    };
  } catch (err) {
    console.error('Failed to sync GitHub session rule:', err);
    return {
      authenticated: false,
      username: '',
      error: err.message
    };
  }
}
