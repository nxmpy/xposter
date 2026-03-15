# Developer Guide

Architecture, internals, and how to extend X Poster.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Module Breakdown](#module-breakdown)
- [Data Flow](#data-flow)
- [Agent Internals](#agent-internals)
- [CLI Internals](#cli-internals)
- [Adding a New Reply Category](#adding-a-new-reply-category)
- [Adding a New Post Target](#adding-a-new-post-target)
- [Adding a New CLI Command](#adding-a-new-cli-command)
- [Adding a New ENV Config](#adding-a-new-env-config)
- [Browser Automation Notes](#browser-automation-notes)
- [File Formats](#file-formats)
- [Error Handling Strategy](#error-handling-strategy)
- [Security Considerations](#security-considerations)

---

## Architecture Overview

```
                    ┌──────────────┐
                    │  x-poster.sh │  Launcher (bash)
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
     ┌────────▼──┐  ┌──────▼──┐  ┌─────▼────┐
     │ setup.js  │  │ agent.js│  │  cli.js   │
     │ (wizard)  │  │ (daemon)│  │ (terminal)│
     └───────────┘  └────┬────┘  └─────┬─────┘
                         │             │
                    ┌────▼─────────────▼────┐
                    │      data/            │
                    │  state.json (IPC)     │
                    │  search-tags.json     │
                    │  cookies.json         │
                    │  posts/*.json         │
                    │  activity.log         │
                    └───────────────────────┘
```

### Key Design Decisions

1. **File-based IPC** — CLI and agent communicate through `state.json` instead of sockets or signals. Simple, debuggable, works across restarts.

2. **Fresh browser per action** — Each post or reply opens a new Puppeteer instance with fresh cookies. Avoids stale sessions, memory leaks, and cookie expiration during long-running sessions.

3. **Two independent loops** — Post loop and reply loop run on separate timers. One failing doesn't affect the other.

4. **Daily file priority** — `daily-YYYY-MM-DD.json` is checked first, then `posts.json`. This allows both scheduled content and an evergreen fallback.

5. **Mark-before-retry** — Failed posts are marked `posted: true` with an `error` field. This prevents infinite retry loops on permanently broken posts.

## Module Breakdown

### agent.js (~400 lines)

The background daemon. Key sections:

| Section | Lines | Purpose |
|---|---|---|
| Config | 25-35 | ENV loading into CONFIG object |
| State | 37-55 | Runtime state management, persistence |
| Helpers | 57-100 | sleep, random, logging, file I/O |
| Browser | 102-170 | Puppeteer launch, cookies, dismiss banners, type text |
| Media | 152-170 | `resolveMedia()` and `attachMedia()` for image uploads |
| Post Profile | 172-196 | Compose → type → attach media → click Post |
| Post Community | 198-220 | Navigate to community → find compose → type → Post |
| Reply Engine | 222-300 | Search → filter candidates → match sentiment → reply |
| Reply Loop | 302-315 | Independent timer for reply cycle |
| Post Cycle | 317-370 | Main post loop with error handling |
| API | 372-420 | start(), stop(), getStatus(), postOne() exports |
| Command Poller | 422-440 | 3s interval reading `_cmd` from state.json |

### cli.js (~350 lines)

Interactive terminal. Key sections:

| Section | Purpose |
|---|---|
| Data helpers | Read/write state.json, search-tags.json |
| Display functions | Status, queue, activity log rendering |
| Config: Tags | showTags(), addTag(), removeTag() |
| Config: Communities | showCommunities(), addCommunity(), removeCommunity() |
| Config: Replies | showReplies(), addReply(), removeReply() |
| Config: Categories | addCategory(), removeCategory() |
| Config: Rules | addRule(), removeRule() |
| Command parser | handleCommand() — routes input to functions |

### setup.js (~100 lines)

Interactive wizard. Asks for username, cookies, community, intervals, search tags. Writes `.env` and data files.

### x-poster.sh (~100 lines)

Bash launcher. Manages screen sessions, routes subcommands to Node scripts.

## Data Flow

### Post Flow
```
posts.json → agent reads → picks next unposted →
  openBrowser() → navigate to compose → typeText() →
  attachMedia() (if media) → findPostButton() → click →
  mark posted → savePosts() → saveState() → schedule next
```

### Reply Flow
```
search-tags.json → agent reads queries & templates →
  openBrowser() → search X → collect tweets →
  filter candidates → match sentiment via rules →
  pick reply from matched category pool →
  click reply button on article → type reply → Post →
  schedule next reply
```

### CLI → Agent Communication
```
CLI: user types "pause posts"
CLI: reads state.json, sets _cmd = "pause_posts", writes state.json
Agent: 3s poll reads state.json, sees _cmd
Agent: sets state.postsPaused = true, removes _cmd, writes state.json
```

## Agent Internals

### Sentiment Matching

The agent loads `sentiment_rules` from `search-tags.json`. Each category maps to an array of keyword strings. When processing a tweet for reply:

```javascript
for (const [category, keywords] of Object.entries(rules)) {
  if (keywords.some(kw => tweetText.toLowerCase().includes(kw.toLowerCase()))) {
    matchedCategory = category;
    break;  // first match wins
  }
}
```

Order matters — categories are checked in JSON object key order. `general` should be last (it's the fallback if nothing matches).

### Post File Resolution

```javascript
function getPostsFile() {
  // 1. Check for today's daily file
  const daily = `data/posts/daily-${YYYY-MM-DD}.json`;
  if (exists(daily)) return daily;

  // 2. Fall back to general queue
  return 'data/posts/posts.json';
}
```

### Media Resolution

```javascript
function resolveMedia(filename) {
  // Check in order:
  // 1. Absolute path
  // 2. data/media/<filename>
  // 3. data/media/general/<filename>
}
```

## CLI Internals

### Command Parsing

Commands are parsed by splitting on whitespace. The first 1-2 tokens determine the action, remaining tokens are arguments:

```
"reply add bullish this is great" →
  cmd = "reply", cmd2 = "add", category = "bullish", text = "this is great"
```

The original case is preserved for values (reply text, URLs) while command matching is case-insensitive.

### Config Editing

All config changes write directly to `data/search-tags.json`. The agent loads this file fresh on every reply cycle, so changes are picked up automatically without restart.

## Adding a New Reply Category

1. Via CLI:
```
x-poster> category add nft
x-poster> rule add nft NFT
x-poster> rule add nft opensea
x-poster> rule add nft digital art
x-poster> reply add nft the NFT space is still finding its footing but the builders are real
x-poster> reply add nft digital ownership is a genuinely new primitive. most people haven't grasped the implications
```

2. Or edit `data/search-tags.json` directly:
```json
{
  "reply_templates": {
    "nft": ["reply 1", "reply 2"]
  },
  "sentiment_rules": {
    "nft": ["NFT", "opensea", "digital art"]
  }
}
```

## Adding a New Post Target

Currently supports `"profile"` and `"community"`. To add a new target (e.g., `"thread"`):

1. Add a new posting function in `agent.js`:
```javascript
async function postThread(texts, mediaFiles) {
  // Open browser, compose, post first tweet
  // Then reply to own tweet for each subsequent part
}
```

2. Update `postCycle()` to handle the new target:
```javascript
if (target === 'thread') await postThread(next.texts, next.media);
else if (target === 'community') await postToCommunity(next.text, next.media);
else await postToProfile(next.text, next.media);
```

## Adding a New CLI Command

1. Add the handler function in `cli.js`:
```javascript
function showConfig() {
  // Read .env and display
}
```

2. Add the command match in `handleCommand()`:
```javascript
else if (cmd === 'config') { console.log(''); showConfig(); }
```

3. Add to `showHelp()`:
```javascript
console.log(`    ${C.cyan}config${C.reset}                       Show current configuration`);
```

## Adding a New ENV Config

1. Add to `.env.sample` with documentation comment
2. Add to `CONFIG` object in `agent.js`:
```javascript
const CONFIG = {
  // ...existing...
  newOption: process.env.NEW_OPTION || 'default',
};
```
3. Use `CONFIG.newOption` in the relevant code
4. Update `setup.js` to ask for it during wizard
5. Update docs

## Browser Automation Notes

### Selectors Used

| Element | Selector | Notes |
|---|---|---|
| Compose textarea | `[data-testid="tweetTextarea_0"]` | Main compose box |
| Post button | `[data-testid="tweetButton"]` | Primary post button |
| Inline post button | `[data-testid="tweetButtonInline"]` | Alternative |
| File input | `[data-testid="fileInput"]` | Media upload |
| Media preview | `[data-testid="attachments"]` | Confirms upload success |
| Reply button | `[data-testid="reply"]` | On tweet articles |
| Tweet article | `article[data-testid="tweet"]` | Individual tweet container |
| Tweet text | `[data-testid="tweetText"]` | Text content within tweet |

These selectors are X/Twitter's internal test IDs. They can change without notice. If the agent starts failing to find elements, check these selectors first.

### Anti-Detection

- `webdriver` property spoofed to `false` via `evaluateOnNewDocument`
- Custom User-Agent string (configurable via ENV)
- Human-like typing delays (30-50ms per character with jitter)
- Sleep intervals between actions

### Cookie Banner

X shows a cookie consent banner for EU users. The agent dismisses it by searching for buttons containing "refuse", "reject", or "decline" text.

## File Formats

### state.json
```json
{
  "running": true,
  "postsPaused": false,
  "repliesPaused": false,
  "totalPosted": 12,
  "totalReplied": 8,
  "totalFailed": 1,
  "lastPosted": "2026-03-15T14:30:00.000Z",
  "lastReplied": "2026-03-15T14:25:00.000Z",
  "lastError": null,
  "nextPost": "2026-03-15T15:30:00.000Z",
  "nextReply": "2026-03-15T14:40:00.000Z",
  "currentFile": "daily-2026-03-15.json",
  "startedAt": "2026-03-15T12:00:00.000Z",
  "_cmd": null
}
```

The `_cmd` field is used for CLI → agent communication. Valid commands: `start`, `stop`, `pause_posts`, `resume_posts`, `pause_replies`, `resume_replies`.

### search-tags.json
```json
{
  "reply_queries": ["bitcoin", "crypto", ...],
  "community_targets": ["https://x.com/i/communities/..."],
  "reply_templates": {
    "category_name": ["reply 1", "reply 2", ...]
  },
  "sentiment_rules": {
    "category_name": ["keyword1", "keyword2", ...]
  }
}
```

## Error Handling Strategy

1. **Post errors** — marked as posted with `error` field. Prevents retry loops. The agent moves to the next post.

2. **Reply errors** — logged, skipped. The reply loop schedules the next attempt normally.

3. **Browser crashes** — each action uses try/finally with `closeBrowser()`. Orphan browser processes are cleaned up.

4. **File errors** — state.json and search-tags.json are loaded with try/catch. Missing files use sensible defaults.

5. **Navigation timeouts** — caught gracefully. The action is logged as failed and the loop continues.

## Security Considerations

- **Cookies** — stored in `data/cookies.json` (gitignored). Never commit. Rotate if compromised.
- **No passwords in ENV** — authentication is cookie-based only.
- **Puppeteer sandbox** — runs with `--no-sandbox` (required for most server environments). Acceptable risk for a dedicated automation server.
- **Rate limiting** — respect X's implicit rate limits. Default intervals (1 post/hour, 1 reply/5-25min) are conservative.
- **Content moderation** — the agent posts what you tell it to. Review your posts.json and reply templates before deploying.
