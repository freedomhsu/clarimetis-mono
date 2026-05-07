import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionList } from "@/components/chat/SessionList";
import type { Session } from "@/lib/api";

// ── helpers ────────────────────────────────────────────────────────────────

let idCounter = 0;
function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: `sess-${++idCounter}`,
    title: "Test Session",
    summary: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

/** Build n simple sessions with distinct titles. */
function buildSessions(n: number): Session[] {
  return Array.from({ length: n }, (_, i) =>
    makeSession({ title: `Session ${i + 1}` })
  );
}

const noop = vi.fn();

function renderList(
  props: Partial<Parameters<typeof SessionList>[0]> = {},
  sessions: Session[] = [],
) {
  const defaults = {
    sessions,
    activeSessionId: null as string | null,
    onSelect: noop,
    onCreate: noop,
    onDelete: noop,
    onRename: noop,
  };
  return render(<SessionList {...defaults} {...props} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  idCounter = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── empty state ────────────────────────────────────────────────────────────

describe("SessionList — empty state", () => {
  it("shows 'No sessions yet' when sessions list is empty", () => {
    renderList();
    expect(screen.getByText(/No sessions yet/i)).toBeInTheDocument();
  });

  it("shows session count in header", () => {
    renderList({}, buildSessions(3));
    expect(screen.getByText(/3 conversations/i)).toBeInTheDocument();
  });

  it("shows singular 'conversation' for one session", () => {
    renderList({}, buildSessions(1));
    expect(screen.getByText(/1 conversation$/i)).toBeInTheDocument();
  });
});

// ── create ─────────────────────────────────────────────────────────────────

describe("SessionList — create", () => {
  it("calls onCreate when the New Session button is clicked", async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    renderList({ onCreate });
    await user.click(screen.getByRole("button", { name: /new session/i }));
    expect(onCreate).toHaveBeenCalledOnce();
  });
});

// ── session list ───────────────────────────────────────────────────────────

describe("SessionList — session list", () => {
  it("renders all session titles", () => {
    const sessions = [
      makeSession({ title: "Morning check-in" }),
      makeSession({ title: "Evening review" }),
    ];
    renderList({}, sessions);
    expect(screen.getByText("Morning check-in")).toBeInTheDocument();
    expect(screen.getByText("Evening review")).toBeInTheDocument();
  });

  it("calls onSelect with the session id when a session row is clicked", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const sessions = [makeSession({ id: "s1", title: "Click me" })];
    renderList({ onSelect }, sessions);
    await user.click(screen.getByText("Click me"));
    expect(onSelect).toHaveBeenCalledWith("s1");
  });

  it("does NOT call onSelect while the session is in edit mode", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const sessions = [makeSession({ id: "s1", title: "Editable" })];
    renderList({ onSelect, activeSessionId: "s1" }, sessions);
    // Start rename
    await user.click(screen.getByRole("button", { name: /rename session/i }));
    // Click on the row while editing
    await user.click(screen.getByDisplayValue("Editable"));
    expect(onSelect).not.toHaveBeenCalled();
  });
});

// ── search ─────────────────────────────────────────────────────────────────

describe("SessionList — search", () => {
  it("shows the search input only when there are more than 3 sessions", () => {
    renderList({}, buildSessions(4));
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });

  it("does NOT show the search input when there are 3 or fewer sessions", () => {
    renderList({}, buildSessions(3));
    expect(screen.queryByPlaceholderText(/search/i)).not.toBeInTheDocument();
  });

  it("filters sessions by title (case-insensitive)", async () => {
    const user = userEvent.setup();
    const sessions = [
      makeSession({ title: "Morning check-in" }),
      makeSession({ title: "Evening review" }),
      makeSession({ title: "Afternoon walk" }),
      makeSession({ title: "Night reflection" }),
    ];
    renderList({}, sessions);
    await user.type(screen.getByPlaceholderText(/search/i), "morning");
    expect(screen.getByText("Morning check-in")).toBeInTheDocument();
    expect(screen.queryByText("Evening review")).not.toBeInTheDocument();
    expect(screen.queryByText("Afternoon walk")).not.toBeInTheDocument();
  });

  it("shows 'No results' message when the query matches nothing", async () => {
    const user = userEvent.setup();
    renderList({}, buildSessions(4));
    await user.type(screen.getByPlaceholderText(/search/i), "xyzzy");
    expect(screen.getByText(/no results/i)).toBeInTheDocument();
  });
});

// ── delete ─────────────────────────────────────────────────────────────────

describe("SessionList — delete", () => {
  it("calls onDelete with the session id when Delete is clicked and confirmed", async () => {
    vi.stubGlobal("confirm", () => true);
    const onDelete = vi.fn();
    const user = userEvent.setup();
    const sessions = [makeSession({ id: "s1", title: "Delete me" })];
    renderList({ onDelete, activeSessionId: "s1" }, sessions);
    await user.click(screen.getByRole("button", { name: /delete session/i }));
    expect(onDelete).toHaveBeenCalledWith("s1");
  });
});

// ── rename ─────────────────────────────────────────────────────────────────

describe("SessionList — rename", () => {
  it("shows an inline input prefilled with the current title when Rename is clicked", async () => {
    const user = userEvent.setup();
    const sessions = [makeSession({ id: "s1", title: "Original title" })];
    renderList({ activeSessionId: "s1" }, sessions);
    await user.click(screen.getByRole("button", { name: /rename session/i }));
    expect(screen.getByDisplayValue("Original title")).toBeInTheDocument();
  });

  it("calls onRename with the new title when Enter is pressed", async () => {
    const onRename = vi.fn();
    const user = userEvent.setup();
    const sessions = [makeSession({ id: "s1", title: "Old title" })];
    renderList({ onRename, activeSessionId: "s1" }, sessions);
    await user.click(screen.getByRole("button", { name: /rename session/i }));
    const input = screen.getByDisplayValue("Old title");
    await user.clear(input);
    await user.type(input, "New title");
    await user.keyboard("{Enter}");
    expect(onRename).toHaveBeenCalledWith("s1", "New title");
  });

  it("calls onRename with the new title when the Save button is clicked", async () => {
    const onRename = vi.fn();
    const user = userEvent.setup();
    const sessions = [makeSession({ id: "s1", title: "Old title" })];
    renderList({ onRename, activeSessionId: "s1" }, sessions);
    await user.click(screen.getByRole("button", { name: /rename session/i }));
    const input = screen.getByDisplayValue("Old title");
    await user.clear(input);
    await user.type(input, "Renamed");
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(onRename).toHaveBeenCalledWith("s1", "Renamed");
  });

  it("does NOT call onRename when Escape is pressed (cancel)", async () => {
    const onRename = vi.fn();
    const user = userEvent.setup();
    const sessions = [makeSession({ id: "s1", title: "Keep this" })];
    renderList({ onRename, activeSessionId: "s1" }, sessions);
    await user.click(screen.getByRole("button", { name: /rename session/i }));
    await user.keyboard("{Escape}");
    expect(onRename).not.toHaveBeenCalled();
    // Title is restored in the list
    expect(screen.getByText("Keep this")).toBeInTheDocument();
  });

  it("does NOT call onRename when the title is unchanged", async () => {
    const onRename = vi.fn();
    const user = userEvent.setup();
    const sessions = [makeSession({ id: "s1", title: "Same title" })];
    renderList({ onRename, activeSessionId: "s1" }, sessions);
    await user.click(screen.getByRole("button", { name: /rename session/i }));
    // Press Enter without changing the value
    await user.keyboard("{Enter}");
    expect(onRename).not.toHaveBeenCalled();
  });

  it("hides the rename input after committing", async () => {
    const user = userEvent.setup();
    const sessions = [makeSession({ id: "s1", title: "Title" })];
    renderList({ onRename: vi.fn(), activeSessionId: "s1" }, sessions);
    await user.click(screen.getByRole("button", { name: /rename session/i }));
    await user.keyboard("{Enter}");
    expect(screen.queryByDisplayValue("Title")).not.toBeInTheDocument();
  });
});
