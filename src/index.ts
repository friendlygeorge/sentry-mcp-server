#!/usr/bin/env node
/**
 * Sentry MCP Server
 *
 * Connect AI assistants to Sentry's error tracking API.
 * Query organizations, projects, issues, events, releases, teams, and members.
 * Resolve/ignore/unresolve issues programmatically.
 *
 * Works with Claude Desktop, Cursor, Windsurf, Cline, and any MCP client.
 *
 * Auth: Bearer token from Sentry → Settings → Auth Tokens.
 * Docs: https://docs.sentry.io/api/
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// --- Configuration & Startup Validation ---

const SENTRY_AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN || "";
const SENTRY_BASE_URL = (process.env.SENTRY_BASE_URL || "https://sentry.io/api/0/").replace(/\/?$/, "/");

if (!SENTRY_AUTH_TOKEN) {
  console.error("Error: SENTRY_AUTH_TOKEN environment variable is required.");
  console.error("Get a token at: https://sentry.io/settings/auth-tokens/");
  process.exit(1);
}

if (!SENTRY_BASE_URL.startsWith("http")) {
  console.error("Error: SENTRY_BASE_URL must start with http:// or https://");
  process.exit(1);
}

console.error(`[sentry-mcp] Starting. Base URL: ${SENTRY_BASE_URL}`);

// --- API Helper ---

async function sentryFetch(
  path: string,
  options: RequestInit = {}
): Promise<any> {
  const url = `${SENTRY_BASE_URL}${path.replace(/^\//, "")}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${SENTRY_AUTH_TOKEN}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };

  const res = await fetch(url, { ...options, headers });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Sentry API error ${res.status} ${res.statusText} on ${path}: ${body.slice(0, 300)}`
    );
  }

  // 204 No Content
  if (res.status === 204) return null;

  // Some PUT endpoints return the updated issue
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

function toJSON(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

// --- Server ---

const server = new McpServer({
  name: "sentry",
  version: "1.0.0",
});

// ── Tool: list_organizations ──
server.tool(
  "list_organizations",
  "List all Sentry organizations the authenticated user has access to. Returns id, slug, name, and status for each organization.",
  {
    cursor: z
      .string()
      .optional()
      .describe("Pagination cursor from a previous response's 'next' link. Omit for first page."),
  },
  async ({ cursor }) => {
    try {
      const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const data = await sentryFetch(`organizations/${qs}`);
      return { content: [{ type: "text" as const, text: toJSON(data) }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
    }
  }
);

// ── Tool: list_projects ──
server.tool(
  "list_projects",
  "List all projects in a Sentry organization. Returns project slug, name, platform, id, and team assignments.",
  {
    org: z
      .string()
      .describe("Organization slug (the part after 'sentry.io/' in the URL, e.g. 'acme')"),
    cursor: z
      .string()
      .optional()
      .describe("Pagination cursor from a previous response. Omit for first page."),
  },
  async ({ org, cursor }) => {
    try {
      const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const data = await sentryFetch(`organizations/${encodeURIComponent(org)}/projects/${qs}`);
      return { content: [{ type: "text" as const, text: toJSON(data) }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
    }
  }
);

// ── Tool: list_issues ──
server.tool(
  "list_issues",
  "List issues in an organization with optional filters. An issue is a unique error grouped by fingerprint. Returns id, title, level, status, lastSeen, firstSeen, count, and project info.",
  {
    org: z
      .string()
      .describe("Organization slug (e.g. 'acme')"),
    project: z
      .number()
      .optional()
      .describe("Restrict to a single project ID. Get IDs from list_projects."),
    environment: z
      .string()
      .optional()
      .describe("Filter by environment name (e.g. 'production', 'staging')"),
    status: z
      .enum(["resolved", "unresolved", "ignored", "muted"])
      .optional()
      .describe("Filter by issue status"),
    level: z
      .enum(["debug", "info", "warning", "error", "fatal"])
      .optional()
      .describe("Minimum issue severity level"),
    query: z
      .string()
      .optional()
      .describe("Sentry search query (e.g. 'is:unresolved browser.name:Chrome')"),
    sort: z
      .enum(["date", "new", "priority", "freq", "user", "trends"])
      .optional()
      .describe("Sort order (default 'date')"),
    limit: z
      .number()
      .optional()
      .default(25)
      .describe("Maximum issues to return (default 25)"),
    cursor: z
      .string()
      .optional()
      .describe("Pagination cursor. Omit for first page."),
  },
  async ({ org, project, environment, status, level, query, sort, limit, cursor }) => {
    try {
      const params = new URLSearchParams();
      if (project != null) params.set("project", String(project));
      if (environment) params.set("environment", environment);
      if (status) params.set("status", status);
      if (level) params.set("level", level);
      if (query) params.set("query", query);
      if (sort) params.set("sort", sort);
      if (limit != null) params.set("limit", String(limit));
      if (cursor) params.set("cursor", cursor);
      const qs = params.toString() ? `?${params.toString()}` : "";
      const data = await sentryFetch(`organizations/${encodeURIComponent(org)}/issues/${qs}`);
      return { content: [{ type: "text" as const, text: toJSON(data) }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
    }
  }
);

// ── Tool: get_issue ──
server.tool(
  "get_issue",
  "Get full details of a specific issue by numeric ID, including title, culprit, metadata, tags, firstSeen, lastSeen, count, and project info.",
  {
    issue_id: z
      .string()
      .describe("Numeric issue ID (e.g. '1234567890'). Get these from list_issues."),
  },
  async ({ issue_id }) => {
    try {
      const data = await sentryFetch(`issues/${encodeURIComponent(issue_id)}/`);
      return { content: [{ type: "text" as const, text: toJSON(data) }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
    }
  }
);

// ── Tool: list_issue_events ──
server.tool(
  "list_issue_events",
  "List all events (individual occurrences) for a specific issue. Returns event id, message, platform, dateCreated, and tags. Use to find the most recent occurrence.",
  {
    issue_id: z
      .string()
      .describe("Numeric issue ID"),
    cursor: z
      .string()
      .optional()
      .describe("Pagination cursor. Omit for first page."),
  },
  async ({ issue_id, cursor }) => {
    try {
      const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const data = await sentryFetch(`issues/${encodeURIComponent(issue_id)}/events/${qs}`);
      return { content: [{ type: "text" as const, text: toJSON(data) }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
    }
  }
);

// ── Tool: get_event ──
server.tool(
  "get_event",
  "Get full details of a specific event by its ID, including exception values, stack trace, breadcrumbs, tags, and request context. Use this to debug a specific occurrence.",
  {
    org: z
      .string()
      .describe("Organization slug (e.g. 'acme')"),
    project: z
      .string()
      .describe("Project slug (e.g. 'web-frontend'). Get these from list_projects."),
    event_id: z
      .string()
      .describe("Event ID (hex string). Get these from list_issue_events."),
  },
  async ({ org, project, event_id }) => {
    try {
      const data = await sentryFetch(
        `projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}/events/${encodeURIComponent(event_id)}/`
      );
      return { content: [{ type: "text" as const, text: toJSON(data) }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
    }
  }
);

// ── Tool: list_releases ──
server.tool(
  "list_releases",
  "List releases in a Sentry organization. Returns version, name, dateReleased, dateCreated, newGroups, and authors for each release.",
  {
    org: z
      .string()
      .describe("Organization slug (e.g. 'acme')"),
    query: z
      .string()
      .optional()
      .describe("Search query (e.g. 'v1.' to find all 1.x releases)"),
    limit: z
      .number()
      .optional()
      .default(25)
      .describe("Maximum releases to return (default 25)"),
    cursor: z
      .string()
      .optional()
      .describe("Pagination cursor. Omit for first page."),
  },
  async ({ org, query, limit, cursor }) => {
    try {
      const params = new URLSearchParams();
      if (query) params.set("query", query);
      if (limit != null) params.set("limit", String(limit));
      if (cursor) params.set("cursor", cursor);
      const qs = params.toString() ? `?${params.toString()}` : "";
      const data = await sentryFetch(`organizations/${encodeURIComponent(org)}/releases/${qs}`);
      return { content: [{ type: "text" as const, text: toJSON(data) }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
    }
  }
);

// ── Tool: get_release ──
server.tool(
  "get_release",
  "Get details of a specific release by version, including commit info, last commit, first/last event, deploy count, new issues, and associated projects.",
  {
    org: z
      .string()
      .describe("Organization slug (e.g. 'acme')"),
    version: z
      .string()
      .describe("Release version (e.g. '1.2.3' or 'v1.2.3'). Get these from list_releases."),
  },
  async ({ org, version }) => {
    try {
      const data = await sentryFetch(
        `organizations/${encodeURIComponent(org)}/releases/${encodeURIComponent(version)}/`
      );
      return { content: [{ type: "text" as const, text: toJSON(data) }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
    }
  }
);

// ── Tool: list_teams ──
server.tool(
  "list_teams",
  "List teams in a Sentry organization. Returns team id, slug, name, memberCount, and isMember.",
  {
    org: z
      .string()
      .describe("Organization slug (e.g. 'acme')"),
    cursor: z
      .string()
      .optional()
      .describe("Pagination cursor. Omit for first page."),
  },
  async ({ org, cursor }) => {
    try {
      const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const data = await sentryFetch(`organizations/${encodeURIComponent(org)}/teams/${qs}`);
      return { content: [{ type: "text" as const, text: toJSON(data) }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
    }
  }
);

// ── Tool: list_members ──
server.tool(
  "list_members",
  "List members of a Sentry organization. Returns user id, email, name, role, and org role info.",
  {
    org: z
      .string()
      .describe("Organization slug (e.g. 'acme')"),
    cursor: z
      .string()
      .optional()
      .describe("Pagination cursor. Omit for first page."),
  },
  async ({ org, cursor }) => {
    try {
      const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const data = await sentryFetch(`organizations/${encodeURIComponent(org)}/members/${qs}`);
      return { content: [{ type: "text" as const, text: toJSON(data) }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
    }
  }
);

// ── Tool: get_issue_hashes ──
server.tool(
  "get_issue_hashes",
  "Get the grouping hashes (fingerprint) for a specific issue. Useful to identify why issues are grouped together or to deduplicate across projects.",
  {
    issue_id: z
      .string()
      .describe("Numeric issue ID"),
  },
  async ({ issue_id }) => {
    try {
      const data = await sentryFetch(`issues/${encodeURIComponent(issue_id)}/hashes/`);
      return { content: [{ type: "text" as const, text: toJSON(data) }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
    }
  }
);

// ── Tool: update_issue_status ──
server.tool(
  "update_issue_status",
  "Change the status of a Sentry issue — resolve it, mark it unresolved, ignore it, or set a resolution in the next release. Optionally attach a comment.",
  {
    issue_id: z
      .string()
      .describe("Numeric issue ID"),
    status: z
      .enum(["resolved", "unresolved", "ignored", "resolvedInNextRelease"])
      .describe("New status. 'resolved' closes the issue; 'unresolved' reopens it; 'ignored' suppresses it; 'resolvedInNextRelease' auto-resolves on next deploy."),
    comment: z
      .string()
      .optional()
      .describe("Optional comment to add to the issue activity feed along with the status change"),
  },
  async ({ issue_id, status, comment }) => {
    try {
      const body: Record<string, any> = { status };
      if (comment) body.comment = comment;
      const data = await sentryFetch(`issues/${encodeURIComponent(issue_id)}/`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      return { content: [{ type: "text" as const, text: toJSON(data) }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }] };
    }
  }
);

// --- Start server ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[sentry-mcp] Connected via stdio. Ready for tool calls.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
