import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/app/actions/platformCareers", () => ({ saveCareersConnectionAction: vi.fn(), removeCareersConnectionAction: vi.fn() }));

import { ConnectionForm } from "./ConnectionForm";

describe("the careers key field", () => {
  it("shows a saved key masked, with only its last four characters, and no empty box", () => {
    render(<ConnectionForm keyHint="diRQ" source="console" baseUrl={null} />);
    const masked = screen.getByLabelText("Career site key ending in diRQ") as HTMLInputElement;
    expect(masked.value).toBe("wjcs_••••••••••••diRQ");
    expect(masked.readOnly).toBe(true);
    expect(document.querySelector('input[name="key"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Remove saved key" })).toBeTruthy();
  });

  it("opens the box on Replace key and closes it on Cancel", () => {
    render(<ConnectionForm keyHint="diRQ" source="console" baseUrl={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Replace key" }));
    expect(document.querySelector('input[name="key"]')).not.toBeNull();
    expect(screen.getByLabelText(/New career site key/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.querySelector('input[name="key"]')).toBeNull();
  });

  it("asks for a key when none is set, and says when the key comes from the environment", () => {
    const { unmount } = render(<ConnectionForm keyHint={null} source="none" baseUrl={null} />);
    expect(document.querySelector('input[name="key"]')).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Replace key" })).toBeNull();
    unmount();
    render(<ConnectionForm keyHint="abcd" source="environment" baseUrl={null} />);
    expect(screen.getByText(/WONDERJOBS_CAREERS_KEY environment variable/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove saved key" })).toBeNull();
  });
});
