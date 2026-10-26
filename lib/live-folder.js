/**
 * Arc-Style Live Folder for GitHub Pull Requests
 * Manages a dynamic, auto-updating native Chrome Tab Group named "PR Reviews (N)"
 */

const GROUP_BASE_TITLE = 'PR Reviews';
const GROUP_COLOR = 'purple';

/**
 * Normalize GitHub PR URL for accurate comparison
 * e.g. https://github.com/owner/repo/pull/123/files#diff -> https://github.com/owner/repo/pull/123
 */
function normalizePRUrl(rawUrl) {
  if (!rawUrl) return '';
  const match = rawUrl.match(/^(https?:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+)/i);
  return match ? match[1].toLowerCase() : rawUrl.toLowerCase();
}

/**
 * Get active normal Chrome window to host the Live Folder
 */
async function getTargetWindow() {
  try {
    const lastFocused = await chrome.windows.getLastFocused({ populate: false, windowTypes: ['normal'] });
    if (lastFocused && lastFocused.id) return lastFocused;
  } catch (e) {
    // Fallback
  }

  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  return windows.length > 0 ? windows[0] : null;
}

/**
 * Find existing "PR Reviews" tab group in the given window
 */
async function findExistingPRGroup(windowId) {
  try {
    const groups = await chrome.tabGroups.query({ windowId });
    return groups.find((g) => g.title && g.title.startsWith(GROUP_BASE_TITLE)) || null;
  } catch (err) {
    console.warn('Error querying tab groups:', err);
    return null;
  }
}

/**
 * Sync the Live Folder tab group with the current pending PRs list
 * @param {Array<Object>} prs Array of normalized PR objects with url
 */
export async function syncLiveFolder(prs = []) {
  try {
    // Check if Live Folder is enabled in settings (default: true)
    const storage = await chrome.storage.local.get('live_folder_enabled');
    if (storage.live_folder_enabled === false) {
      return;
    }

    const targetWindow = await getTargetWindow();
    if (!targetWindow) return;

    const windowId = targetWindow.id;
    let existingGroup = await findExistingPRGroup(windowId);

    // If 0 PRs: close any existing PR tabs so the folder cleanly dissolves
    if (prs.length === 0) {
      if (existingGroup) {
        const tabsInGroup = await chrome.tabs.query({ groupId: existingGroup.id });
        const tabIdsToClose = tabsInGroup.map((t) => t.id);
        if (tabIdsToClose.length > 0) {
          await chrome.tabs.remove(tabIdsToClose);
        }
      }
      return;
    }

    // Build map of target PR URLs
    const targetPRUrls = new Set(prs.map((p) => normalizePRUrl(p.url)));

    // Get tabs currently in the group (if group exists)
    let currentGroupTabs = [];
    if (existingGroup) {
      currentGroupTabs = await chrome.tabs.query({ groupId: existingGroup.id });
    }

    // 1. Auto-dismiss: Close any tab in the group whose PR is no longer in pending review list!
    const tabsToDismiss = [];
    const existingUrlsInGroup = new Set();

    for (const tab of currentGroupTabs) {
      const tabNormUrl = normalizePRUrl(tab.url || tab.pendingUrl);
      if (tabNormUrl.includes('/pull/') && !targetPRUrls.has(tabNormUrl)) {
        tabsToDismiss.push(tab.id);
      } else {
        existingUrlsInGroup.add(tabNormUrl);
      }
    }

    if (tabsToDismiss.length > 0) {
      await chrome.tabs.remove(tabsToDismiss);
    }

    // 2. Add new PR tabs that are not yet in the group
    const newTabIds = [];
    for (const pr of prs) {
      const normUrl = normalizePRUrl(pr.url);
      if (!existingUrlsInGroup.has(normUrl)) {
        const createdTab = await chrome.tabs.create({
          url: pr.url,
          active: false,
          windowId
        });
        newTabIds.push(createdTab.id);
      }
    }

    // 3. Put new tabs into the group or create a new group
    let groupId = existingGroup ? existingGroup.id : null;

    if (newTabIds.length > 0) {
      if (groupId) {
        await chrome.tabs.group({ tabIds: newTabIds, groupId });
      } else {
        groupId = await chrome.tabs.group({ tabIds: newTabIds, createProperties: { windowId } });
        // Auto-collapse newly created folder so it stays neat
        await chrome.tabGroups.update(groupId, {
          title: `${GROUP_BASE_TITLE} (${prs.length})`,
          color: GROUP_COLOR,
          collapsed: true
        });
        return;
      }
    }

    // 4. Update group title and color
    if (groupId) {
      await chrome.tabGroups.update(groupId, {
        title: `${GROUP_BASE_TITLE} (${prs.length})`,
        color: GROUP_COLOR
      });
    }

  } catch (err) {
    console.error('Error syncing Live Folder:', err);
  }
}

/**
 * Remove the Live Folder completely (when disabled by user)
 */
export async function removeLiveFolder() {
  try {
    const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
    for (const win of windows) {
      const group = await findExistingPRGroup(win.id);
      if (group) {
        const tabs = await chrome.tabs.query({ groupId: group.id });
        const ids = tabs.map((t) => t.id);
        if (ids.length > 0) {
          await chrome.tabs.remove(ids);
        }
      }
    }
  } catch (err) {
    console.error('Error removing Live Folder:', err);
  }
}
