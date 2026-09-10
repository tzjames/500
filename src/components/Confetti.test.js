import { render } from "@testing-library/react";
import confetti from "canvas-confetti";
import Confetti from "./Confetti";

// The component scopes the library to a canvas of its own rather than using the
// shared global one, so the mock is of `create` and the instance it hands back.
jest.mock("canvas-confetti", () => {
  const fire = jest.fn();
  fire.reset = jest.fn();
  return { __esModule: true, default: { create: jest.fn(() => fire), __fire: fire } };
});

const fire = confetti.__fire;

beforeEach(() => {
  jest.useFakeTimers();
  // Create App sets resetMocks, which strips implementations between tests, so
  // what create() hands back has to be wired up here rather than in the factory.
  confetti.create.mockReturnValue(fire);
});

afterEach(() => jest.useRealTimers());

test("it draws onto a canvas of its own, not the library's shared one", () => {
  const { container } = render(<Confetti />);
  const canvas = container.querySelector("canvas.confetti-canvas");
  expect(canvas).toBeInTheDocument();
  expect(confetti.create).toHaveBeenCalledWith(canvas, expect.objectContaining({ resize: true }));
});

test("it fires in from both bottom corners the moment it mounts", () => {
  render(<Confetti />);
  expect(fire).toHaveBeenCalledTimes(2);
  expect(fire.mock.calls.map(([opts]) => opts.origin.x)).toEqual([0, 1]);
});

// The hand-rolled version this replaced animated regardless, which the rest of
// the app is careful not to do.
test("it opts out for anyone who asked for less motion", () => {
  render(<Confetti />);
  jest.advanceTimersByTime(2000);
  expect(fire.mock.calls.length).toBeGreaterThan(2);
  // Set once on the instance, which applies it to every burst it fires.
  expect(confetti.create.mock.calls[0][1].disableForReducedMotion).toBe(true);
});

test("it keeps going for a beat, so it outlasts reading the result", () => {
  render(<Confetti />);
  expect(fire).toHaveBeenCalledTimes(2);
  jest.advanceTimersByTime(700);
  expect(fire).toHaveBeenCalledTimes(3);
  jest.advanceTimersByTime(800);
  expect(fire).toHaveBeenCalledTimes(4);
});

test("leaving the screen stops it and clears the canvas", () => {
  const { unmount } = render(<Confetti />);
  unmount();
  expect(fire.reset).toHaveBeenCalled();
  // Nothing queued fires after the screen has gone.
  const fired = fire.mock.calls.length;
  jest.advanceTimersByTime(5000);
  expect(fire).toHaveBeenCalledTimes(fired);
});

// StrictMode mounts, cleans up and mounts again in development. The shared
// global instance nulls its own canvas on teardown, which threw when the second
// mount fired into it; a per-component instance has no such state to lose.
test("mounting twice over, as StrictMode does, still fires cleanly", () => {
  const first = render(<Confetti />);
  first.unmount();
  fire.mockClear();
  render(<Confetti />);
  expect(confetti.create).toHaveBeenCalledTimes(2);
  expect(fire).toHaveBeenCalledTimes(2);
});
