# Contributing to X Poster

Thanks for your interest in contributing. This document outlines the process for contributing to this project.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone <your-fork-url>`
3. Create a branch: `git checkout -b feature/your-feature-name`
4. Install dependencies: `npm install`
5. Make your changes
6. Test locally (see below)
7. Commit and push
8. Open a Pull Request

## Development Setup

```bash
# Clone and install
git clone <repo-url> x-poster
cd x-poster
npm install

# Copy config files
cp .env.sample .env
cp data/cookies.sample.json data/cookies.json
cp data/search-tags.sample.json data/search-tags.json
cp data/posts.sample.json data/posts/posts.json

# Edit .env with your test account credentials
# Edit data/cookies.json with your test account cookies

# Run the agent in foreground (not as daemon)
node agent.js

# Or run the CLI
node cli.js
```

## Testing Changes

Before submitting a PR, verify:

1. **Agent starts without errors**: `node -e "require('./agent.js')"` should not throw
2. **CLI loads cleanly**: `node cli.js` should show the banner and accept commands
3. **Setup wizard works**: `node setup.js` should complete without errors
4. **Launcher works**: `./x-poster.sh help` should show the help text
5. **No sensitive data committed**: Run `git diff --cached` and check for cookies, tokens, passwords

## Code Standards

### General
- Use `const` by default, `let` when reassignment is needed, never `var`
- Use template literals for string interpolation
- Error handling: catch errors gracefully, log them, don't crash the loops
- Keep functions small and focused

### Agent (agent.js)
- All browser actions must be wrapped in try/finally with `closeBrowser()` in finally
- State changes must call `saveState()` after mutation
- Use `log()` for all output (writes to both console and activity.log)
- Failed posts should be marked as `posted: true` with an `error` field to prevent infinite retry

### CLI (cli.js)
- All data modifications go through `loadTags()`/`saveTags()` helpers
- Commands are case-insensitive for the command portion, case-preserved for values
- Provide user feedback for every action (success/failure message)

### Search Tags (data/search-tags.json)
- Reply templates should sound natural and human — avoid generic bot-like responses
- Sentiment rules are matched in order; first match wins
- The `general` category is the fallback and should not be deleted

## Pull Request Process

1. **One feature per PR** — keep changes focused and reviewable
2. **Describe what and why** — not just what changed, but why
3. **Update documentation** — if your change affects usage, update the relevant docs
4. **No sensitive data** — double-check that no cookies, tokens, or personal data are included

### PR Title Format

Use a clear, descriptive title:
- `feat: add support for scheduled thread posting`
- `fix: handle cookie expiration gracefully`
- `docs: add troubleshooting section for headless Chrome`
- `refactor: extract browser helpers into separate module`

## Reporting Issues

### Bug Reports

Include:
1. What you expected to happen
2. What actually happened
3. Steps to reproduce
4. Relevant logs from `data/activity.log`
5. Your environment (Node version, OS, Puppeteer version)

### Feature Requests

Include:
1. The problem you're trying to solve
2. Your proposed solution
3. Any alternatives you considered

## Project Structure

See [docs/developer-guide.md](docs/developer-guide.md) for detailed architecture documentation.

## Maintainers

- **[6h33t@-@-br3@dcrum](no-github)** — creator, primary maintainer

## License

By contributing, you agree that your contributions will be licensed under the GNU Affero General Public License v3.0
