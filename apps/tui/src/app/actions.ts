/**
 * Every keyboard action in the TUI, defined once. Handlers bind to these ids, and the hotkey bar,
 * help, and palette all render from this table, so a key can never be documented differently from
 * what it does. Ids match `packages/contracts/src/keybindings.ts` where the command already exists.
 */

export const ACTION_SCOPES = {
  /** Reachable from every layer, including modal overlays. */
  app: { level: 0, title: "Everywhere" },
  /** Reachable whenever no overlay is open. */
  workspace: { level: 1, title: "Workspace" },
  navigation: { level: 2, title: "Threads" },
  conversation: { level: 3, title: "Conversation" },
  history: { level: 4, title: "Conversation" },
  composer: { level: 4, title: "Message" },
  agents: { level: 4, title: "Agents" },
  approval: { level: 4, title: "Approval" },
  question: { level: 4, title: "Question" },
  shell: { level: 4, title: "Shell controls" },
  find: { level: 5, title: "Find in thread" },
  listFilter: { level: 5, title: "Filter" },
  menu: { level: 5, title: "Menu" },
  agentOutput: { level: 6, title: "Agent output" },
  linkMenu: { level: 7, title: "Link menu" },
  palette: { level: 10, title: "Command palette" },
  help: { level: 10, title: "Help" },
  diff: { level: 10, title: "Diff" },
  restore: { level: 10, title: "Restore" },
  pullRequest: { level: 10, title: "Pull request" },
  favorites: { level: 10, title: "Favorite models" },
  theme: { level: 10, title: "Theme" },
  manage: { level: 10, title: "Manage thread" },
  rename: { level: 10, title: "Rename thread" },
  contextMenu: { level: 11, title: "Menu" },
  newThread: { level: 10, title: "New thread" },
  newProject: { level: 10, title: "New project" },
  quit: { level: 20, title: "Close T3 TUI" },
  terminalFocus: { level: 30, title: "Terminal" },
} as const;

export type ActionScope = keyof typeof ACTION_SCOPES;

export interface ActionDefinition {
  readonly scope: ActionScope;
  readonly title: string;
  /** Lowercase chords such as "ctrl+k", "shift+a", "?", "up", or "return". Empty means palette only. */
  readonly keys: readonly string[];
  /** Shown instead of the first key when one label reads better, such as "↑↓". */
  readonly keyLabel?: string;
  /** Hotkey bar priority, higher first. Omitted actions appear only in help and the palette. */
  readonly hint?: number;
  /** Hotkey bar label when shorter than the title. */
  readonly label?: string;
  /** Movement and scrolling repeat when held; everything else fires once per press. */
  readonly repeat?: boolean;
  /** False for actions that only make sense from their key, such as moving a list cursor. */
  readonly palette?: boolean;
  readonly keywords?: string;
  /** A deliberate shadow: this higher-scope action takes the key while its scope has focus. */
  readonly yieldsTo?: readonly string[];
}

const step = { repeat: true, palette: false } as const;
const keyOnly = { palette: false } as const;

export const ACTIONS = {
  // Everywhere.
  "commandPalette.toggle": {
    scope: "app",
    title: "Search and commands",
    keys: ["ctrl+k"],
    label: "Search",
    hint: 100,
    keywords: "palette find search",
    ...keyOnly,
  },
  "help.toggle": {
    scope: "app",
    title: "Keyboard help",
    keys: ["?", "f1"],
    label: "Help",
    hint: 100,
    keywords: "shortcuts hotkeys keys",
  },
  "sounds.toggle": {
    scope: "app",
    title: "Toggle notification sounds",
    keys: ["ctrl+g"],
    label: "Sounds",
    hint: 55,
    keywords: "audio mute unmute alerts approval finished",
  },
  "app.quit": {
    scope: "app",
    title: "Close T3 TUI",
    keys: ["ctrl+c"],
    keywords: "quit exit",
  },
  "theme.select": {
    scope: "app",
    title: "Choose theme",
    keys: [],
    keywords: "appearance dark light color auto",
  },
  "favorites.open": {
    scope: "app",
    title: "Favorite models",
    keys: [],
    keywords: "star pin provider rank",
  },

  // Workspace: available from the sidebar and the transcript.
  "chat.new": {
    scope: "workspace",
    title: "New thread",
    keys: ["n"],
    hint: 70,
    keywords: "conversation task worktree",
  },
  "project.new": {
    scope: "workspace",
    title: "New project",
    keys: ["p"],
    hint: 60,
    keywords: "add workspace local folder github clone",
    yieldsTo: ["history.paste"],
  },
  "thread.manage": {
    scope: "workspace",
    title: "Manage thread",
    keys: ["m"],
    label: "Manage",
    hint: 50,
    keywords: "rename archive delete restore",
  },
  "diff.toggle": {
    scope: "workspace",
    title: "View thread changes",
    keys: ["d"],
    label: "Diff",
    hint: 45,
    keywords: "files additions deletions review",
  },
  "pullRequest.open": {
    scope: "workspace",
    title: "Open pull request",
    keys: ["o"],
    label: "Open PR",
    hint: 40,
    keywords: "pr branch github gitlab browser",
    yieldsTo: ["history.openLink"],
  },
  "checkpoint.restore": {
    scope: "workspace",
    title: "Edit from checkpoint",
    keys: ["e"],
    label: "Rewind",
    hint: 35,
    keywords: "restore rewind revert undo",
  },
  "sidebar.showArchived": {
    scope: "workspace",
    title: "Show archived threads",
    keys: ["shift+a"],
    keyLabel: "⇧A",
    label: "Archived",
    hint: 15,
    keywords: "restore history",
  },
  "sidebar.toggle": {
    scope: "workspace",
    title: "Cycle sidebar: projects, recent, archived",
    keys: ["ctrl+b"],
    label: "View",
    hint: 20,
    keywords: "view navigation",
  },
  "sidebar.toggleSubagents": {
    scope: "workspace",
    title: "Show or hide subagents in the sidebar",
    keys: ["ctrl+s"],
    label: "Subagents",
    hint: 10,
    keywords: "child threads visibility",
  },
  "connection.retry": {
    scope: "workspace",
    title: "Reconnect",
    keys: ["r"],
    hint: 5,
    keywords: "retry refresh sync",
  },

  // Sidebar.
  "list.up": {
    scope: "navigation",
    title: "Previous row",
    keys: ["up", "k"],
    keyLabel: "↑↓",
    label: "Select",
    hint: 90,
    ...step,
  },
  "list.down": { scope: "navigation", title: "Next row", keys: ["down", "j"], ...step },
  "list.next": { scope: "navigation", title: "Next row, wrapping", keys: ["tab"], ...step },
  "list.previous": {
    scope: "navigation",
    title: "Previous row, wrapping",
    keys: ["shift+tab"],
    ...step,
  },
  "list.open": {
    scope: "navigation",
    title: "Open selection",
    keys: ["return"],
    label: "Open",
    hint: 85,
    ...keyOnly,
  },
  "list.back": {
    scope: "navigation",
    title: "Back to projects",
    keys: ["escape", "backspace"],
    label: "Back",
    hint: 80,
    ...keyOnly,
  },
  "list.filter": {
    scope: "navigation",
    title: "Filter this list",
    keys: ["/"],
    label: "Filter",
    hint: 75,
    keywords: "search projects threads",
  },
  "project.toggleExpanded": {
    scope: "navigation",
    title: "Expand or collapse project",
    keys: ["space"],
    label: "Expand",
    hint: 74,
    keywords: "tree fold",
  },
  "sidebar.previousView": {
    scope: "navigation",
    title: "Previous sidebar view",
    keys: ["left"],
    keyLabel: "←→",
    label: "View",
    hint: 65,
    ...keyOnly,
  },
  "sidebar.nextView": {
    scope: "navigation",
    title: "Next sidebar view",
    keys: ["right"],
    ...keyOnly,
  },

  // An open thread, whichever region has focus.
  "terminal.toggle": {
    scope: "conversation",
    title: "Open thread shell",
    keys: ["ctrl+t"],
    label: "Terminal",
    hint: 95,
    keywords: "console pty",
  },
  "thread.stop": {
    scope: "conversation",
    title: "Stop the running turn",
    keys: ["ctrl+x"],
    label: "Stop",
    hint: 92,
    keywords: "cancel interrupt pause",
  },
  "thread.steerQueuedMessage": {
    scope: "conversation",
    title: "Send the queued message now",
    keys: ["ctrl+y"],
    label: "Send now",
    hint: 91,
    keywords: "queue steer",
  },
  "thread.editQueuedMessage": {
    scope: "conversation",
    title: "Edit the queued message",
    keys: ["ctrl+u"],
    label: "Edit queued",
    hint: 90,
    keywords: "queue",
  },
  "view.toggleMarkdown": {
    scope: "conversation",
    title: "Toggle rendered Markdown and raw source",
    keys: ["ctrl+r"],
    label: "Raw Markdown",
    hint: 30,
    keywords: "render source",
  },
  "composer.togglePastes": {
    scope: "conversation",
    title: "Show or hide pasted text",
    keys: ["ctrl+p"],
    label: "Pastes",
    hint: 60,
    keywords: "paste preview",
  },

  // Transcript.
  "composer.focus": {
    scope: "history",
    title: "Write a message",
    keys: ["return", "i"],
    keyLabel: "Enter",
    label: "Write",
    hint: 94,
    ...keyOnly,
  },
  "history.back": {
    scope: "history",
    title: "Back to threads",
    keys: ["escape", "left", "backspace"],
    keyLabel: "Esc",
    label: "Threads",
    hint: 88,
    ...keyOnly,
  },
  "history.nextRegion": {
    scope: "history",
    title: "Move to the next region",
    keys: ["tab"],
    label: "Agents",
    hint: 86,
    ...keyOnly,
  },
  "history.previousRegion": {
    scope: "history",
    title: "Move to the sidebar",
    keys: ["shift+tab"],
    ...keyOnly,
  },
  "thread.find": {
    scope: "history",
    title: "Find in thread",
    keys: ["/"],
    label: "Find",
    hint: 84,
    keywords: "search text",
  },
  "history.scrollUp": { scope: "history", title: "Scroll up", keys: ["up"], ...step },
  "history.scrollDown": { scope: "history", title: "Scroll down", keys: ["down"], ...step },
  "history.pageUp": { scope: "history", title: "Page up", keys: ["pageup"], ...step },
  "history.pageDown": { scope: "history", title: "Page down", keys: ["pagedown"], ...step },
  "history.top": { scope: "history", title: "Jump to the first message", keys: ["home"] },
  "history.live": {
    scope: "history",
    title: "Jump to live output",
    keys: ["end"],
    label: "Live",
    hint: 96,
    keywords: "follow bottom latest",
  },
  "thread.toggleDetails": {
    scope: "history",
    title: "Show or hide tool details",
    keys: ["t"],
    label: "Details",
    hint: 64,
    keywords: "tools activity",
  },
  "thread.openRequests": {
    scope: "history",
    title: "Respond to agent requests",
    keys: ["a"],
    label: "Respond",
    hint: 93,
    keywords: "approval question",
  },
  "thread.openParent": {
    scope: "history",
    title: "Go to the parent thread",
    keys: ["u"],
    label: "Parent",
    hint: 89,
    keywords: "subagent lineage",
  },
  "history.vimMove": {
    scope: "history",
    title: "Move the text cursor",
    keys: ["h", "j", "k", "l"],
    keyLabel: "hjkl",
    label: "Cursor",
    hint: 28,
    ...step,
  },
  "history.vimWord": {
    scope: "history",
    title: "Move by word",
    keys: ["w", "b"],
    keyLabel: "w/b",
    ...step,
  },
  "history.vimLineEdge": {
    scope: "history",
    title: "Move to line edges",
    keys: ["0", "$"],
    keyLabel: "0/$",
    ...keyOnly,
  },
  "history.vimEnds": {
    scope: "history",
    title: "Move to the first or last line",
    keys: ["g", "shift+g"],
    keyLabel: "gg/G",
    ...keyOnly,
  },
  "history.vimPage": {
    scope: "history",
    title: "Move half a page or a page",
    keys: ["ctrl+d", "ctrl+f"],
    keyLabel: "Ctrl+D/F",
    ...step,
  },
  "history.select": {
    scope: "history",
    title: "Select text or lines",
    keys: ["v", "shift+v"],
    keyLabel: "v/V",
    label: "Select",
    hint: 27,
    ...keyOnly,
  },
  "history.yank": {
    scope: "history",
    title: "Copy the selection",
    keys: ["y"],
    keyLabel: "y/yy",
    label: "Yank",
    hint: 71,
    ...keyOnly,
  },
  "history.paste": {
    scope: "history",
    title: "Paste the copied text into the message",
    keys: ["p"],
    label: "Paste",
    hint: 25,
    ...keyOnly,
  },
  "history.openLink": {
    scope: "history",
    title: "Open the selected link",
    keys: ["o"],
    label: "Open link",
    hint: 24,
    ...keyOnly,
  },

  // Composer.
  "composer.send": {
    scope: "composer",
    title: "Send the message",
    keys: ["return"],
    label: "Send",
    hint: 99,
    ...keyOnly,
  },
  "composer.newline": {
    scope: "composer",
    title: "Insert a new line",
    keys: ["shift+return", "ctrl+j"],
    keyLabel: "Shift+Enter",
    label: "New line",
    hint: 70,
    ...keyOnly,
  },
  "composer.skills": {
    scope: "composer",
    title: "Search skills",
    keys: ["/"],
    label: "Skills",
    hint: 68,
    ...keyOnly,
  },
  "composer.blur": {
    scope: "composer",
    title: "Back to the transcript",
    keys: ["escape"],
    label: "History",
    hint: 88,
    ...keyOnly,
  },
  "composer.nextControl": {
    scope: "composer",
    title: "Next composer control",
    keys: ["tab"],
    label: "Options",
    hint: 72,
    ...keyOnly,
  },
  "composer.previousControl": {
    scope: "composer",
    title: "Previous composer control",
    keys: ["shift+tab"],
    ...keyOnly,
  },
  "composer.activateControl": {
    scope: "composer",
    title: "Activate the selected control",
    keys: ["return", "space"],
    ...keyOnly,
    yieldsTo: ["composer.send"],
  },
  "composer.chooseReply": {
    scope: "composer",
    title: "Choose a suggested reply",
    keys: ["up", "down", "left", "right"],
    keyLabel: "↑↓",
    label: "Choose reply",
    hint: 89,
    ...keyOnly,
  },
  "composer.recallPrompt": {
    scope: "composer",
    title: "Recall earlier prompts",
    keys: ["up", "down"],
    keyLabel: "↑↓",
    ...keyOnly,
    yieldsTo: ["composer.chooseReply"],
  },
  "composer.editPastes": {
    scope: "composer",
    title: "Insert pasted text into the message",
    keys: ["ctrl+o"],
    label: "Edit pastes",
    hint: 59,
    ...keyOnly,
  },
  "composer.scrollPastes": {
    scope: "composer",
    title: "Scroll pasted text",
    keys: ["pageup", "pagedown"],
    keyLabel: "PgUp/Dn",
    ...step,
  },
  "composer.removeAttachment": {
    scope: "composer",
    title: "Remove the last attachment",
    keys: ["ctrl+backspace"],
    label: "Remove attachment",
    hint: 58,
    ...keyOnly,
  },

  // Composer menus.
  "menu.up": {
    scope: "menu",
    title: "Previous item",
    keys: ["up"],
    keyLabel: "↑↓",
    label: "Select",
    hint: 90,
    ...step,
  },
  "menu.down": { scope: "menu", title: "Next item", keys: ["down"], ...step },
  "menu.choose": {
    scope: "menu",
    title: "Choose the selected item",
    keys: ["return", "tab"],
    keyLabel: "Enter/Tab",
    label: "Choose",
    hint: 89,
    ...keyOnly,
  },
  "menu.close": {
    scope: "menu",
    title: "Close the menu",
    keys: ["escape", "shift+tab"],
    keyLabel: "Esc",
    label: "Close",
    hint: 88,
    ...keyOnly,
  },

  // Find in thread.
  "find.next": {
    scope: "find",
    title: "Next match",
    keys: ["return", "down"],
    keyLabel: "Enter",
    label: "Next",
    hint: 90,
    ...step,
  },
  "find.previous": {
    scope: "find",
    title: "Previous match",
    keys: ["shift+return", "up"],
    keyLabel: "⇧Enter",
    label: "Previous",
    hint: 89,
    ...step,
  },
  "find.close": {
    scope: "find",
    title: "Close find",
    keys: ["escape"],
    label: "Close",
    hint: 88,
    ...keyOnly,
  },

  // Sidebar filter.
  "listFilter.up": {
    scope: "listFilter",
    title: "Previous match",
    keys: ["up"],
    keyLabel: "↑↓",
    label: "Select",
    hint: 90,
    ...step,
  },
  "listFilter.down": { scope: "listFilter", title: "Next match", keys: ["down"], ...step },
  "listFilter.apply": {
    scope: "listFilter",
    title: "Keep the filter and go to the list",
    keys: ["return"],
    label: "Keep",
    hint: 89,
    ...keyOnly,
  },
  "listFilter.close": {
    scope: "listFilter",
    title: "Clear the filter",
    keys: ["escape"],
    label: "Clear",
    hint: 88,
    ...keyOnly,
  },

  // Agents.
  "agents.up": {
    scope: "agents",
    title: "Previous agent",
    keys: ["up", "k"],
    keyLabel: "↑↓",
    label: "Select",
    hint: 90,
    ...step,
  },
  "agents.down": { scope: "agents", title: "Next agent", keys: ["down", "j"], ...step },
  "agents.open": {
    scope: "agents",
    title: "Open the agent, or toggle the list",
    keys: ["return", "space"],
    keyLabel: "Enter",
    label: "Open",
    hint: 89,
    ...keyOnly,
  },
  "agents.back": {
    scope: "agents",
    title: "Leave the agent list",
    keys: ["escape", "tab", "shift+tab"],
    keyLabel: "Esc",
    label: "Back",
    hint: 88,
    ...keyOnly,
  },

  // Agent output.
  "agentOutput.close": {
    scope: "agentOutput",
    title: "Close agent output",
    keys: ["escape"],
    label: "Close",
    hint: 90,
    ...keyOnly,
  },
  "agentOutput.scrollUp": {
    scope: "agentOutput",
    title: "Scroll up",
    keys: ["up"],
    keyLabel: "↑↓",
    label: "Scroll",
    hint: 89,
    ...step,
  },
  "agentOutput.scrollDown": { scope: "agentOutput", title: "Scroll down", keys: ["down"], ...step },
  "agentOutput.pageUp": { scope: "agentOutput", title: "Page up", keys: ["pageup"], ...step },
  "agentOutput.pageDown": { scope: "agentOutput", title: "Page down", keys: ["pagedown"], ...step },
  "agentOutput.top": { scope: "agentOutput", title: "Jump to the start", keys: ["home"], ...step },
  "agentOutput.bottom": { scope: "agentOutput", title: "Jump to the end", keys: ["end"], ...step },
  "agentOutput.toggleMarkdown": {
    scope: "agentOutput",
    title: "Toggle rendered Markdown and raw source",
    keys: ["ctrl+r"],
    label: "Raw Markdown",
    hint: 30,
    ...keyOnly,
  },
  "agentOutput.vim": {
    scope: "agentOutput",
    title: "Move, select, and copy text",
    keys: ["h", "j", "k", "l"],
    keyLabel: "hjkl v y",
    label: "Text",
    hint: 28,
    ...step,
  },

  // Link menu.
  "linkMenu.up": {
    scope: "linkMenu",
    title: "Previous action",
    keys: ["up", "shift+tab"],
    keyLabel: "↑↓",
    label: "Choose",
    hint: 90,
    ...step,
  },
  "linkMenu.down": { scope: "linkMenu", title: "Next action", keys: ["down", "tab"], ...step },
  "linkMenu.choose": {
    scope: "linkMenu",
    title: "Run the action",
    keys: ["return"],
    label: "Select",
    hint: 89,
    ...keyOnly,
  },
  "linkMenu.close": {
    scope: "linkMenu",
    title: "Close the menu",
    keys: ["escape"],
    label: "Close",
    hint: 88,
    ...keyOnly,
  },

  // Approval.
  "approval.up": {
    scope: "approval",
    title: "Previous choice",
    keys: ["up", "k"],
    keyLabel: "↑↓",
    label: "Select",
    hint: 90,
    ...step,
  },
  "approval.down": { scope: "approval", title: "Next choice", keys: ["down", "j"], ...step },
  "approval.submit": {
    scope: "approval",
    title: "Submit the choice",
    keys: ["return"],
    label: "Submit",
    hint: 91,
    ...keyOnly,
  },
  "approval.back": {
    scope: "approval",
    title: "Back to the transcript",
    keys: ["escape"],
    label: "Back",
    hint: 88,
    ...keyOnly,
  },
  "approval.pageUp": {
    scope: "approval",
    title: "Scroll request details up",
    keys: ["pageup"],
    keyLabel: "PgUp/Dn",
    label: "Details",
    hint: 70,
    ...step,
  },
  "approval.pageDown": {
    scope: "approval",
    title: "Scroll request details down",
    keys: ["pagedown"],
    ...step,
  },

  // Question.
  "question.up": {
    scope: "question",
    title: "Previous choice",
    keys: ["up", "k"],
    keyLabel: "↑↓",
    label: "Choose",
    hint: 90,
    ...step,
  },
  "question.down": {
    scope: "question",
    title: "Next choice",
    keys: ["down", "j", "tab"],
    ...step,
  },
  "question.previousChoice": {
    scope: "question",
    title: "Previous choice, wrapping",
    keys: ["shift+tab"],
    ...step,
  },
  "question.activate": {
    scope: "question",
    title: "Select or submit",
    keys: ["return"],
    label: "Select",
    hint: 91,
    ...keyOnly,
  },
  "question.toggle": {
    scope: "question",
    title: "Toggle the selected option",
    keys: ["space"],
    ...keyOnly,
  },
  "question.custom": {
    scope: "question",
    title: "Type a different answer",
    keys: ["e"],
    label: "Type answer",
    hint: 80,
    ...keyOnly,
  },
  "question.previous": {
    scope: "question",
    title: "Previous question",
    keys: ["left"],
    ...keyOnly,
  },
  "question.back": {
    scope: "question",
    title: "Back to the transcript",
    keys: ["escape"],
    label: "Back",
    hint: 88,
    ...keyOnly,
  },
  "question.pageUp": {
    scope: "question",
    title: "Scroll details up",
    keys: ["pageup"],
    keyLabel: "PgUp/Dn",
    label: "Details",
    hint: 70,
    ...step,
  },
  "question.pageDown": {
    scope: "question",
    title: "Scroll details down",
    keys: ["pagedown"],
    ...step,
  },

  // Thread shell, when the terminal itself does not have focus.
  "shell.back": {
    scope: "shell",
    title: "Back to the conversation",
    keys: ["escape"],
    label: "Chat",
    hint: 88,
    ...keyOnly,
  },
  "shell.focus": {
    scope: "shell",
    title: "Focus the shell",
    keys: ["return"],
    label: "Focus shell",
    hint: 91,
    ...keyOnly,
  },
  "terminal.new": {
    scope: "shell",
    title: "New shell",
    keys: ["n"],
    label: "New shell",
    hint: 85,
    keywords: "terminal tab",
  },
  "terminal.close": {
    scope: "shell",
    title: "Close this shell",
    keys: ["x"],
    label: "Close shell",
    hint: 84,
    keywords: "terminal tab",
  },
  "shell.previous": {
    scope: "shell",
    title: "Previous shell tab",
    keys: ["left"],
    keyLabel: "←→",
    label: "Switch shell",
    hint: 83,
    ...keyOnly,
  },
  "shell.next": { scope: "shell", title: "Next shell tab", keys: ["right"], ...keyOnly },
  "terminalFocus.release": {
    scope: "terminalFocus",
    title: "Release shell focus",
    keys: ["ctrl+\\"],
    keyLabel: "Ctrl+\\",
    label: "Release shell",
    hint: 90,
    ...keyOnly,
  },

  // Command palette.
  "palette.up": {
    scope: "palette",
    title: "Previous result",
    keys: ["up", "shift+tab"],
    keyLabel: "↑↓",
    label: "Select",
    hint: 90,
    ...step,
  },
  "palette.down": { scope: "palette", title: "Next result", keys: ["down", "tab"], ...step },
  "palette.choose": {
    scope: "palette",
    title: "Run the selected result",
    keys: ["return"],
    label: "Open",
    hint: 89,
    ...keyOnly,
  },
  "palette.close": {
    scope: "palette",
    title: "Close the palette",
    keys: ["escape"],
    label: "Close",
    hint: 88,
    ...keyOnly,
  },

  // Help.
  "help.up": {
    scope: "help",
    title: "Scroll up",
    keys: ["up", "k"],
    keyLabel: "↑↓",
    label: "Scroll",
    hint: 90,
    ...step,
  },
  "help.down": { scope: "help", title: "Scroll down", keys: ["down", "j"], ...step },
  "help.pageUp": { scope: "help", title: "Page up", keys: ["pageup"], ...step },
  "help.pageDown": { scope: "help", title: "Page down", keys: ["pagedown"], ...step },
  "help.filter": {
    scope: "help",
    title: "Filter actions",
    keys: ["/"],
    label: "Filter",
    hint: 89,
    ...keyOnly,
  },
  "help.close": {
    scope: "help",
    title: "Close help",
    keys: ["escape", "return"],
    keyLabel: "Esc",
    label: "Close",
    hint: 88,
    ...keyOnly,
  },

  // Diff.
  "diff.close": {
    scope: "diff",
    title: "Close the diff",
    keys: ["escape"],
    label: "Close",
    hint: 88,
    ...keyOnly,
  },
  "diff.saved": {
    scope: "diff",
    title: "Show saved thread changes",
    keys: ["s"],
    keyLabel: "S/W",
    label: "Saved/working",
    hint: 80,
    ...keyOnly,
  },
  "diff.working": {
    scope: "diff",
    title: "Show working tree changes",
    keys: ["w"],
    ...keyOnly,
  },
  "diff.previousScope": {
    scope: "diff",
    title: "Previous change scope",
    keys: ["["],
    keyLabel: "[/]",
    label: "Scope",
    hint: 78,
    ...keyOnly,
  },
  "diff.nextScope": { scope: "diff", title: "Next change scope", keys: ["]"], ...keyOnly },
  "diff.refresh": {
    scope: "diff",
    title: "Refresh changes",
    keys: ["r"],
    label: "Refresh",
    hint: 76,
    ...keyOnly,
  },
  "diff.switchPane": {
    scope: "diff",
    title: "Switch between files and diff",
    keys: ["tab"],
    label: "Files/diff",
    hint: 85,
    ...keyOnly,
  },
  "diff.openFile": {
    scope: "diff",
    title: "Open the selected file",
    keys: ["return", "right"],
    keyLabel: "Enter",
    label: "Open",
    hint: 84,
    ...keyOnly,
  },
  "diff.files": { scope: "diff", title: "Back to files", keys: ["left"], ...keyOnly },
  "diff.up": {
    scope: "diff",
    title: "Move up",
    keys: ["up", "k"],
    keyLabel: "↑↓",
    label: "Move",
    hint: 90,
    ...step,
  },
  "diff.down": { scope: "diff", title: "Move down", keys: ["down", "j"], ...step },
  "diff.pageUp": { scope: "diff", title: "Page up", keys: ["pageup"], ...step },
  "diff.pageDown": { scope: "diff", title: "Page down", keys: ["pagedown"], ...step },
  "diff.top": { scope: "diff", title: "Jump to the start", keys: ["home"], ...keyOnly },
  "diff.bottom": { scope: "diff", title: "Jump to the end", keys: ["end"], ...keyOnly },

  // Checkpoint restore.
  "restore.up": {
    scope: "restore",
    title: "Previous entry",
    keys: ["up", "k", "shift+tab"],
    keyLabel: "↑↓",
    label: "Select",
    hint: 90,
    ...step,
  },
  "restore.down": {
    scope: "restore",
    title: "Next entry",
    keys: ["down", "j", "tab"],
    ...step,
  },
  "restore.confirm": {
    scope: "restore",
    title: "Confirm",
    keys: ["return"],
    label: "Confirm",
    hint: 89,
    ...keyOnly,
  },
  "restore.back": {
    scope: "restore",
    title: "Go back",
    keys: ["escape"],
    label: "Back",
    hint: 88,
    ...keyOnly,
  },
  "restore.loadOlder": {
    scope: "restore",
    title: "Load older prompts",
    keys: ["l"],
    label: "Older",
    hint: 70,
    ...keyOnly,
  },

  // Pull request.
  "pullRequest.copy": {
    scope: "pullRequest",
    title: "Copy the pull request URL",
    keys: ["c"],
    label: "Copy URL",
    hint: 90,
    ...keyOnly,
  },
  "pullRequest.retry": {
    scope: "pullRequest",
    title: "Find the pull request again",
    keys: ["r"],
    label: "Retry",
    hint: 89,
    ...keyOnly,
  },
  "pullRequest.close": {
    scope: "pullRequest",
    title: "Close",
    keys: ["escape"],
    label: "Close",
    hint: 88,
    ...keyOnly,
  },

  // Favorite models.
  "favorites.switchColumn": {
    scope: "favorites",
    title: "Switch between models and order",
    keys: ["tab"],
    label: "Models/order",
    hint: 90,
    ...keyOnly,
  },
  "favorites.up": {
    scope: "favorites",
    title: "Move up",
    keys: ["up"],
    keyLabel: "↑↓",
    label: "Select",
    hint: 89,
    ...step,
  },
  "favorites.down": { scope: "favorites", title: "Move down", keys: ["down"], ...step },
  "favorites.confirm": {
    scope: "favorites",
    title: "Add, remove, or pick up the model",
    keys: ["return"],
    label: "Add/move",
    hint: 88,
    ...keyOnly,
  },
  "favorites.remove": {
    scope: "favorites",
    title: "Remove from favorites",
    keys: ["x", "delete", "backspace"],
    keyLabel: "X",
    label: "Remove",
    hint: 70,
    ...keyOnly,
  },
  "favorites.close": {
    scope: "favorites",
    title: "Close, or drop the held model",
    keys: ["escape"],
    label: "Close",
    hint: 87,
    ...keyOnly,
  },

  // Theme picker.
  "theme.up": {
    scope: "theme",
    title: "Previous theme",
    keys: ["up", "k"],
    keyLabel: "↑↓",
    label: "Preview",
    hint: 90,
    ...step,
  },
  "theme.down": { scope: "theme", title: "Next theme", keys: ["down", "j"], ...step },
  "theme.choose": {
    scope: "theme",
    title: "Use this theme",
    keys: ["return"],
    label: "Use",
    hint: 89,
    ...keyOnly,
  },
  "theme.close": {
    scope: "theme",
    title: "Keep the current theme",
    keys: ["escape"],
    label: "Close",
    hint: 88,
    ...keyOnly,
  },

  // Manage thread.
  "manage.next": {
    scope: "manage",
    title: "Next control",
    keys: ["tab", "down"],
    keyLabel: "Tab/↑↓",
    label: "Select",
    hint: 90,
    ...step,
  },
  "manage.previous": {
    scope: "manage",
    title: "Previous control",
    keys: ["shift+tab", "up"],
    ...step,
  },
  "manage.activate": {
    scope: "manage",
    title: "Activate the selected control",
    keys: ["return"],
    label: "Activate",
    hint: 89,
    ...keyOnly,
  },
  "manage.close": {
    scope: "manage",
    title: "Close",
    keys: ["escape"],
    label: "Close",
    hint: 88,
    ...keyOnly,
  },

  // Rename.
  "rename.next": {
    scope: "rename",
    title: "Next control",
    keys: ["tab"],
    label: "Next",
    hint: 90,
    ...step,
  },
  "rename.previous": { scope: "rename", title: "Previous control", keys: ["shift+tab"], ...step },
  "rename.confirm": {
    scope: "rename",
    title: "Save",
    keys: ["return"],
    label: "Save",
    hint: 89,
    ...keyOnly,
  },
  "rename.close": {
    scope: "rename",
    title: "Close without saving",
    keys: ["escape"],
    label: "Close",
    hint: 88,
    ...keyOnly,
  },

  // Sidebar context menu.
  "contextMenu.up": {
    scope: "contextMenu",
    title: "Previous item",
    keys: ["up", "shift+tab"],
    keyLabel: "↑↓",
    label: "Select",
    hint: 90,
    ...step,
  },
  "contextMenu.down": { scope: "contextMenu", title: "Next item", keys: ["down", "tab"], ...step },
  "contextMenu.choose": {
    scope: "contextMenu",
    title: "Run the selected item",
    keys: ["return"],
    label: "Choose",
    hint: 89,
    ...keyOnly,
  },
  "contextMenu.close": {
    scope: "contextMenu",
    title: "Close the menu",
    keys: ["escape"],
    label: "Close",
    hint: 88,
    ...keyOnly,
  },

  // New thread form.
  "newThread.next": {
    scope: "newThread",
    title: "Next field",
    keys: ["tab", "down"],
    keyLabel: "Tab",
    label: "Next field",
    hint: 90,
    ...step,
  },
  "newThread.previous": {
    scope: "newThread",
    title: "Previous field",
    keys: ["shift+tab", "up"],
    ...step,
  },
  "newThread.previousOption": {
    scope: "newThread",
    title: "Previous option",
    keys: ["left"],
    ...keyOnly,
  },
  "newThread.nextOption": { scope: "newThread", title: "Next option", keys: ["right"], ...keyOnly },
  "newThread.activate": {
    scope: "newThread",
    title: "Activate the selected field",
    keys: ["return", "space"],
    keyLabel: "Enter",
    label: "Activate",
    hint: 89,
    ...keyOnly,
  },
  "newThread.close": {
    scope: "newThread",
    title: "Close",
    keys: ["escape"],
    label: "Close",
    hint: 88,
    ...keyOnly,
  },

  // New project form.
  "newProject.next": {
    scope: "newProject",
    title: "Next field",
    keys: ["tab"],
    label: "Next field",
    hint: 90,
    ...step,
  },
  "newProject.previous": {
    scope: "newProject",
    title: "Previous field",
    keys: ["shift+tab"],
    ...step,
  },
  "newProject.treeUp": {
    scope: "newProject",
    title: "Previous folder",
    keys: ["up"],
    keyLabel: "↑↓",
    label: "Folder",
    hint: 86,
    ...step,
  },
  "newProject.treeDown": { scope: "newProject", title: "Next folder", keys: ["down"], ...step },
  "newProject.activate": {
    scope: "newProject",
    title: "Activate the selected field",
    keys: ["return"],
    label: "Activate",
    hint: 89,
    ...keyOnly,
  },
  "newProject.close": {
    scope: "newProject",
    title: "Close",
    keys: ["escape"],
    label: "Close",
    hint: 88,
    ...keyOnly,
  },

  // Quit confirmation.
  "quit.confirm": {
    scope: "quit",
    title: "Close T3 TUI",
    keys: ["y", "q", "ctrl+c"],
    keyLabel: "Y",
    label: "Close",
    hint: 90,
    ...keyOnly,
  },
  "quit.cancel": {
    scope: "quit",
    title: "Keep working",
    keys: ["escape", "n"],
    label: "Cancel",
    hint: 89,
    ...keyOnly,
  },
  "quit.switch": {
    scope: "quit",
    title: "Switch button",
    keys: ["tab", "left", "right"],
    ...keyOnly,
  },
  "quit.activate": {
    scope: "quit",
    title: "Run the selected button",
    keys: ["return"],
    ...keyOnly,
  },
} as const satisfies { readonly [id: string]: ActionDefinition };

export type ActionId = keyof typeof ACTIONS;
type ActionsTable = typeof ACTIONS;
/** Ids of the actions a scope may bind. */
export type ActionIdIn<Scope extends ActionScope> = {
  [Id in ActionId]: ActionsTable[Id]["scope"] extends Scope ? Id : never;
}[ActionId];

export const allActions = () =>
  Object.entries(ACTIONS) as ReadonlyArray<[ActionId, ActionDefinition]>;

export function actionDefinition(id: ActionId): ActionDefinition {
  return ACTIONS[id];
}

const KEY_LABELS: { readonly [key: string]: string } = {
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  return: "Enter",
  escape: "Esc",
  tab: "Tab",
  space: "Space",
  backspace: "Bksp",
  delete: "Del",
  pageup: "PgUp",
  pagedown: "PgDn",
  home: "Home",
  end: "End",
};

function titleCaseChordPart(part: string) {
  if (KEY_LABELS[part]) return KEY_LABELS[part]!;
  if (part === "ctrl") return "Ctrl";
  if (part === "shift") return "⇧";
  if (part === "alt") return "Alt";
  if (/^f\d+$/u.test(part)) return part.toUpperCase();
  return part.length === 1 ? part.toUpperCase() : part;
}

const ASCII_LABELS = [
  ["↑↓", "Up/Dn"],
  ["←→", "Left/Right"],
  ["↑", "Up"],
  ["↓", "Down"],
  ["←", "Left"],
  ["→", "Right"],
  ["⇧", "Shift+"],
] as const;

/** Displays one chord, using ASCII names when the terminal cannot show arrows. */
export function formatChord(chord: string, unicode = true) {
  const parts = chord === "+" ? ["+"] : chord.split("+");
  const label = parts
    .map(titleCaseChordPart)
    .join("+")
    .replace(/^⇧\+/u, "⇧");
  return unicode ? label : asciiKeyLabel(label);
}

export function asciiKeyLabel(label: string) {
  return ASCII_LABELS.reduce((text, [from, to]) => text.replaceAll(from, to), label);
}

/** The key text shown for an action in the bar, help, and palette. */
export function actionKeyLabel(definition: ActionDefinition, unicode = true) {
  if (definition.keyLabel)
    return unicode ? definition.keyLabel : asciiKeyLabel(definition.keyLabel);
  const first = definition.keys[0];
  return first === undefined ? "" : formatChord(first, unicode);
}
