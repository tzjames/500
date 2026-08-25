import React, { useState } from "react";
import { createPortal } from "react-dom";
import ThemePicker from "./ThemePicker";
import "./TableMenu.css";

// Everything about the table that isn't the table: the four settings — backdrop,
// deck, table shape and sound — plus whatever panels the page hands over, which
// on a narrow screen is the contract, the last trick and the help.
//
// Inline, the settings alone need two rows beside the title, which on a phone
// pushes the felt down and leaves the game less room than the controls for it.
// Behind one button they cost 40px, and they get labels they never had space
// for as four bare controls in a row.
function TableMenu({ locationId, deckId, feltId, playerNames, onChange, children }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="table-menu-button"
        onClick={() => setOpen(true)}
        aria-label="Table menu: options, last trick and the rules"
        title="Options, last trick and the rules"
      >
        {/* Three sliders. Drawn rather than an emoji so it matches the felt and
            sound toggles it sits with inside the sheet. */}
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <g
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          >
            <path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h13M20 17h0" />
            <circle cx="15" cy="7" r="2" fill="currentColor" stroke="none" />
            <circle cx="9" cy="12" r="2" fill="currentColor" stroke="none" />
            <circle cx="19" cy="17" r="2" fill="currentColor" stroke="none" />
          </g>
        </svg>
      </button>

      {open &&
        // Portalled past the board: its card fans are 3D-transformed under
        // preserve-3d, and a 3D rendering context paints by depth rather than
        // z-index, so a sheet left inside it comes out under the cards.
        createPortal(
          <div className="table-menu-overlay" onClick={() => setOpen(false)}>
            <div
              className="table-menu-sheet"
              role="dialog"
              aria-label="Table options"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="table-menu-grip" aria-hidden="true" />
              <p className="overline table-menu-title">Table options</p>
              <ThemePicker
                locationId={locationId}
                deckId={deckId}
                feltId={feltId}
                playerNames={playerNames}
                onChange={onChange}
                stacked
              />
              {/* The page's own panels, unchanged — the contract with its claim
                  and concede buttons, the last trick, and the help. */}
              {children && <div className="table-menu-panels">{children}</div>}
              <button
                className="btn-ghost table-menu-close"
                onClick={() => setOpen(false)}
              >
                Done
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

export default TableMenu;
