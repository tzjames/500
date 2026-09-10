import { render, screen, fireEvent } from "@testing-library/react";
import EuchreReviewModal from "./EuchreReviewModal";

const slots = [{ name: "Graham" }, { name: "Boole" }, { name: "Dijkstra" }, { name: "Fermat" }];
const c = (value, suit) => ({ value, suit });

// One hand, two tricks of it, as the server reconstructs it from the log.
const review = {
  round: 1,
  dealerSeat: 0,
  callerSeat: 2,
  trumpSuit: "♠",
  alone: false,
  bid: null,
  out: [],
  step: 0,
  yours: true,
  hands: [
    [c("A", "♥"), c("K", "♥")],
    [c("A", "♣"), c("9", "♣")],
    [c("J", "♠"), c("A", "♠")],
    [c("K", "♦"), c("9", "♦")],
  ],
  tricks: [
    {
      winnerSeat: 2,
      cards: [
        { seat: 1, card: c("A", "♣") },
        { seat: 2, card: c("J", "♠") },
        { seat: 3, card: c("K", "♦") },
        { seat: 0, card: c("A", "♥") },
      ],
    },
    {
      winnerSeat: 2,
      cards: [
        { seat: 2, card: c("A", "♠") },
        { seat: 3, card: c("9", "♦") },
        { seat: 0, card: c("K", "♥") },
        { seat: 1, card: c("9", "♣") },
      ],
    },
  ],
};

const open = (overrides = {}) => {
  const onStep = jest.fn();
  const onDone = jest.fn();
  render(
    <EuchreReviewModal
      review={{ ...review, ...overrides }}
      deckId="classic"
      mySeat={0}
      slots={slots}
      onStep={onStep}
      onDone={onDone}
    />
  );
  return { onStep, onDone };
};

const cardsFor = (name) =>
  [...document.querySelectorAll(".eu-review-hand")]
    .find((row) => row.textContent.startsWith(name))
    .querySelectorAll(".pc");

test("it opens on the deal, with every hand face up and the maker marked", () => {
  open();
  expect(screen.getByText(/As dealt/)).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/Dijkstra called ♠/);
  expect(screen.getByText("maker")).toBeInTheDocument();
  // Two cards each, and no trick shown before the first one has been stepped to.
  for (const name of ["You", "Boole", "Dijkstra", "Fermat"]) {
    expect(cardsFor(name)).toHaveLength(2);
  }
  expect(screen.queryByText(/took it/)).not.toBeInTheDocument();
});

test("stepping to a trick shows it, who took it, and the hands it left behind", () => {
  open({ step: 1 });
  expect(screen.getByText(/Trick 1 of 2/)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /Dijkstra took it/ })).toBeInTheDocument();
  // One card gone from each hand.
  for (const name of ["You", "Boole", "Dijkstra", "Fermat"]) {
    expect(cardsFor(name)).toHaveLength(1);
  }
  // And the trick counts so far, which only appear once play has started.
  const dijkstra = [...document.querySelectorAll(".eu-review-hand")].find((r) =>
    r.textContent.startsWith("Dijkstra")
  );
  expect(dijkstra.querySelector(".eu-review-who b")).toHaveTextContent("1");
});

test("the winning card of the trick is the one marked", () => {
  open({ step: 1 });
  const won = document.querySelectorAll(".eu-review-trick li.won");
  expect(won).toHaveLength(1);
  expect(won[0]).toHaveTextContent("Dijkstra");
});

test("the last step leaves everyone out of cards", () => {
  open({ step: 2 });
  expect(screen.getAllByText(/out of cards/)).toHaveLength(4);
});

test("the seat driving it can step and finish", () => {
  const { onStep, onDone } = open({ step: 1 });
  fireEvent.click(screen.getByRole("button", { name: /Next/ }));
  expect(onStep).toHaveBeenCalledWith(2);
  fireEvent.click(screen.getByRole("button", { name: /Back/ }));
  expect(onStep).toHaveBeenCalledWith(0);
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(onDone).toHaveBeenCalled();
});

test("everyone else watches along without the controls", () => {
  open({ step: 1, yours: false });
  expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: /Back/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: /Waiting for them to finish/ })).toBeDisabled();
  expect(screen.getByText(/turning the pages/)).toBeInTheDocument();
});

test("a seat that sat the hand out shows no cards", () => {
  open({ out: [0], alone: true });
  expect(screen.getByText(/cards face down/)).toBeInTheDocument();
  expect(screen.getByText("sat out")).toBeInTheDocument();
});
