import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageBubble } from "@/components/chat/MessageBubble";
import type { Message } from "@/lib/api";

// ── helpers ────────────────────────────────────────────────────────────────

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "m1",
    session_id: "sess1",
    role: "assistant",
    content: "Hello there",
    media_urls: null,
    crisis_flagged: false,
    created_at: "2024-01-15T14:30:00.000Z",
    ...overrides,
  };
}

// ── layout ─────────────────────────────────────────────────────────────────

describe("MessageBubble — layout", () => {
  it("adds justify-end class for user messages", () => {
    const { container } = render(
      <MessageBubble message={makeMessage({ role: "user", content: "Hi" })} />
    );
    expect((container.firstChild as HTMLElement).className).toMatch(/justify-end/);
  });

  it("adds justify-start class for assistant messages", () => {
    const { container } = render(
      <MessageBubble message={makeMessage({ role: "assistant", content: "Hi" })} />
    );
    expect((container.firstChild as HTMLElement).className).toMatch(/justify-start/);
  });
});

// ── user content ───────────────────────────────────────────────────────────

describe("MessageBubble — user content", () => {
  it("renders user text inside a <p> with whitespace-pre-wrap", () => {
    render(<MessageBubble message={makeMessage({ role: "user", content: "Hello\nworld" })} />);
    const p = screen.getByText(/Hello/);
    expect(p.tagName).toBe("P");
    expect(p.className).toContain("whitespace-pre-wrap");
  });

  it("renders the full user content string", () => {
    render(<MessageBubble message={makeMessage({ role: "user", content: "Just testing" })} />);
    expect(screen.getByText("Just testing")).toBeInTheDocument();
  });
});

// ── assistant markdown ─────────────────────────────────────────────────────

describe("MessageBubble — assistant markdown", () => {
  it("renders bold markdown syntax as <strong>", () => {
    render(<MessageBubble message={makeMessage({ content: "**bold text**" })} />);
    expect(screen.getByText("bold text").tagName).toBe("STRONG");
  });

  it("renders inline code as <code>", () => {
    render(<MessageBubble message={makeMessage({ content: "Use `console.log`" })} />);
    expect(screen.getByText("console.log").tagName).toBe("CODE");
  });

  it("markdown links have target=_blank and rel=noopener noreferrer", () => {
    render(
      <MessageBubble
        message={makeMessage({ content: "[visit site](https://example.com)" })}
      />
    );
    const link = screen.getByRole("link", { name: "visit site" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});

// ── crisis banner ──────────────────────────────────────────────────────────

describe("MessageBubble — crisis banner", () => {
  it("shows crisis alert when crisis_flagged=true for assistant", () => {
    render(<MessageBubble message={makeMessage({ crisis_flagged: true })} />);
    // CrisisAlert renders the crisis number
    expect(screen.getByText(/988/)).toBeInTheDocument();
  });

  it("does NOT show crisis alert when crisis_flagged=false", () => {
    render(<MessageBubble message={makeMessage({ crisis_flagged: false })} />);
    expect(screen.queryByText(/988/i)).not.toBeInTheDocument();
  });

  it("does NOT show crisis alert for user messages even when crisis_flagged=true", () => {
    render(
      <MessageBubble
        message={makeMessage({ role: "user", crisis_flagged: true, content: "hi" })}
      />
    );
    expect(screen.queryByText(/988/i)).not.toBeInTheDocument();
  });
});

// ── media attachments ──────────────────────────────────────────────────────

describe("MessageBubble — media attachments", () => {
  it("renders an <img> for each media URL", () => {
    const urls = ["https://storage/img1.png", "https://storage/img2.png"];
    render(<MessageBubble message={makeMessage({ role: "user", media_urls: urls })} />);
    const images = screen.getAllByRole("img");
    expect(images).toHaveLength(2);
    expect(images[0]).toHaveAttribute("src", urls[0]);
    expect(images[1]).toHaveAttribute("src", urls[1]);
  });

  it("renders no images when media_urls is null", () => {
    render(<MessageBubble message={makeMessage({ media_urls: null })} />);
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });

  it("renders no images when media_urls is an empty array", () => {
    render(<MessageBubble message={makeMessage({ media_urls: [] })} />);
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });
});

// ── time display ───────────────────────────────────────────────────────────

describe("MessageBubble — time display", () => {
  it("displays a time string with hour:minute format", () => {
    render(<MessageBubble message={makeMessage({ created_at: "2024-01-15T14:30:00.000Z" })} />);
    // The formatTime output is locale-dependent — match the HH:MM pattern
    const timeEl = screen.getByText(/\d{1,2}:\d{2}/);
    expect(timeEl).toBeInTheDocument();
  });
});
