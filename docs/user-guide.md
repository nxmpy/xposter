# User Guide

Complete guide to setting up and using X Poster.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Setup Wizard](#setup-wizard)
- [Manual Configuration](#manual-configuration)
- [Creating Posts](#creating-posts)
- [Using the CLI](#using-the-cli)
- [Managing Search Tags](#managing-search-tags)
- [Managing Communities](#managing-communities)
- [Managing Reply Templates](#managing-reply-templates)
- [Running the Agent](#running-the-agent)
- [Auto-Restart with Cron](#auto-restart-with-cron)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

- **Node.js** 18+ (`node --version`)
- **npm** (`npm --version`)
- **screen** (`screen --version`) — for background daemon
- **X/Twitter account** with active login session in a browser
- **Linux/macOS** (Windows via WSL)

## Installation

```bash
git clone <repo-url> x-poster
cd x-poster
npm install
chmod +x x-poster.sh
```

## Setup Wizard

The easiest way to configure everything:

```bash
./x-poster.sh setup
```

The wizard will ask for:
1. **X username** — your handle without the `@`
2. **Cookies** — paste the JSON array from browser DevTools (see below)
3. **Community URL** — optional, for community posting
4. **Post interval** — how often to post (default: every 55-65 minutes)
5. **Reply interval** — how often to reply (default: every 5-25 minutes)
6. **Search tags** — comma-separated topics for finding tweets to reply to

### Getting Your Cookies

1. Open X/Twitter in your browser and make sure you're logged in
2. Open DevTools: `F12` or `Ctrl+Shift+I` (Cmd+Opt+I on Mac)
3. Go to **Application** tab → **Cookies** → `https://x.com`
4. Find these cookies: `auth_token`, `ct0`, `twid`
5. Format as JSON:

```json
[
  {"key": "auth_token", "value": "paste_value_here", "domain": ".x.com", "path": "/", "httpOnly": true, "secure": true},
  {"key": "ct0", "value": "paste_value_here", "domain": ".x.com", "path": "/", "httpOnly": false, "secure": true},
  {"key": "twid", "value": "paste_value_here", "domain": ".x.com", "path": "/", "httpOnly": false, "secure": true}
]
```

> **Tip:** You can paste the JSON directly during setup, or save it to `data/cookies.json` manually.

> **Note:** Cookies expire periodically. If the agent starts failing, refresh your cookies.

## Manual Configuration

Instead of the wizard, you can configure everything manually:

### .env

```bash
cp .env.sample .env
```

Edit `.env`:
```env
# Account
X_USERNAME=your_username
X_PROFILE_URL=https://x.com/your_username

# Community (leave blank to skip)
COMMUNITY_URL=https://x.com/i/communities/your_id

# Post every 55-65 minutes (1 per hour)
POST_INTERVAL_MIN=55
POST_INTERVAL_MAX=65

# Reply every 5-25 minutes
REPLY_INTERVAL_MIN=5
REPLY_INTERVAL_MAX=25

# Set to false to disable replies
REPLIES_ENABLED=true

# Set to false to see the browser (debugging)
HEADLESS=true
```

### Cookies

```bash
cp data/cookies.sample.json data/cookies.json
# Edit data/cookies.json with your cookie values
```

### Search Tags & Reply Templates

```bash
cp data/search-tags.sample.json data/search-tags.json
# Or edit via the CLI: ./x-poster.sh → tags, replies, etc.
```

## Creating Posts

### Post Format

Posts are JSON arrays. Each post has:

```json
{
  "id": 1,
  "text": "Your tweet content here. Long-form supported for premium accounts.",
  "target": "profile",
  "media": "image.jpg",
  "posted": false,
  "postedAt": null
}
```

| Field | Type | Description |
|---|---|---|
| `id` | number | Unique ID (sequential) |
| `text` | string | Tweet content. No character limit for premium accounts; 280 chars for free |
| `target` | string | `"profile"` (your timeline) or `"community"` (community URL from .env) |
| `media` | string/null | Filename in `data/media/` to attach as image. `null` for text-only |
| `posted` | boolean | Set to `false` for pending. Agent marks `true` after posting |
| `postedAt` | string/null | ISO timestamp, set by agent after posting |

### Daily Posts (Priority)

Create a file named `data/posts/daily-YYYY-MM-DD.json`:

```bash
# Example for March 15, 2026
data/posts/daily-2026-03-15.json
```

The agent checks for today's daily file first. If found, it uses that. If not, it falls back to `data/posts/posts.json`.

### General Queue (Fallback)

Create `data/posts/posts.json` for posts that aren't date-specific.

### Attaching Media

1. Place images in `data/media/` or `data/media/general/`
2. Set the `media` field to the filename:

```json
{
  "id": 5,
  "text": "Check out this chart",
  "target": "profile",
  "media": "chart.jpg"
}
```

Supported formats: jpg, jpeg, png, gif, webp.

## Using the CLI

Open the interactive terminal:

```bash
./x-poster.sh
```

### Agent Controls

| Command | Description |
|---|---|
| `status` | Show agent status, post/reply counts, next scheduled actions |
| `start` | Start the agent (sends command via state file) |
| `stop` | Stop the agent |
| `pause posts` | Pause posting (agent stays running) |
| `resume posts` | Resume posting |
| `pause replies` | Pause reply engagement |
| `resume replies` | Resume replies |

### Content

| Command | Description |
|---|---|
| `queue` | Show next 5 upcoming posts with target and media indicators |
| `activity [n]` | Show last n activity log entries (default 20) |

### Exiting

Type `exit` or `quit`. The agent keeps running in the background.

## Managing Search Tags

Search tags are the queries used to find tweets to reply to.

```
x-poster> tags                    # List all tags
x-poster> tag add prompt engineering   # Add a tag
x-poster> tag rm altcoins              # Remove a tag
```

Changes are saved immediately to `data/search-tags.json` and picked up on the next reply cycle.

## Managing Communities

Community URLs determine where `"target": "community"` posts go.

```
x-poster> communities                                    # List all
x-poster> community add https://x.com/i/communities/123  # Add
x-poster> community rm 1                                 # Remove by index
x-poster> community rm https://x.com/i/communities/123   # Remove by URL
```

## Managing Reply Templates

Reply templates are organized by sentiment category. When the agent finds a tweet, it detects the sentiment and picks a reply from the matching category.

### View Categories

```
x-poster> replies                 # List all categories with counts
x-poster> replies bullish         # List all replies in "bullish"
x-poster> replies dev             # List all replies in "dev"
```

### Add/Remove Replies

```
x-poster> reply add bullish the risk/reward here is genuinely asymmetric
x-poster> reply rm bullish 3      # Remove reply #3 from bullish
```

### Create/Delete Categories

```
x-poster> category add web3       # Create new category
x-poster> category rm web3        # Delete category (can't delete "general")
```

### Manage Sentiment Rules

Sentiment rules are keywords that trigger a specific reply category. The agent checks tweet text against these keywords in order — first match wins.

```
x-poster> rules                              # Show all rules (via replies)
x-poster> rule add web3 decentralized        # Tweets containing "decentralized" → web3 replies
x-poster> rule add web3 onchain              # Add another keyword
x-poster> rule rm web3 decentralized         # Remove a keyword
```

## Running the Agent

### Start/Stop

```bash
./x-poster.sh start      # Start in background (screen session)
./x-poster.sh stop        # Stop
./x-poster.sh restart     # Restart
./x-poster.sh status      # Quick status check
```

### View Logs

```bash
./x-poster.sh logs        # Last 30 lines
./x-poster.sh logs 100    # Last 100 lines
```

Or from inside the CLI: `activity 50`

### View Raw Output

```bash
screen -r x-poster-agent     # Attach to screen session
# Press Ctrl+A then D to detach without stopping
```

## Auto-Restart with Cron

Add a watchdog cron job that restarts the agent if it dies:

```bash
crontab -e
```

Add this line (replace the path):

```
*/30 * * * * screen -ls 2>/dev/null | grep -q x-poster-agent || screen -dmS x-poster-agent bash -c "cd /path/to/x-poster && node agent.js"
```

This checks every 30 minutes if the screen session exists. If not, it starts one.

## Troubleshooting

### Agent won't start
- Check `.env` exists: `ls -la .env`
- Check cookies exist: `ls -la data/cookies.json`
- Check Node version: `node --version` (need 18+)
- Check logs: `cat data/activity.log | tail -20`

### Posts not appearing on X
- **Spam filter**: X may silently filter tweets with hashtags, mass mentions, or contract addresses. Keep content natural.
- **Cookie expired**: Refresh cookies from your browser and update `data/cookies.json`
- **Character limit**: Free accounts have 280 char limit. Premium accounts support long-form.

### Replies failing
- **"No reply button"**: Some tweets have replies disabled. The agent skips these.
- **"No candidates"**: The search query didn't return enough results. Add more search tags.
- **"No textarea"**: X's UI may have changed. Check for agent updates.

### Agent crashes/stops
- Check if screen session exists: `screen -ls`
- Check logs: `./x-poster.sh logs 50`
- Set up the cron watchdog (see above)
- Check for Node.js errors: `screen -r x-poster-agent`

### Cookies expired
1. Log into X in your browser
2. Open DevTools → Application → Cookies → x.com
3. Copy the new `auth_token`, `ct0`, `twid` values
4. Update `data/cookies.json`
5. No restart needed — the agent loads cookies fresh each action
