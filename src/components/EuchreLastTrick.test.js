import { render, screen, fireEvent } from "@testing-library/react";
import EuchreLastTrick from "./EuchreLastTrick";

const players = [
  { seat: 0, name: "Graham" },
  { seat: 1, name: "Boole (robot)" },
  { seat: 2, name: "Dijkstra (robot)" },
  { seat: 3, name: "Fermat (robot)" },
];

const trick = {
  winnerSeat: 2,
  winningCard: { suit: "♦", value: "J" },
  trumpSuit: "♥",
  cards: [
    { seat: 1, card: { suit: "♣", value: "A" } },
    { seat: 2, card: { suit: "♦", value: "J" } },
    { seat: 3, card: { suit: "♣", value: "9" } },
    { seat: 0, card: { suit: "♣", value: "K" } },
  ],
};

// The classic pack is a glyph deck, so its faces are drawn rather than images.
const cards = () => document.querySelectorAll(".eu-last-trick .pc");

const open = (lastTrick = trick) =>
  render(
    <EuchreLastTrick
      lastTrick={lastTrick}
      players={players}
      mySeat={0}
      deckId="classic"
      trumpSuit="♥"
    />
  );

test("it shows every card of the trick, and who took it with what", () => {
  open();
  expect(screen.getByText("Last trick")).toBeInTheDocument();
  expect(screen.getByRole("button")).toHaveAccessibleName(/won by Dijkstra \(robot\)/i);
  // The left bower: J♦ counts as a heart here, which is why it took the trick.
  expect(screen.getByText(/Dijkstra \(robot\), with the J♦/)).toBeInTheDocument();
  expect(cards()).toHaveLength(4);
});

test("your own card is named as yours", () => {
  open();
  expect(screen.getByText("You")).toBeInTheDocument();
  expect(screen.queryByText("Graham")).not.toBeInTheDocument();
});

test("it fans open on a click, and again on hovering the corner", () => {
  open();
  const stack = screen.getByRole("button");
  const panel = document.querySelector(".eu-last-trick");
  expect(stack).not.toHaveClass("open");

  // fireEvent rather than userEvent: a real click is preceded by a hover, which
  // opens it on its own, and then the click would read as closing it again.
  fireEvent.click(stack);
  expect(stack).toHaveClass("open");
  fireEvent.click(stack);
  expect(stack).not.toHaveClass("open");

  fireEvent.mouseEnter(panel);
  expect(stack).toHaveClass("open");
  fireEvent.mouseLeave(panel);
  expect(stack).not.toHaveClass("open");
});

test("nothing is drawn before a trick has been taken", () => {
  const { container } = render(
    <EuchreLastTrick lastTrick={null} players={players} mySeat={0} deckId="classic" />
  );
  expect(container).toBeEmptyDOMElement();
});

// A two-handed or three-handed table takes fewer cards to a trick, and a lone
// hand drops a seat out of a four-handed one.
test("a short trick shows only the cards that were played", () => {
  open({ ...trick, cards: trick.cards.slice(0, 3), winnerSeat: 2 });
  expect(cards()).toHaveLength(3);
});
