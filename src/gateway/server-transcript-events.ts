import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../config/config.js";
import { onSessionTranscriptUpdate } from "../sessions/transcript-events.js";
import { loadCombinedSessionStoreForGateway } from "./session-utils.js";

type BroadcastFn = (
  event: string,
  payload: unknown,
  opts?: { dropIfSlow?: boolean },
) => void;

type Logger = { warn: (msg: string) => void };

type CacheEntry = { value: string; ts: number };

const HEADER_READ_BYTES = 8 * 1024;
const CACHE_TTL_MS = 10 * 60_000;

function readSessionIdFromTranscript(sessionFile: string): string | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(sessionFile, "r");
    const buffer = Buffer.alloc(HEADER_READ_BYTES);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    if (bytesRead <= 0) {
      return null;
    }
    const chunk = buffer.toString("utf-8", 0, bytesRead);
    const lines = chunk.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const parsed = JSON.parse(trimmed) as { type?: unknown; id?: unknown };
        if (parsed?.type !== "session") {
          continue;
        }
        const id = typeof parsed.id === "string" ? parsed.id.trim() : "";
        if (id) {
          return id;
        }
      } catch {
        return null;
      }
    }
  } catch {
    return null;
  } finally {
    if (fd != null) {
      fs.closeSync(fd);
    }
  }
  return null;
}

function getCached(map: Map<string, CacheEntry>, key: string): string | null {
  const entry = map.get(key);
  if (!entry) {
    return null;
  }
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    map.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(map: Map<string, CacheEntry>, key: string, value: string) {
  map.set(key, { value, ts: Date.now() });
}

function resolveSessionKeyForSessionId(sessionId: string): string | null {
  const cfg = loadConfig();
  const { store } = loadCombinedSessionStoreForGateway(cfg);
  for (const [key, entry] of Object.entries(store)) {
    const entrySessionId = typeof entry?.sessionId === "string" ? entry.sessionId.trim() : "";
    if (entrySessionId && entrySessionId === sessionId) {
      return key;
    }
  }
  return null;
}

export function attachGatewayTranscriptChatBridge(params: {
  broadcast: BroadcastFn;
  log?: Logger;
}): () => void {
  const sessionKeyByFile = new Map<string, CacheEntry>();
  const sessionIdByFile = new Map<string, CacheEntry>();
  const sessionKeyById = new Map<string, CacheEntry>();

  const handleUpdate = (sessionFile: string) => {
    const cachedKey = getCached(sessionKeyByFile, sessionFile);
    if (cachedKey) {
      params.broadcast(
        "chat",
        {
          runId: `transcript-${randomUUID()}`,
          sessionKey: cachedKey,
          state: "final",
        },
        { dropIfSlow: true },
      );
      return;
    }

    let sessionId = getCached(sessionIdByFile, sessionFile);
    if (!sessionId) {
      sessionId = readSessionIdFromTranscript(sessionFile);
      if (!sessionId) {
        return;
      }
      setCached(sessionIdByFile, sessionFile, sessionId);
    }

    let sessionKey = getCached(sessionKeyById, sessionId);
    if (!sessionKey) {
      sessionKey = resolveSessionKeyForSessionId(sessionId);
      if (!sessionKey) {
        params.log?.warn(`transcript update ignored; session key not found (${sessionId})`);
        return;
      }
      setCached(sessionKeyById, sessionId, sessionKey);
    }

    setCached(sessionKeyByFile, sessionFile, sessionKey);
    params.broadcast(
      "chat",
      {
        runId: `transcript-${sessionId}-${randomUUID()}`,
        sessionKey,
        state: "final",
      },
      { dropIfSlow: true },
    );
  };

  const unsubscribe = onSessionTranscriptUpdate((update) => {
    const sessionFile = update.sessionFile?.trim();
    if (!sessionFile) {
      return;
    }
    try {
      handleUpdate(sessionFile);
    } catch {
      params.log?.warn(`failed to handle transcript update (${sessionFile})`);
    }
  });

  return () => {
    unsubscribe();
  };
}
