import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ShareJob } from "./ShareJob";

describe("the job page's Share button", () => {
  it("opens a menu with the job's own link on every target, and copies it", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ShareJob title="Senior Full-Stack Engineer" path="/careers/ejob_1" />);
    fireEvent.click(screen.getByRole("button", { name: /Share/ }));
    const url = `${window.location.origin}/careers/ejob_1`;
    expect(screen.getByRole("menuitem", { name: /LinkedIn/ }).getAttribute("href")).toBe(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`);
    expect(screen.getByRole("menuitem", { name: /WhatsApp/ }).getAttribute("href")).toContain(encodeURIComponent(url));
    expect(screen.getByRole("menuitem", { name: /Email/ }).getAttribute("href")).toMatch(/^mailto:\?subject=Senior%20Full-Stack%20Engineer%20at%20WonderID/);
    fireEvent.click(screen.getByRole("menuitem", { name: /Copy link/ }));
    await waitFor(() => expect(screen.getByText("Link copied")).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith(url);
  });

  it("closes the menu with Escape", () => {
    render(<ShareJob title="Engineer" path="/careers/ejob_1" />);
    fireEvent.click(screen.getByRole("button", { name: /Share/ }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
