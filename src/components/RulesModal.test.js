import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RulesModal from "./RulesModal";
import EuchreRulesModal from "./EuchreRulesModal";

// Both help panels do double duty: fixed to the table in front of you inside a
// game, and switchable off the home page where there is no table. These pin the
// difference, and that what a panel says follows the table it was given.

const panel = () => screen.getByRole("dialog");

describe("500", () => {
  test("in a game it is fixed to that table and reports its house rules", () => {
    render(<RulesModal variant="two" trumpSuit="♥" onClose={() => {}} />);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(panel()).toHaveTextContent("Two-handed 500, with dummies");
    // Two-player tables have no house rules, so that section isn't drawn.
    expect(panel()).not.toHaveTextContent(/house rules/i);
  });

  test("a four-player table lists the rules it was started with", () => {
    render(<RulesModal variant="four" options={{ hiLo: true }} onClose={() => {}} />);
    expect(panel()).toHaveTextContent(/this table's house rules/i);
    expect(panel()).toHaveTextContent(/Hi-Lo/);
  });

  test("the live trump order is shown for the suit actually in play", () => {
    render(<RulesModal variant="four" trumpSuit="♦" onClose={() => {}} />);
    expect(panel()).toHaveTextContent(/J♦ › J♥ › A♦/);
  });

  test("off the home page the reader picks the table size", async () => {
    render(<RulesModal choosable onClose={() => {}} />);
    expect(panel()).toHaveTextContent("Four players in two partnerships");
    await userEvent.click(screen.getByRole("tab", { name: "Two players" }));
    expect(panel()).toHaveTextContent("each with a dummy hand");
  });
});

describe("Euchre", () => {
  test("in a game it is fixed to that rule set and reports its house rules", () => {
    render(
      <EuchreRulesModal
        variant="british"
        mode={4}
        options={{ stickTheDealer: true }}
        trumpSuit="♥"
        onClose={() => {}}
      />
    );
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(panel()).toHaveTextContent("Euchre — British");
    expect(panel()).toHaveTextContent(/25-card pack/);
    expect(panel()).toHaveTextContent(/First to 11 points/);
    expect(panel()).toHaveTextContent(/this table's house rules/i);
    expect(panel()).toHaveTextContent("Stick the dealer");
    // The Benny is the British pack's top trump, above both bowers.
    expect(panel()).toHaveTextContent(/Benny › J♥ › J♦ › A♥/);
  });

  // "Eldest hand" is glossed in the making-trump text, but that only appears
  // for the rule sets with a turned card — so the trick section says it plainly.
  test("who leads is said in plain words in every rule set", () => {
    for (const variant of ["northAmerican", "bid", "setback", "threeHanded"]) {
      const { unmount } = render(<EuchreRulesModal variant={variant} mode={4} onClose={() => {}} />);
      expect(panel()).toHaveTextContent(/player to the dealer's left leads the first trick/i);
      unmount();
    }
  });

  test("a no-trump contract says there is no order rather than inventing one", () => {
    render(<EuchreRulesModal variant="bid" mode={4} noTrump onClose={() => {}} />);
    expect(panel()).toHaveTextContent(/no bowers/i);
    expect(panel()).not.toHaveTextContent(/›/);
  });

  test("off the home page the reader picks the rule set", async () => {
    render(<EuchreRulesModal choosable onClose={() => {}} />);
    expect(panel()).toHaveTextContent(/24-card pack/);
    expect(panel()).toHaveTextContent(/First to 10 points/);

    await userEvent.click(screen.getByRole("tab", { name: "Set-Back" }));
    expect(panel()).toHaveTextContent(/32-card pack/);
    expect(panel()).toHaveTextContent(/starts at 5 and comes down/);

    await userEvent.click(screen.getByRole("tab", { name: "Bid Euchre" }));
    expect(panel()).toHaveTextContent(/no turned card/i);
    // The switchable panel lists what a rule set offers rather than a table's
    // settings, and only the ones that rule set actually has.
    expect(panel()).toHaveTextContent("No-trump contracts");
    expect(panel()).not.toHaveTextContent("Farmer's hand");
  });
});
