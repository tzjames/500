import { render } from "@testing-library/react";
import Card from "./Card";
import { getDeck } from "../theme";

// The card's height comes off its deck's ratio, because the packs aren't all
// drawn to the same shape. ThemedTable publishes that ratio for the table, so
// anything rendered outside that tree — a portalled modal — used to fall back
// to a shape the art doesn't match and get cropped top and bottom.
const styleOf = (deckId) => {
  const { container } = render(<Card card={{ suit: "♠", value: "A" }} deck={getDeck(deckId)} width={80} />);
  return container.querySelector(".pc").style;
};

test("a card carries its own deck's shape, wherever it is rendered", () => {
  expect(styleOf("scientists").getPropertyValue("--card-ratio")).toBe(String(600 / 399));
  expect(styleOf("traveller").getPropertyValue("--card-ratio")).toBe(String(1400 / 1000));
});

test("the two packs really are drawn to different shapes", () => {
  expect(getDeck("scientists").ratio).not.toBe(getDeck("traveller").ratio);
});
