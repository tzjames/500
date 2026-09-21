import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import siteContent from "./siteContent.json";

const { site, games } = siteContent;

// The same titles server/seo.js bakes into the HTML, keyed the same way. Both
// read them from siteContent.json rather than composing their own, so a tab
// can't end up saying something the crawler was never told.
const TITLES = {
  "/": site.title,
  ...Object.fromEntries(Object.values(games).map((game) => [game.path, game.title])),
};

// A client-side navigation changes the URL without reloading, so nothing
// updates the title unless something here does — leave it and the tab still
// says wherever you came from.
function DocumentTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = TITLES[pathname.replace(/(.)\/+$/, "$1")] || site.name;
  }, [pathname]);
  return null;
}

export default DocumentTitle;
