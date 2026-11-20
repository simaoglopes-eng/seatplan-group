import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { NewRoomDialog } from "./NewRoomDialog";

it("starts with the suggested name and lets the owner change it", () => {
  const onCreate = vi.fn();
  render(<NewRoomDialog defaultName="Room 3" onCreate={onCreate} onClose={vi.fn()} />);
  const name = screen.getByLabelText<HTMLInputElement>("Room name");
  expect(name.value).toBe("Room 3");
  fireEvent.change(name, { target: { value: "Garden" } });
  fireEvent.click(screen.getByRole("button", { name: "Create room" }));
  expect(onCreate).toHaveBeenCalledTimes(1);
  expect(onCreate.mock.calls[0][0].name).toBe("Garden");
});
