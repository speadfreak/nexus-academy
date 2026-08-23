// GitHub integration — connection verification.
//
// The Freebuff platform manages git itself (git commands are blocked inside
// the sandbox), so the code push/sync is configured from the project's
// Integrations tab. What this module adds is a live check that the
// GITHUB_TOKEN key is valid and which account/repos it can see — surfaced on
// the admin System tab so "is GitHub actually connected?" has a real answer
// instead of just a "configured: true" env-flag.
//
// Required key (paste into the Keys / API keys tab, never hardcode):
//   GITHUB_TOKEN — personal access token with `repo` scope (classic) or
//   fine-grained with read/write Contents on the connected repo.

"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAdminAction } from "./admin";

export interface GithubConnectionStatus {
  configured: boolean;
  valid: boolean;
  login: string | null;
  repos: { fullName: string; private: boolean; pushedAt: string | null }[];
  error: string | null;
}

const GITHUB_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

/**
 * Verify the configured GITHUB_TOKEN: fetch the authenticated user, then the
 * repos the token can see (most recently pushed). Admin-only. Returns a
 * structured status — never throws on a bad token, so the UI can show why.
 */
export const verifyGithubConnection = action({
  args: {},
  handler: async (ctx): Promise<GithubConnectionStatus> => {
    await requireAdminAction(ctx);

    const token = await ctx.runQuery(internal.configKeys.resolveConfigValue, { key: "GITHUB_TOKEN" });
    if (!token) {
      return {
        configured: false,
        valid: false,
        login: null,
        repos: [],
        error: "GITHUB_TOKEN is not set. Add it in the Keys / API keys tab.",
      };
    }
    const headers = { ...GITHUB_HEADERS, Authorization: `Bearer ${token}` };

    try {
      const userResponse = await fetch("https://api.github.com/user", { headers });
      if (userResponse.status === 401 || userResponse.status === 403) {
        return {
          configured: true,
          valid: false,
          login: null,
          repos: [],
          error: `GitHub rejected the token (HTTP ${userResponse.status}) — check the token's scope and that it hasn't been revoked.`,
        };
      }
      if (!userResponse.ok) {
        return {
          configured: true,
          valid: false,
          login: null,
          repos: [],
          error: `GitHub API error (HTTP ${userResponse.status}).`,
        };
      }
      const user = (await userResponse.json()) as { login?: string };

      const reposResponse = await fetch(
        "https://api.github.com/user/repos?sort=pushed&per_page=5",
        { headers },
      );
      const repos = reposResponse.ok
        ? ((await reposResponse.json()) as {
            full_name?: string;
            private?: boolean;
            pushed_at?: string | null;
          }[])
            .map((repo) => ({
              fullName: repo.full_name ?? "unknown",
              private: repo.private ?? false,
              pushedAt: repo.pushed_at ?? null,
            }))
        : [];

      return {
        configured: true,
        valid: true,
        login: user.login ?? null,
        repos,
        error: null,
      };
    } catch (error) {
      return {
        configured: true,
        valid: false,
        login: null,
        repos: [],
        error: error instanceof Error ? error.message : "Could not reach the GitHub API.",
      };
    }
  },
});
