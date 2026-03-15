# X Poster

Autonomous X/Twitter posting and engagement agent with an interactive CLI terminal.

Posts scheduled content to your profile and communities, replies to trending tweets with context-aware responses, and runs unattended as a background daemon.

## Features

- **Scheduled posting** — hourly posts from daily or general queues
- **Community posting** — alternates between profile and X community targets
- **Reply engagement** — finds trending tweets via configurable search tags, replies with sentiment-matched responses
- **Interactive CLI** — real-time status, queue management, config editing without restarts
- **Media support** — attach images to posts (X Premium long-form text supported)
- **Sentiment detection** — categorizes tweets (bullish/bearish/dev/AI/finance/startup/hodl) and picks contextual replies
- **Screen session** — runs detached, survives SSH disconnects, cron watchdog auto-restarts
- **Fully configurable** — all settings in `.env`, reply templates and search tags editable via CLI or JSON

## Quick Start

```bash
# 1. Clone and install
git clone <repo-url> x-poster
cd x-poster
npm install

# 2. Run interactive setup
./x-poster.sh setup

# 3. Add your posts
cp data/posts.sample.json data/posts/posts.json
# Edit data/posts/posts.json with your content

# 4. Start the agent
./x-poster.sh start

# 5. Open the interactive CLI
./x-poster.sh
```

See [docs/user-guide.md](docs/user-guide.md) for detailed setup and usage instructions.

## Documentation

| Document | Description |
|---|---|
| [User Guide](docs/user-guide.md) | Setup, configuration, daily usage, troubleshooting |
| [Developer Guide](docs/developer-guide.md) | Architecture, extending the agent, adding features |
| [Contributing](CONTRIBUTING.md) | How to contribute, code standards, PR process |

## How It Works

The agent runs two independent loops as a background daemon:

```
┌─────────────────────────────────────────────┐
│               x-poster agent                │
│                                             │
│  ┌───────────────┐  ┌────────────────────┐  │
│  │  Post Loop    │  │  Reply Loop        │  │
│  │  ~1 post/hr   │  │  ~1 reply/5-25min  │  │
│  │               │  │                    │  │
│  │  daily file   │  │  search X for      │  │
│  │  → or posts   │  │  trending tweets   │  │
│  │  → profile    │  │  → match sentiment │  │
│  │  → community  │  │  → reply           │  │
│  └───────────────┘  └────────────────────┘  │
│                                             │
│  state.json ←→ CLI (read/write commands)    │
└─────────────────────────────────────────────┘
```

Communication between CLI and agent happens via `data/state.json` — the CLI writes commands, the agent polls every 3 seconds.

## CLI Preview

```
  ╔══════════════════════════════════════════╗
  ║         X POSTER AGENT — CONTROL         ║
  ╚══════════════════════════════════════════╝

  Agent:    RUNNING
  Uptime:   Started 2h ago

  Posts:     ACTIVE  |  Sent: 12  |  Failed: 0
  Replies:   ACTIVE  |  Sent: 8

  Last post:    23m ago
  Last reply:   4m ago
  Next post:    37min
  Next reply:   11min

  x-poster> _
```

## File Structure

```
x-poster/
├── x-poster.sh              # Launcher (start/stop/setup/cli/help)
├── agent.js                 # Background daemon
├── cli.js                   # Interactive terminal
├── setup.js                 # Setup wizard
├── package.json
├── .env                     # Config (gitignored)
├── .env.sample              # Config template
├── LICENSE                  # GNU Affero General Public License v3.0
├── CONTRIBUTING.md          # Contribution guidelines
├── docs/
│   ├── user-guide.md        # User documentation
│   └── developer-guide.md   # Developer documentation
└── data/
    ├── cookies.json         # Auth cookies (gitignored)
    ├── cookies.sample.json  # Cookie format reference
    ├── search-tags.json     # Search queries + reply templates
    ├── search-tags.sample.json
    ├── state.json           # Runtime state (gitignored)
    ├── posts.sample.json    # Posts format reference
    ├── posts/               # Post queues (gitignored)
    └── media/               # Images for posts (gitignored)
```

## Contributors

- **[6h33t@-@-br3@dcrum](no-github)** — creator, maintainer

## License

GNU Affero General Public License v3.0 — see [LICENSE](LICENSE).
