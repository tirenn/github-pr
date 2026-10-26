# GitHub PR Reviewer — Arc-Style Live Folder for Chrome

A Chrome extension (Manifest V3) that brings **Arc Browser's iconic GitHub Live Folder** to Google Chrome. It automatically manages a dynamic, auto-updating native **Chrome Tab Group** in your tab strip for pull requests awaiting your review.

---

## 🌟 Key Features

### 🟣 Arc-Style Native Tab Group Live Folder
- **Auto-Populates Background Tabs**: When a new PR review is requested, a tab is quietly placed inside a native Chrome Tab Group named **`PR Reviews (N)`** with purple branding.
- **Auto-Dismisses When Reviewed**: As soon as you review, approve, or the PR is merged/closed, the tab automatically closes itself and leaves the group, keeping your browser completely clutter-free.
- **Collapsed by Default**: Stays neatly collapsed into a tiny pill in your tab strip so it takes zero space until you click to expand it.
- **Zero-Friction Toggle**: Easily enable or disable the Tab Group Live Folder anytime via the folder icon in the popup.

### 🔔 Live Badge Counter & Notifications
- Live count of unreviewed PRs on the extension toolbar icon.
- Optional desktop notifications when brand new review requests arrive.

### ⚡ Instant Same-Origin Sync
- Content script automatically captures your live review requests whenever you visit `https://github.com/pulls/review-requested` or have GitHub open.

---

## 🚀 How to Install in Chrome

1. Open Google Chrome.
2. Navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select this directory:
   ```
   /Users/tirenn/Documents/Work/Extention/github-pr
   ```
6. Pin **GitHub PR Reviewer** to your Chrome toolbar.

---

## 💡 How to Use

1. Make sure you are logged into [GitHub](https://github.com) in Chrome.
2. Open **[github.com/pulls/review-requested](https://github.com/pulls/review-requested)** once to sync your review requests.
3. Watch the **`🟣 PR Reviews`** tab group appear in your Chrome tab bar with your review requests!
