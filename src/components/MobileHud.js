import React from "react";
import { isRed } from "../cards";
import "./MobileHud.css";

const suitClass = (suit) => (isRed(suit) ? "red-suit" : "");

// The contract as a chip value: "7 ♥" with the suit in its own colour, or the
// name of a no-tricks contract, or a dash before anyone has bid.
function ContractValue({ bid }) {
  if (!bid) return <span className="hud-chip-quiet">—</span>;
  if (bid.includes("Misere") || bid.includes("Nullo")) {
    return <span className="hud-chip-small">{bid.replace("Misere", "Misère")}</span>;
  }
  const [level, suit] = bid.split(" ");
  return (
    <>
      {level} <span className={suitClass(suit)}>{suit}</span>
    </>
  );
}

function Chip({ label, children, wide = false }) {
  return (
    <div className={`hud-chip${wide ? " hud-chip-wide" : ""}`}>
      <span className="hud-chip-label">{label}</span>
      <span className="hud-chip-value serif">{children}</span>
    </div>
  );
}

// The glanceable half of what the side panels carried, for screens too narrow
// to show them: the contract, and both sides' score and tricks, as a three-chip
// strip under the title as in the mobile designs. The panels themselves — the
// contract with its claim and concede buttons, the last trick, the help — live
// in the table menu, so there is one way in rather than two.
function MobileHud({ contractBid, you, them, footnote }) {
  return (
    <>
      <div className="mobile-hud">
        <Chip label="Contract">
          <ContractValue bid={contractBid} />
        </Chip>
        <Chip label={you.label} wide>
          {you.score}
          <span className="hud-chip-sub">{you.tricks}</span>
        </Chip>
        <Chip label={them.label} wide>
          {them.score}
          <span className="hud-chip-sub">{them.tricks}</span>
        </Chip>
      </div>

      {footnote && <p className="mobile-hud-note">{footnote}</p>}

    </>
  );
}

export default MobileHud;
