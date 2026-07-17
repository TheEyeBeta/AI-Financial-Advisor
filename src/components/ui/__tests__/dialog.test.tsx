import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../dialog";
import { Button } from "../button";

/**
 * Regression test: controlled dialogs (open/onOpenChange, no DialogTrigger)
 * must return keyboard focus to the element that opened them when they close.
 * Radix only restores focus to a DialogTrigger; without one it preventDefaults
 * the FocusScope restore and focus was dropped onto <body> (WCAG 2.4.3).
 * The fix lives in DialogContent (src/components/ui/dialog.tsx).
 */
function ControlledDialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button onClick={() => setOpen(true)}>Open dialog</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Test dialog</DialogTitle>
            <DialogDescription>Focus restoration harness</DialogDescription>
          </DialogHeader>
          <Button onClick={() => setOpen(false)}>Done</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

describe("DialogContent focus restoration (controlled, no DialogTrigger)", () => {
  it("returns focus to the opening element after the dialog closes", async () => {
    render(<ControlledDialogHarness />);

    const opener = screen.getByRole("button", { name: "Open dialog" });
    opener.focus();
    expect(document.activeElement).toBe(opener);

    opener.click();
    const dialog = await screen.findByRole("dialog", { name: "Test dialog" });

    // Focus must move into the dialog on open…
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    // …and must return to the opener on close, not fall to <body>.
    screen.getByRole("button", { name: "Done" }).click();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(opener);
    });
  });
});
