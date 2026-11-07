# GitHub PR Reviewer — Arc-Style Live Folder for Chrome

A Chrome extension (Manifest V3) that brings **Arc Browser's GitHub Live Folder** to Google Chrome. It keeps a native **Chrome Tab Group** in your tab strip filled with the pull requests from your GitHub [`/pulls/involves`](https://github.com/pulls/involves) list, and keeps it up to date in the background.

---

## 🌟 Features

### 🟣 Live Folder (native Tab Group)
- **Fills itself**: each pending PR opens as a background tab inside a purple tab group named **`PR Reviews (N)`**.
- **Cleans itself**: when a PR drops off your list (reviewed, merged, closed), its tab is closed automatically. When the list is empty, the group disappears.
- **Collapsed by default**: a new group starts collapsed, so it takes up one small pill in the tab strip until you expand it.
- **Toggle anytime**: the folder button in the popup turns the Live Folder on or off.

### 🔔 Badge & Notifications
- The toolbar icon shows the number of pending PRs (`!` means you're signed out of GitHub).
- Optional desktop notifications when new PRs show up. Clicking one opens that PR (or the full list if several arrived at once).

### 📋 Popup
- A list of your pending PRs with repo, title, author, number, age, and **Team review** / **Draft** tags. Click a card to open the PR.

---

## 🚀 Installation

1. Clone or download this repository.
2. Open `chrome://extensions/` in Google Chrome.
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** (top-left) and select this repository's folder.
5. Pin **GitHub PR Reviewer** to the toolbar so you can see the badge.

To update after pulling new code, click the **reload ↻** icon on the extension's card in `chrome://extensions/`.

---

## 💡 How to Use

1. **Sign in to [GitHub](https://github.com)** in the same Chrome profile.
2. **Open [github.com/pulls/involves](https://github.com/pulls/involves)** once. This does the first sync.
3. The **`PR Reviews (N)`** tab group appears in your tab strip, and the toolbar badge shows the count.
4. Work through the PRs. When one leaves your list, its tab closes on the next sync (within about a minute).

### Popup controls

| Button | What it does |
| --- | --- |
| 📁 **Folder** | Turns the Live Folder on or off. Turning it **off closes all tabs in the `PR Reviews` group**. Turning it back on rebuilds the group from the last synced list. |
| 🔔 **Bell** | Turns desktop notifications on or off (off by default). |
| ↻ **Refresh** | Syncs now instead of waiting for the next one-minute poll. |
| ↗ **Open in GitHub** | Opens `https://github.com/pulls/involves`. |

### Things to know
- **The Live Folder owns its group.** Any PR tab inside `PR Reviews` that isn't on your list gets closed on the next sync, including tabs you drag in yourself. Open PRs you want to keep in a normal tab instead.
- **It follows `/pulls/involves`**, which on GitHub covers PRs you're involved in (review requested, assigned, mentioned, authored), not only review requests.
- **One window.** The group is created in the current or last-focused normal window.

---

## ⚙️ How It Works

```
                ┌──────────────────────┐
  every 1 min → │   service-worker.js  │ ← popup refresh / toggle
                └──────────┬───────────┘
                           │ 1. ask an open github.com tab (content.js)
                           │ 2. fallback: fetch /pulls/involves with session cookies
                           ▼
                  list of PRs { repo, number, title, url, ... }
                           │
        ┌──────────────────┼──────────────────────┐
        ▼                  ▼                      ▼
  chrome.storage     badge + notifications   lib/live-folder.js
  (popup reads it)                           (sync tab group)
```

### 1. Getting the PR list
The extension doesn't use the GitHub API or a token. It reads the same `/pulls/involves` page you see when signed in, using one of three paths:

- **Live page (content script)**: [`content.js`](content.js) runs on every `github.com` page. When you're on a PR list page (`/pulls/involves`, `/pulls/reviews`, `/pulls/review-requested`, or `/pulls?q=…review…`), it reads the PR links from the page, watches for changes (Turbo navigation, React re-renders), and sends the list to the service worker.
- **Through an open GitHub tab**: on each poll, [`service-worker.js`](service-worker.js) messages any open `github.com` tab. That tab either returns its live list or fetches `/pulls/involves` itself. Since the request comes from github.com, it uses your normal session.
- **Fallback with no GitHub tab open**: [`lib/session.js`](lib/session.js) reads your `github.com` cookies and adds a `declarativeNetRequest` rule that attaches them (plus a `Referer`) to the extension's requests to `github.com/pulls/*`. The service worker then fetches the page and parses it with the regex parser in [`lib/parser.js`](lib/parser.js). If there's no `user_session` cookie, or GitHub redirects to `/login`, the badge shows `!`.

Each PR is identified as `owner/repo#number`. Links that only show a number, hash, or icon are skipped, and duplicates are removed.

### 2. Processing results
`processPRsResult` in the service worker:
- compares the new IDs with the `seen_pr_ids` from the last sync and sends a notification for new ones (if notifications are on, and never on the very first sync),
- saves the list, count, username, and timestamp to `chrome.storage.local` (the popup shows this cached data right away, then refreshes),
- updates the toolbar badge,
- calls `syncLiveFolder(prs)`.

### 3. Syncing the Live Folder
[`lib/live-folder.js`](lib/live-folder.js) works on the tab group whose title starts with `PR Reviews` in the target window:

1. **Close** tabs in the group whose PR URL is no longer on the list. URLs are normalized, so `/pull/123/files#diff` counts as `/pull/123`.
2. **Open** a background tab for each PR that isn't in the group yet.
3. **Group** the new tabs into the existing group, or create one (purple, collapsed).
4. **Rename** the group to `PR Reviews (N)`.

If the list is empty, every tab in the group is closed, so the group goes away.

### Storage keys (`chrome.storage.local`)

| Key | Purpose |
| --- | --- |
| `cached_prs`, `pr_count` | Last synced list and count |
| `seen_pr_ids` | IDs from the last sync, used to spot new PRs |
| `username`, `loggedIn`, `auth_error` | Sign-in state shown in the popup |
| `last_checked` | Time of the last sync |
| `notifications_enabled` | Default `false` |
| `live_folder_enabled` | Default `true` |

---

## 🗂 Project Structure

```
manifest.json          MV3 manifest: permissions, content script, popup, service worker
service-worker.js      Polling alarm, fetching, badge, notifications, message routing
content.js             Reads PRs from github.com pages and answers fetch requests
lib/
  parser.js            Sign-in check + DOM and regex PR parsers
  session.js           Copies GitHub cookies into a declarativeNetRequest header rule
  live-folder.js       Creates, updates, and removes the "PR Reviews" tab group
popup/
  popup.html/.css/.js  Toolbar popup UI
icons/                 Extension icons
```

### Permissions

| Permission | Why |
| --- | --- |
| `tabs`, `tabGroups` | Open, close, and group PR tabs |
| `alarms` | One-minute background poll |
| `storage` | Cache the PR list and settings |
| `notifications` | New-PR alerts |
| `cookies`, `declarativeNetRequest*` | Fallback fetch using your GitHub session |
| `https://github.com/*` | Content script and requests to GitHub |

**Privacy:** everything runs locally. Your cookies and PR data are only sent to `github.com` and stored in `chrome.storage.local`.

---

## 🛠 Troubleshooting

- **Badge shows `!` / "Sync with GitHub"**: sign in to GitHub in this Chrome profile, then open [github.com/pulls/involves](https://github.com/pulls/involves).
- **List is empty or wrong**: open `/pulls/involves` and click **Refresh** in the popup. GitHub changes its page layout from time to time, which can break parsing. The content script logs `[GitHub PR Reviewer] Extracted from DOM:` in the page's DevTools console.
- **Service worker logs**: go to `chrome://extensions/` → GitHub PR Reviewer → **Service worker** → Console.
- **Tab group didn't show up**: check that the folder button in the popup is on (highlighted).
