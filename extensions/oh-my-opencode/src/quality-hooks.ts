const EXCESSIVE_COMMENT_PATTERNS = [
  /^\s*\/\/\s*TODO:/gm,
  /^\s*\/\/\s*NOTE:/gm,
  /^\s*\/\/\s*eslint-disable/gm,
];

const COMMENT_DENSITY_THRESHOLD = 0.3;

function analyzeCodeQuality(content: string): { hasExcessiveComments: boolean; commentDensity: number } {
  const lines = content.split("\n");
  const codeLines = lines.filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("//") && !trimmed.startsWith("/*") && !trimmed.startsWith("*");
  });
  
  const commentLines = lines.filter((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.startsWith("*/");
  });
  
  const total = codeLines.length + commentLines.length;
  const commentDensity = total > 0 ? commentLines.length / total : 0;
  
  const hasExcessiveComments = EXCESSIVE_COMMENT_PATTERNS.some((pattern) => pattern.test(content)) || commentDensity > COMMENT_DENSITY_THRESHOLD;
  
  return { hasExcessiveComments, commentDensity };
}

type Logger = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn?: (message: string) => void;
  error: (message: string) => void;
};

type OpenClawPluginApi = {
  logger?: Logger;
  registerHook: (events: string | string[], handler: (event: unknown, ctx: unknown) => unknown) => void;
};

export function registerQualityHooks(api: OpenClawPluginApi) {
  api.registerHook("after_tool_call", (event: unknown) => {
    const evt = event as { toolName?: string; params?: Record<string, unknown> };
    if (evt.toolName !== "write" && evt.toolName !== "edit") {
      return;
    }
    
    const params = evt.params || {};
    const content = typeof params.content === "string" ? params.content : 
                    typeof params.oldString === "string" ? params.oldString + (params.newString || "") : "";
    
    if (!content) {
      return;
    }
    
    const filePath = typeof params.filePath === "string" ? params.filePath : "";
    
    const { hasExcessiveComments, commentDensity } = analyzeCodeQuality(content);
    
    if (hasExcessiveComments && commentDensity > 0.2) {
      api.logger?.warn?.(`Quality Notice: Excessive comments detected in ${filePath} (density: ${(commentDensity * 100).toFixed(1)}%)`);
    }
  });
  
  api.registerHook("before_agent_start", async (event: unknown) => {
    const evt = event as { prompt?: string };
    const prompt = typeof evt.prompt === "string" ? evt.prompt : "";
    
    const hasTodoList = /^.*(\n.*)*TODO:.*$/im.test(prompt) || /^.*(\n.*)*- \[ \].*$/im.test(prompt);
    
    if (hasTodoList) {
      return {
        prependContext: `# Todo Enforcer

You have a TODO list to complete. Rules:
1. You MUST complete all items on the TODO list before finishing
2. Do NOT stop until every item is done
3. If you encounter blockers, try multiple approaches
4. Report progress on each TODO item
5. Do not give up halfway through

Your task is not complete until all TODO items are resolved.
`,
      };
    }
    
    return {};
  });
}
