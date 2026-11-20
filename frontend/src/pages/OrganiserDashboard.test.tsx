import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OrganiserDashboard from "./OrganiserDashboard";

const mocks = vi.hoisted(() => ({ getMe: vi.fn(), get: vi.fn(), post: vi.fn() }));
vi.mock("../api/client", () => ({
  api: { get: mocks.get, post: mocks.post }, getMe: mocks.getMe, clearSessionToken: vi.fn(),
  ApiError: class ApiError extends Error { status = 500; },
}));

describe("organiser dashboard", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.getMe.mockResolvedValue({ name: "Alex" }); mocks.get.mockResolvedValue([]); });
  it("creates an event and offers links to the event and its floor", async () => {
    mocks.post.mockResolvedValue({ name: "Wedding", public_id: "event1", venue_id: "venue1", starts_at: "2030-05-01T18:00:00Z" });
    render(<MemoryRouter><OrganiserDashboard /></MemoryRouter>);
    await screen.findByText("Your events will appear here once you create one.");
    fireEvent.change(screen.getByLabelText("Event name"), { target: { value: "Wedding" } });
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2030-05-01T18:00" } });
    fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "2030-05-01T23:00" } });
    fireEvent.click(screen.getByRole("button", { name: /Create event/ }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledOnce());
    expect(screen.getByRole("link", { name: /Arrange the floor plan/ }).getAttribute("href")).toBe("/editor/venue1");
    expect(screen.getAllByRole("link", { name: /Open event/ })[0].getAttribute("href")).toBe("/organiser/event1");
  });

  it("creates an event at a place that is not in the directory", async () => {
    mocks.post.mockResolvedValue({ name: "Ana's 40th", public_id: "event2", venue_id: "venue2", starts_at: "2030-06-01T19:00:00Z" });
    render(<MemoryRouter><OrganiserDashboard /></MemoryRouter>);
    await screen.findByText("Your events will appear here once you create one.");
    fireEvent.change(screen.getByLabelText("Event name"), { target: { value: "Ana's 40th" } });
    fireEvent.change(screen.getByLabelText("Venue name"), { target: { value: "Casa da Tia Rosa" } });
    fireEvent.change(screen.getByLabelText("Address or town"), { target: { value: "Rua das Flores 12, Sintra" } });
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2030-06-01T19:00" } });
    fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "2030-06-01T23:30" } });
    fireEvent.click(screen.getByRole("button", { name: /Create event/ }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledOnce());
    expect(mocks.post.mock.calls[0][1]).toMatchObject({ venue_name: "Casa da Tia Rosa", venue_address: "Rua das Flores 12, Sintra" });
  });

  it("leaves the place out when it is not given", async () => {
    mocks.post.mockResolvedValue({ name: "Party", public_id: "e3", venue_id: "v3", starts_at: "2030-06-01T19:00:00Z" });
    render(<MemoryRouter><OrganiserDashboard /></MemoryRouter>);
    await screen.findByText("Your events will appear here once you create one.");
    fireEvent.change(screen.getByLabelText("Event name"), { target: { value: "Party" } });
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2030-06-01T19:00" } });
    fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "2030-06-01T23:30" } });
    fireEvent.click(screen.getByRole("button", { name: /Create event/ }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledOnce());
    expect(mocks.post.mock.calls[0][1].venue_name).toBeUndefined();
  });
});
