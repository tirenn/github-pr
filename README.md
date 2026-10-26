# GitHub PR Reviewer — Chrome Extension

A clean, lightweight Chrome extension (Manifest V3) that monitors GitHub pull requests awaiting your review, displays a live count badge on the toolbar, and lets you view and open them with one click.

## Features

- **Zero Credentials / Zero Setup**: No Personal Access Tokens or OAuth application registration required. It automatically uses your existing active GitHub session in Chrome.
- **Dynamic Badge Counter**: Displays the exact number of pending review requests on the extension icon in your Chrome toolbar.
- **Popup PR List**: Click the icon to view all pending PRs with:
  - Repository name (`owner/repo`)
  - Pull request title and number (`#123`)
  - Author avatar and `@username`
  - Relative age (`2h ago`, `yesterday`)
  - Review type labels (`Team review`, `Draft`)
- **Optional Desktop Notifications**: Includes a quick bell toggle (🔔 / 🔕) in the popup header. When enabled, Chrome alerts you when a new review request arrives. Clicking the alert opens the PR immediately.
- **Smart Background Polling**: Checks GitHub every 5 minutes in the background using `chrome.alarms` and service workers.
- **Dark & Light Mode**: Automatically adapts to your system theme.

---

## How to Install in Chrome

1. Open Google Chrome.
2. Navigate to `chrome://extensions/` in the address bar.
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click the **Load unpacked** button in the top-left corner.
5. Select this directory:
   ```
   /Users/tirenn/Documents/Work/Extention/github-pr
   ```
6. The **GitHub PR Reviewer** icon will appear in your Chrome toolbar (you can pin it by clicking Chrome's puzzle piece icon).

---

## How It Works

1. Make sure you are logged into [GitHub](https://github.com) in Chrome.
2. The extension automatically syncs with your review requests at `https://github.com/pulls/review-requested`.
3. If you have PRs awaiting review, the badge turns blue with the count (e.g. `2`).
4. Click any PR in the list to open it directly in a new tab.
