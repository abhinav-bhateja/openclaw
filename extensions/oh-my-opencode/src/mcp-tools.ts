import { Type } from "@sinclair/typebox";

function jsonResult(data: Record<string, unknown>): unknown {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function readStringParam(params: Record<string, unknown>, key: string, opts?: { required?: boolean; trim?: boolean }): string | undefined {
  const required = opts?.required ?? false;
  const trim = opts?.trim ?? true;
  const raw = params[key];
  if (typeof raw !== "string") {
    if (required) {
      throw new Error(`${key} required`);
    }
    return undefined;
  }
  const value = trim ? raw.trim() : raw;
  if (!value && required) {
    throw new Error(`${key} required`);
  }
  return value;
}

const ExaSearchSchema = Type.Object({
  query: Type.String(),
  numResults: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
  type: Type.Optional(Type.Union([Type.Literal("auto"), Type.Literal("article"), Type.Literal("paper"), Type.Literal("repository"), Type.Literal("post")])),
});

export function createExaSearchTool() {
  return {
    label: "WebSearch",
    name: "exa_search",
    description: "Search the web using Exa AI. Use for finding articles, documentation, blog posts, and general web content.",
    parameters: ExaSearchSchema,
    execute: async (_toolCallId: string, args: Record<string, unknown>) => {
      const params = args;
      const query = readStringParam(params, "query", { required: true });
      const numResults = typeof params.numResults === "number" ? Math.min(Math.max(params.numResults, 1), 20) : 10;
      const type = typeof params.type === "string" ? params.type : "auto";
      
      try {
        const EXA_API_KEY = process.env.EXA_API_KEY || process.env.EXA_KEY;
        if (!EXA_API_KEY) {
          return jsonResult({
            status: "error",
            error: "EXA_API_KEY not configured. Set EXA_API_KEY environment variable.",
          });
        }
        
        const response = await fetch("https://api.exa.ai/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${EXA_API_KEY}`,
          },
          body: JSON.stringify({
            query,
            numResults,
            type,
          }),
        });
        
        if (!response.ok) {
          const error = await response.text();
          return jsonResult({
            status: "error",
            error: `Exa API error: ${response.status} - ${error}`,
          });
        }
        
        const data = await response.json();
        const results = data.results || [];
        
        const formatted = results.map((r: { title?: string; url?: string; snippet?: string }) => {
          const title = r.title || "Untitled";
          const url = r.url || "#";
          const snippet = r.snippet?.substring(0, 200) || "";
          return `- [${title}](${url})\n  ${snippet}`;
        }).join("\n\n");
        
        return jsonResult({
          status: "ok",
          query,
          count: results.length,
          results: formatted || "No results found",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({
          status: "error",
          error: `Search failed: ${message}`,
        });
      }
    },
  };
}

const Context7Schema = Type.Object({
  library: Type.String(),
  topic: Type.String(),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 10 })),
});

export function createContext7Tool() {
  return {
    label: "DocsSearch",
    name: "context7_search",
    description: "Search official documentation using Context7. Best for finding library/framework documentation.",
    parameters: Context7Schema,
    execute: async (_toolCallId: string, args: Record<string, unknown>) => {
      const params = args;
      const library = readStringParam(params, "library", { required: true });
      const topic = readStringParam(params, "topic", { required: true });
      const limit = typeof params.limit === "number" ? Math.min(Math.max(params.limit, 1), 10) : 5;
      
      try {
        const response = await fetch(`https://www.context7.com/api/v1/${encodeURIComponent(library || "")}/docs?topic=${encodeURIComponent(topic || "")}&limit=${limit}`, {
          method: "GET",
          headers: {
            "Accept": "application/json",
          },
        });
        
        if (!response.ok) {
          const error = await response.text();
          return jsonResult({
            status: "error",
            error: `Context7 API error: ${response.status} - ${error}`,
          });
        }
        
        const data = await response.json();
        const results = data.docs || data.results || [];
        
        if (results.length === 0) {
          return jsonResult({
            status: "ok",
            library,
            topic,
            results: `No documentation found for "${library}" about "${topic}". Try a different library name.`,
          });
        }
        
        const formatted = results.map((r: { title?: string; content?: string; url?: string }) => {
          const title = r.title || "Documentation";
          const content = r.content?.substring(0, 500) || "";
          const url = r.url || "#";
          return `## ${title}\n\n${content}\n\n[Source](${url})`;
        }).join("\n\n---\n\n");
        
        return jsonResult({
          status: "ok",
          library,
          topic,
          count: results.length,
          results: formatted,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({
          status: "error",
          error: `Documentation search failed: ${message}`,
        });
      }
    },
  };
}

const GitHubSearchSchema = Type.Object({
  query: Type.String(),
  language: Type.Optional(Type.String()),
  maxResults: Type.Optional(Type.Number({ minimum: 1, maximum: 30 })),
});

export function createGitHubSearchTool() {
  return {
    label: "GitHubSearch",
    name: "github_search",
    description: "Search GitHub code repositories. Use for finding implementation examples, patterns, and real-world code.",
    parameters: GitHubSearchSchema,
    execute: async (_toolCallId: string, args: Record<string, unknown>) => {
      const params = args;
      const query = readStringParam(params, "query", { required: true });
      const language = readStringParam(params, "language");
      const maxResults = typeof params.maxResults === "number" ? Math.min(Math.max(params.maxResults, 1), 30) : 10;
      
      try {
        let searchQuery = query || "";
        if (language) {
          searchQuery += ` language:${language}`;
        }
        
        const response = await fetch(
          `https://api.github.com/search/code?q=${encodeURIComponent(searchQuery)}&per_page=${maxResults}`,
          {
            method: "GET",
            headers: {
              "Accept": "application/vnd.github.v3+json",
              "User-Agent": "OpenClaw/oh-my-opencode",
            },
          }
        );
        
        if (!response.ok) {
          const error = await response.text();
          if (response.status === 403) {
            return jsonResult({
              status: "error",
              error: "GitHub API rate limit exceeded. Try again later or use a GitHub token.",
            });
          }
          return jsonResult({
            status: "error",
            error: `GitHub API error: ${response.status} - ${error}`,
          });
        }
        
        const data = await response.json();
        const items = data.items || [];
        
        if (items.length === 0) {
          return jsonResult({
            status: "ok",
            query,
            results: "No code results found.",
          });
        }
        
        const formatted = items.map((item: { name?: string; path?: string; repository?: { full_name?: string }, html_url?: string, score?: number }) => {
          const repo = item.repository?.full_name || "unknown";
          const path = item.path || "";
          const url = item.html_url || "#";
          const score = item.score?.toFixed(1) || "0";
          return `- **${repo}/${path}**\n  Score: ${score}\n  [View](${url})`;
        }).join("\n");
        
        return jsonResult({
          status: "ok",
          query,
          count: items.length,
          results: formatted,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({
          status: "error",
          error: `GitHub search failed: ${message}`,
        });
      }
    },
  };
}
