// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";
import {
  ComposerView,
  ConversationView,
  SavedInteraction,
  SavedShell,
  TerminalView,
  type TuiSessionState,
} from "./sessionState.ts";

const decodeShell = Schema.decodeUnknownSync(SavedShell);
const decodeInteraction = Schema.decodeUnknownSync(SavedInteraction);
const decodeConversation = Schema.decodeUnknownSync(ConversationView);
const decodeComposer = Schema.decodeUnknownSync(ComposerView);
const decodeTerminal = Schema.decodeUnknownSync(TerminalView);
const decodeThreadId = Schema.decodeUnknownSync(ThreadId);

/** Separate lock databases let SQLite release ownership even after SIGKILL. */
function claimSession(
  db: NodeSqlite.DatabaseSync,
  directory: string,
  environment: string,
  origin: string,
) {
  const lockDirectory = NodePath.join(directory, "session-locks");
  NodeFS.mkdirSync(lockDirectory, { recursive: true, mode: 0o700 });
  const lock = (id: number) => {
    const path = NodePath.join(lockDirectory, `${id}.sqlite`);
    NodeFS.closeSync(NodeFS.openSync(path, "a", 0o600));
    const connection = new NodeSqlite.DatabaseSync(path);
    try {
      connection.exec("BEGIN EXCLUSIVE");
      return connection;
    } catch (error) {
      connection.close();
      if (error instanceof Error && "errcode" in error && error.errcode === 5) return undefined;
      throw error;
    }
  };
  let ownership: NodeSqlite.DatabaseSync | undefined;
  try {
    db.exec("BEGIN IMMEDIATE");
    db.exec(`
      CREATE TABLE IF NOT EXISTS ui_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, environment TEXT NOT NULL, origin TEXT NOT NULL,
        last_used INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ui_state_v2 (
        session INTEGER NOT NULL, scope TEXT NOT NULL, field TEXT NOT NULL, value TEXT NOT NULL,
        PRIMARY KEY (session, scope, field)
      );
    `);
    const sessions = db
      .prepare(
        "SELECT id FROM ui_sessions WHERE environment = ? AND origin = ? ORDER BY last_used DESC, id DESC",
      )
      .all(environment, origin);
    let id: number | undefined;
    for (const candidate of sessions) {
      if (typeof candidate.id !== "number") continue;
      ownership = lock(candidate.id);
      if (ownership) {
        id = candidate.id;
        break;
      }
    }
    if (id === undefined) {
      id = Number(
        db
          .prepare("INSERT INTO ui_sessions (environment, origin, last_used) VALUES (?, ?, 0)")
          .run(environment, origin).lastInsertRowid,
      );
      ownership = lock(id);
      if (!ownership) throw new Error("Could not claim the new TUI session");
      // Import the pre-session format once, without duplicating its queued commands.
      if (sessions.length === 0) {
        db.prepare(
          "INSERT INTO ui_state_v2 SELECT ?, scope, field, value FROM ui_state_v1 WHERE environment = ? AND origin = ?",
        ).run(id, environment, origin);
      }
    }
    db.prepare(
      "UPDATE ui_sessions SET last_used = (SELECT COALESCE(MAX(last_used), 0) + 1 FROM ui_sessions) WHERE id = ?",
    ).run(id);
    db.exec("COMMIT");
    return { id, ownership: ownership! };
  } catch (error) {
    ownership?.close();
    if (db.isTransaction) db.exec("ROLLBACK");
    db.close();
    throw error;
  }
}

/** A separate local UI database; server conversations and credentials never enter it. */
export function openTuiSessionState(options: {
  readonly stateDirectory: string;
  readonly environmentId: EnvironmentId;
  readonly httpOrigin: string;
  readonly registry: AtomRegistry.AtomRegistry;
}): TuiSessionState {
  NodeFS.mkdirSync(options.stateDirectory, { recursive: true, mode: 0o700 });
  const path = NodePath.join(options.stateDirectory, "ui-state.sqlite");
  // Create with private permissions before SQLite opens the file or creates its journal.
  NodeFS.closeSync(NodeFS.openSync(path, "a", 0o600));
  const db = new NodeSqlite.DatabaseSync(path);
  db.exec("PRAGMA busy_timeout = 3000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
  db.exec(
    "CREATE TABLE IF NOT EXISTS ui_state_v1 (environment TEXT NOT NULL, origin TEXT NOT NULL, scope TEXT NOT NULL, field TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (environment, origin, scope, field))",
  );
  const environment = options.environmentId;
  const origin = new URL(options.httpOrigin).origin;
  const session = claimSession(db, options.stateDirectory, environment, origin);
  let closed = false;
  const error = Atom.make<string | null>(null).pipe(Atom.keepAlive);
  const report = () =>
    options.registry.set(
      error,
      "Could not save or restore TUI state. Check the state directory and available disk space.",
    );
  const rows = db
    .prepare("SELECT scope, field, value FROM ui_state_v2 WHERE session = ?")
    .all(session.id);
  const saved = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    if (
      typeof row.scope !== "string" ||
      typeof row.field !== "string" ||
      typeof row.value !== "string"
    )
      continue;
    try {
      const fields = saved.get(row.scope) ?? (Object.create(null) as Record<string, unknown>);
      fields[row.field] = JSON.parse(row.value);
      saved.set(row.scope, fields);
    } catch {
      report();
    }
  }
  const read = <T>(scope: string, decode: (value: unknown) => T): T | undefined => {
    const value = saved.get(scope);
    if (!value) return undefined;
    try {
      return decode(value);
    } catch {
      report();
      return undefined;
    }
  };
  const write = db.prepare(
    "INSERT INTO ui_state_v2 (session, scope, field, value) VALUES (?, ?, ?, ?) ON CONFLICT (session, scope, field) DO UPDATE SET value = excluded.value",
  );
  // Reference equality avoids reserializing large attachments on every draft keystroke.
  const previous = new Map<string, Record<string, unknown>>();
  const save = (scope: string, fields: Record<string, unknown>) => {
    if (closed) return;
    const prior = previous.get(scope);
    const changed = Object.entries(fields).filter(([key, value]) => !prior || prior[key] !== value);
    if (!changed.length) return;
    try {
      db.exec("BEGIN IMMEDIATE");
      for (const [field, value] of changed)
        write.run(session.id, scope, field, JSON.stringify(value));
      db.exec("COMMIT");
      previous.set(scope, fields);
      saved.set(scope, fields);
    } catch {
      if (db.isTransaction) db.exec("ROLLBACK");
      report();
    }
  };
  const shell = read("shell", decodeShell);
  const interactions = new Map<ThreadId, SavedInteraction>();
  for (const scope of saved.keys()) {
    if (!scope.startsWith("interaction:")) continue;
    try {
      const id = decodeThreadId(scope.slice("interaction:".length));
      const state = read(scope, decodeInteraction);
      if (
        state &&
        state.queue.every((entry) => entry.command.threadId === id) &&
        (!state.attempt || state.attempt.threadId === id)
      )
        interactions.set(id, state);
    } catch {
      report();
    }
  }
  return {
    error,
    shell: shell ? { ...shell, modal: null } : undefined,
    interactions,
    saveShell: ({ route, sidebarView, projectId, threadId }) =>
      save("shell", { route, sidebarView: sidebarView ?? "projects", projectId, threadId }),
    saveInteraction: (
      id,
      {
        draft,
        pastes,
        attachments,
        skill,
        queue,
        attempt,
        attemptDraft,
        runtimeMode = null,
        interactionMode = null,
      },
    ) => {
      const state = {
        draft,
        pastes,
        attachments,
        skill,
        queue,
        attempt,
        attemptDraft,
        runtimeMode,
        interactionMode,
      };
      interactions.set(id, state);
      save(`interaction:${id}`, state);
    },
    conversation: (id) => read(`conversation:${id}`, decodeConversation),
    saveConversation: (id, view) => save(`conversation:${id}`, view),
    composer: (id) => read(`composer:${id}`, decodeComposer),
    saveComposer: (id, view) => save(`composer:${id}`, view),
    terminal: (id) => read(`terminal:${id}`, decodeTerminal),
    saveTerminal: (id, view) => save(`terminal:${id}`, view),
    close: () => {
      if (closed) return;
      closed = true;
      try {
        db.close();
      } finally {
        session.ownership.close();
      }
    },
  };
}
