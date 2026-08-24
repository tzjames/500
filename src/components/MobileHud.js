import React, { useState } from "react";
import { createPortal } from "react-dom";
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

// What the side panels carried, for screens too narrow to show them.
//
// Below 1280px the panels are hidden so the felt keeps its width, which used to
// take the contract, both scores, the tricks still needed, the claim and concede
// buttons and the help with them. The glanceable half — contract and both
// sides' score and tricks — becomes a three-chip strip under the title, as in
// the mobile designs. The half you only want occasionally keeps the real panels,
// in a sheet behind one button, rather than being reinvented at a second size.
function MobileHud({ contractBid, you, them, footnote, children }) {
  const [open, setOpen] = useState(false);

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
        <button
          type="button"
          className="hud-more"
          onClick={() => setOpen(true)}
          aria-label="Contract, last trick and help"
        >
          <span aria-hidden="true">⋯</span>
        </button>
      </div>

      {footnote && <p className="mobile-hud-note">{footnote}</p>}

      {open &&
        createPortal(
          // Portalled for the same reason the rules modal is: the board's card
          // fans are 3D-transformed under preserve-3d, and a 3D rendering
          // context paints by depth rather than z-index, so a sheet left inside
          // it comes out under the hand.
          <div className="hud-sheet-overlay" onClick={() => setOpen(false)}>
            <div
              className="hud-sheet"
              role="dialog"
              aria-label="Game details"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="hud-sheet-grip" aria-hidden="true" />
              <div className="hud-sheet-body">{children}</div>
              <button className="btn-ghost hud-sheet-close" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

export default MobileHud;
