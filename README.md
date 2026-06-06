# Sentry MCP Server

> Connect AI assistants to [Sentry](https://sentry.io/) — error tracking, issues, releases, events, and project management through the Model Context Protocol.

Works with **Claude Desktop**, **Cursor**, **Windsurf**, **Cline**, **Continue**, and any MCP-compatible client.

## Features

| Tool | Description |
|------|-------------|
| `list_organizations` | List all Sentry organizations you have access to |
| `list_projects` | List projects in an organization with slug, platform, and team info |
| `list_issues` | List issues with filters (environment, status, level, query, project) |
| `get_issue` | Get full details of a specific issue — title, culprit, metadata, tags |
| `list_issue_events` | List all events (occurrences) for a specific issue |
| `get_event` | Get full event details — exception, stacktrace, breadcrumbs, tags |
| `list_releases` | List releases in an organization with version, date, and authors |
| `get_release` | Get details of a specific release with commit info and file changes |
| `list_teams` | List teams in an organization with member counts and slugs |
| `list_members` | List organization members with role and email |
| `get_issue_hashes` | Get the grouping hashes (fingerprint) for an issue |
| `update_issue_status` | Resolve, ignore, or unresolve an issue (and add a comment) |

## Quick Start

### 1. Get a Sentry Auth Token

Go to **Sentry → Settings → Auth Tokens** and create a token with the scopes you need (`org:read`, `project:read`, `event:read`, `event:write`, `issue:read`, `issue:write`).

Or visit: `https://sentry.io/settings/auth-tokens/`

### 2. Configure your MCP client

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sentry": {
      "command": "npx",
      "args": ["-y", "sentry-mcp-server"],
      "env": {
        "SENTRY_AUTH_TOKEN": "sntrys_YOUR_TOKEN_HERE"
      }
    }
  }
}
```

**Cursor** — add to MCP settings (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "sentry": {
      "command": "npx",
      "args": ["-y", "sentry-mcp-server"],
      "env": {
        "SENTRY_AUTH_TOKEN": "sntrys_YOUR_TOKEN_HERE"
      }
    }
  }
}
```

### 3. Run manually (for testing)

```bash
git clone https://github.com/friendlygeorge/sentry-mcp-server.git
cd sentry-mcp-server
npm install
npm run build

# Run
SENTRY_AUTH_TOKEN=sntrys_xxx node dist/index.js
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SENTRY_AUTH_TOKEN` | ✅ | — | Your Sentry auth token (`sntrys_...`) |
| `SENTRY_BASE_URL` | ❌ | `https://sentry.io/api/0/` | Sentry API base URL. Override for self-hosted Sentry. |

### Self-hosted Sentry

If you run your own Sentry instance, set `SENTRY_BASE_URL`:

```
SENTRY_BASE_URL=https://sentry.yourcompany.com/api/0/
```

## Example Queries

> "List my Sentry organizations"

> "Show me unresolved errors in the production environment for org `acme` project `web`"

> "Get details of issue `1234567890` and show me the latest event's stack trace"

> "Resolve issue `1234567890` and add a comment that it's fixed in v1.2.3"

> "List the last 10 releases for `acme`"

> "Who are the members of `acme` org and their roles?"

## API Coverage

This server covers the most-used endpoints of the Sentry Web API:

- Organizations (`/organizations/`)
- Projects (`/organizations/{org}/projects/`)
- Issues (`/organizations/{org}/issues/`, `/issues/{id}/`)
- Events (`/issues/{id}/events/`, `/projects/{org}/{project}/events/{id}/`)
- Releases (`/organizations/{org}/releases/`)
- Teams (`/organizations/{org}/teams/`)
- Members (`/organizations/{org}/members/`)

For the full Sentry API, see [docs.sentry.io/api](https://docs.sentry.io/api/).

## License

MIT © 2026 Nova
