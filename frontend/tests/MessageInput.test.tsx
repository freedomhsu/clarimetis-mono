import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageInput } from "@/components/chat/MessageInput";

// ── stub heavy sub-components ─────────────────────────────────────────────

vi.mock("@/components/chat/MediaUpload", () => ({
  MediaUpload: () => null,
}));

vi.mock("@/components/chat/VoiceRecorder", () => ({
  VoiceRecorder: () => null,
}));

// ── helpers ────────────────────────────────────────────────────────────────

function setup(props: Partial<Parameters<typeof MessageInput>[0]> = {}) {
  const onSend = vi.fn();
  const onStop = vi.fn();
  const user = userEvent.setup();
  render(<MessageInput onSend={onSend} onStop={onStop} {...props} />);
  const textarea = screen.getByPlaceholderText(/share what's on your mind/i);
  const sendButton = () =>
    screen.queryByRole("button", { name: /send/i });
  const stopButton = () =>
    screen.queryByRole("button", { name: /stop/i });
  return { onSend, onStop, user, textarea, sendButton, stopButton };
}

// ── rendering ─────────────────────────────────────────────────────────────

describe("MessageInput — rendering", () => {
  it("renders the textarea", () => {
    setup();
    expect(screen.getByPlaceholderText(/share what's on your mind/i)).toBeInTheDocument();
  });

  it("shows Send button by default (not streaming)", () => {
    setup();
    expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
  });

  it("shows Stop button when isStreaming=true", () => {
    setup({ isStreaming: true });
    expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send/i })).not.toBeInTheDocument();
  });
});

// ── sending ───────────────────────────────────────────────────────────────

describe("MessageInput — sending", () => {
  it("calls onSend with trimmed content when Send is clicked", async () => {
    const { onSend, user, textarea } = setup();
    await user.type(textarea, "  hello world  ");
    await user.click(screen.getByRole("button", { name: /send/i }));
    expect(onSend).toHaveBeenCalledWith("hello world", undefined);
  });

  it("calls onSend when Enter is pressed", async () => {
    const { onSend, user, textarea } = setup();
    await user.type(textarea, "hi there");
    await user.keyboard("{Enter}");
    expect(onSend).toHaveBeenCalledWith("hi there", undefined);
  });

  it("does NOT call onSend when Shift+Enter is pressed", async () => {
    const { onSend, user, textarea } = setup();
    await user.type(textarea, "line one");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("clears the textarea after sending", async () => {
    const { user, textarea } = setup();
    await user.type(textarea, "message");
    await user.keyboard("{Enter}");
    expect(textarea).toHaveValue("");
  });

  it("does not send when textarea is empty", async () => {
    const { onSend, user } = setup();
    // The send button should be disabled; click should be a no-op
    const btn = screen.getByRole("button", { name: /send/i });
    await user.click(btn);
    expect(onSend).not.toHaveBeenCalled();
  });
});

// ── disabled state ────────────────────────────────────────────────────────

describe("MessageInput — disabled state", () => {
  it("disables the textarea when disabled=true", () => {
    const { textarea } = setup({ disabled: true });
    expect(textarea).toBeDisabled();
  });

  it("does not call onSend when disabled, even if content is present", async () => {
    const { onSend, user, textarea } = setup({ disabled: true });
    // type directly via fireEvent to bypass the disabled attribute
    fireEvent.change(textarea, { target: { value: "sneaky" } });
    await user.keyboard("{Enter}");
    expect(onSend).not.toHaveBeenCalled();
  });
});

// ── stop button ───────────────────────────────────────────────────────────

describe("MessageInput — stop button", () => {
  it("calls onStop when Stop button is clicked", async () => {
    const { onStop, user } = setup({ isStreaming: true });
    await user.click(screen.getByRole("button", { name: /stop/i }));
    expect(onStop).toHaveBeenCalled();
  });
});
