// What a crawler gets. The client is a single-page app, so the HTML this
// server hands out is an empty <div id="root"> until React runs — fine for
// Google, which executes JavaScript, and useless for the AI crawlers, which
// largely don't. So the public pages are rendered here as plain HTML too:
// their real title and description in the head, and their real words in the
// body, taken from the same src/siteContent.json the React pages read so the
// two can't say different things.
//
// Only the pages a logged-out visitor can actually read are listed. Stats and
// game rooms need an account, so they carry noindex rather than a snapshot of
// a login form.
const content = require("../src/siteContent.json");

const { site, games } = content;
const ORIGIN = site.origin;

const escape = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// JSON-LD sits in a <script> block, where the only thing that can break out is
// a literal </script>; JSON.stringify leaves the slash alone, so escape it.
const jsonLd = (data) =>
  `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;

const publisher = { "@type": "Organization", name: site.name, url: ORIGIN };

function gameSchema(game) {
  return {
    "@context": "https://schema.org",
    "@type": "VideoGame",
    name: game.name,
    description: game.blurb,
    url: ORIGIN + game.path,
    genre: ["Card game", "Trick-taking card game"],
    gamePlatform: "Web browser",
    applicationCategory: "GameApplication",
    operatingSystem: "Any",
    playMode: ["SinglePlayer", "MultiPlayer"],
    numberOfPlayers: {
      "@type": "QuantitativeValue",
      minValue: game.minPlayers,
      maxValue: game.maxPlayers,
    },
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    publisher,
  };
}

const siteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: site.name,
  description: site.description,
  url: ORIGIN,
  publisher,
};

// A game's page: the kicker, the name, and the same two paragraphs the React
// page shows under them.
function gameBody(game) {
  return [
    `<p>${escape(game.kicker)}</p>`,
    `<h1>${escape(game.name)}</h1>`,
    ...game.about.map((p) => `<p>${escape(p)}</p>`),
    `<p>${escape(game.playerCount)}. Free to play in your browser, against friends or against robots.</p>`,
    `<p><a href="/">${escape(site.name)}</a></p>`,
  ].join("");
}

function homeBody() {
  const cards = Object.values(games)
    .map(
      (game) =>
        `<li><h2><a href="${game.path}">${escape(game.name)}</a></h2>` +
        `<p>${escape(game.kicker)}</p><p>${escape(game.blurb)}</p>` +
        `<p>${escape(game.playerCount)}</p></li>`
    )
    .join("");
  return (
    `<h1>${escape(site.name)}</h1><p>${escape(site.blurb)}</p>` +
    `<h2>Pick a game</h2><ul>${cards}</ul>`
  );
}

// Every public page, in sitemap order. `priority` is only a hint and Google
// ignores it, but Bing and the smaller crawlers still read it.
const PAGES = [
  {
    path: "/",
    title: site.title,
    description: site.description,
    body: homeBody,
    schema: () => siteSchema,
    priority: "1.0",
  },
  ...Object.values(games).map((game) => ({
    path: game.path,
    title: game.title,
    description: game.description,
    body: () => gameBody(game),
    schema: () => gameSchema(game),
    priority: "0.9",
  })),
];

const byPath = Object.fromEntries(PAGES.map((page) => [page.path, page]));

// A trailing slash is the same page; anything else is not one of ours.
const pageFor = (pathname) =>
  byPath[pathname] || byPath[pathname.replace(/\/+$/, "")] || null;

function headFor(page) {
  const canonical = ORIGIN + page.path;
  const image = ORIGIN + site.ogImage;
  return [
    `<title>${escape(page.title)}</title>`,
    `<meta name="description" content="${escape(page.description)}" />`,
    `<link rel="canonical" href="${canonical}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${escape(site.name)}" />`,
    `<meta property="og:title" content="${escape(page.title)}" />`,
    `<meta property="og:description" content="${escape(page.description)}" />`,
    `<meta property="og:url" content="${canonical}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escape(page.title)}" />`,
    `<meta name="twitter:description" content="${escape(page.description)}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    jsonLd(page.schema()),
  ].join("");
}

// The template ships one title and one description for the whole app. Both are
// replaced rather than appended, or the page would carry two of each.
function inject(template, { head, body, noindex }) {
  let html = template
    .replace(/<title>.*?<\/title>/is, "")
    .replace(/<meta\s+name="description"[^>]*>/is, "");
  const headTags = noindex ? `<meta name="robots" content="noindex" />${head}` : head;
  html = html.replace("</head>", `${headTags}</head>`);
  return body ? html.replace('<div id="root"></div>', `<div id="root">${body}</div>`) : html;
}

// The HTML for a request. Public pages get their own head and a prerendered
// body; everything else keeps the app shell and is told not to index itself.
function htmlFor(pathname, template) {
  const page = pageFor(pathname);
  if (!page) {
    return inject(template, {
      head: `<title>${escape(site.name)}</title><meta name="description" content="${escape(site.description)}" />`,
      noindex: true,
    });
  }
  return inject(template, { head: headFor(page), body: page.body() });
}

const sitemapXml = (lastmod = new Date().toISOString().slice(0, 10)) =>
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
  PAGES.map(
    (page) =>
      `<url><loc>${ORIGIN}${page.path}</loc><lastmod>${lastmod}</lastmod>` +
      `<changefreq>weekly</changefreq><priority>${page.priority}</priority></url>`
  ).join("") +
  "</urlset>";

// A plain-text brief for the assistants that read one. Same facts as the
// pages, in the order someone asking "where can I play 500" would want them.
const llmsTxt = () =>
  [
    `# ${site.name}`,
    "",
    `> ${site.blurb}`,
    "",
    `Free, no account needed to read the rules, no payment. Site: ${ORIGIN}`,
    "",
    "## Games",
    "",
    ...Object.values(games).map(
      (game) =>
        `- [${game.name}](${ORIGIN}${game.path}): ${game.blurb} ${game.playerCount}.`
    ),
    "",
    "## Notes",
    "",
    "- Plays in a browser; nothing to install.",
    "- Robots fill empty seats, so a game can be played alone.",
    "- Each game keeps its own record and rating.",
    "",
  ].join("\n");

module.exports = { PAGES, htmlFor, pageFor, sitemapXml, llmsTxt, ORIGIN };
