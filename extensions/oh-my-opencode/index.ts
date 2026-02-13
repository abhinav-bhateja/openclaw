import { buildPersonaSystemPrompt } from "./src/personas.js";

export default function register(api: { registerHook: (events: string | string[], handler: (...args: unknown[]) => unknown) => void }) {
  api.registerHook("before_agent_start", async (event: unknown, _ctx: unknown) => {
    const evt = event as { prompt?: string };
    const label = (_ctx as { label?: string }).label;
    
    if (label) {
      const personaPrompt = buildPersonaSystemPrompt(label);
      if (personaPrompt) {
        return {
          prependContext: personaPrompt,
        };
      }
    }
    return {};
  });
}
