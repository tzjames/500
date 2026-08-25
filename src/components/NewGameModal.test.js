import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NewGameModal from "./NewGameModal";

// The robot checkbox used to be drawn only under the four-player branch, so a
// two-player game could only get a robot from the waiting room. These pin it to
// both table sizes, and pin that what the modal hands back is what the server
// reads — fillWithBots alongside mode 2.
const open = (props = {}) =>
  render(
    <NewGameModal
      remembered={null}
      loadingDefaults={false}
      onStart={() => {}}
      onCancel={() => {}}
      {...props}
    />
  );

const robotCheck = () => screen.getByRole("checkbox", { name: /start now against/i });

test("the robot option is offered at both table sizes", async () => {
  open();

  // Four is the default, and has always offered it.
  expect(robotCheck()).toBeInTheDocument();
  expect(screen.getByText(/start now against robots/i)).toBeInTheDocument();

  userEvent.click(screen.getByText("Two"));
  expect(robotCheck()).toBeInTheDocument();
  expect(screen.getByText(/start now against a robot/i)).toBeInTheDocument();
});

test("a two-player game against a robot is started as mode 2 with bots", async () => {
  const onStart = jest.fn();
  open({ onStart });

  userEvent.click(screen.getByText("Two"));
  userEvent.click(robotCheck());
  userEvent.click(screen.getByRole("button", { name: /deal against a robot/i }));

  expect(onStart).toHaveBeenCalledTimes(1);
  expect(onStart.mock.calls[0][0]).toMatchObject({ mode: 2, fillWithBots: true });
});

test("a robot at a two-player table locks the game friendly", async () => {
  open();

  userEvent.click(screen.getByText("Two"));
  const friendly = screen.getByRole("checkbox", { name: /friendly game/i });
  expect(friendly).not.toBeDisabled();

  userEvent.click(robotCheck());
  expect(friendly).toBeChecked();
  expect(friendly).toBeDisabled();
  expect(screen.getByText(/against a robot always makes it friendly/i)).toBeInTheDocument();
});
