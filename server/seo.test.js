const test = require("node:test");
const assert = require("node:assert/strict");

const seo = require("./seo");
const content = require("../src/siteContent.json");

// The shape that matters: one title, one description, and an empty root for
// the prerendered body to land in.
const TEMPLATE =
  '<!DOCTYPE html><html><head><meta charset="utf-8" />' +
  "<title>Tricky Games</title>" +
  '<meta name="description" content="old" />' +
  '</head><body><div id="root"></div></body></html>';

const count = (html, re) => (html.match(re) || []).length;

// ---- the head ----

test("a public page carries its own title and description, and only one of each", () => {
  const html = seo.htmlFor("/500", TEMPLATE);
  assert.equal(count(html, /<title>/g), 1);
  assert.equal(count(html, /name="description"/g), 1);
  assert.match(html, /<title>Play 500 Online Free[^<]*<\/title>/);
  assert.ok(!html.includes('content="old"'), "the template's description should be gone");
});

test("each public page gets a different title", () => {
  const titles = seo.PAGES.map((p) => p.title);
  assert.equal(new Set(titles).size, titles.length);
});

test("canonical and og:url point at the real domain", () => {
  const html = seo.htmlFor("/euchre", TEMPLATE);
  assert.match(html, /<link rel="canonical" href="https:\/\/trickygames\.io\/euchre" \/>/);
  assert.match(html, /property="og:url" content="https:\/\/trickygames\.io\/euchre"/);
  assert.match(html, /property="og:image" content="https:\/\/trickygames\.io\/brand\//);
});

test("structured data is valid JSON and describes the game", () => {
  const html = seo.htmlFor("/500", TEMPLATE);
  const json = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1];
  const data = JSON.parse(json.replace(/\\u003c/g, "<"));
  assert.equal(data["@type"], "VideoGame");
  assert.equal(data.name, "500");
  assert.equal(data.isAccessibleForFree, true);
  assert.equal(data.url, "https://trickygames.io/500");
});

// ---- the body, which is the whole point ----

test("a game page ships its real words, not an empty root", () => {
  const html = seo.htmlFor("/500", TEMPLATE);
  const body = html.slice(html.indexOf("<body>"));
  for (const paragraph of content.games["500"].about) {
    // Escaping only touches &<>", none of which the prose uses.
    assert.ok(body.includes(paragraph), "about paragraph should be in the HTML");
  }
  assert.match(body, /<h1>500<\/h1>/);
});

// Driven off the content rather than naming games, so a game added to
// siteContent.json is covered here the moment it lands.
test("the home page lists every game and links to it", () => {
  const body = seo.htmlFor("/", TEMPLATE);
  for (const game of Object.values(content.games)) {
    assert.ok(body.includes(`href="${game.path}"`), `${game.name} link`);
    assert.ok(body.includes(game.blurb), `${game.name} blurb`);
  }
});

test("the prerendered body is the same words the app renders", () => {
  // Both sides read siteContent.json; this asserts the server really uses it
  // rather than a copy that drifted.
  const html = seo.htmlFor("/euchre", TEMPLATE);
  assert.ok(html.includes(content.games.euchre.about[0]));
  assert.ok(html.includes(content.games.euchre.kicker));
});

// ---- pages that aren't public ----

test("a game room is noindex and gets no prerendered body", () => {
  const html = seo.htmlFor("/game/abc-123", TEMPLATE);
  assert.match(html, /<meta name="robots" content="noindex" \/>/);
  assert.match(html, /<div id="root"><\/div>/);
  assert.equal(count(html, /<title>/g), 1);
});

test("a stats page is noindex too", () => {
  assert.match(seo.htmlFor("/500/stats", TEMPLATE), /content="noindex"/);
});

test("a public page is never noindex", () => {
  for (const page of seo.PAGES) {
    assert.ok(!seo.htmlFor(page.path, TEMPLATE).includes("noindex"), page.path);
  }
});

test("a trailing slash is the same page, not a missing one", () => {
  assert.equal(seo.pageFor("/500/").path, "/500");
  assert.equal(seo.pageFor("/").path, "/");
});

// ---- sitemap and llms.txt ----

test("the sitemap lists every public page and nothing else", () => {
  const xml = seo.sitemapXml("2026-01-01");
  for (const page of seo.PAGES) assert.ok(xml.includes(`<loc>https://trickygames.io${page.path}</loc>`));
  assert.equal(count(xml, /<url>/g), seo.PAGES.length);
  assert.ok(!xml.includes("/game/"));
  assert.ok(!xml.includes("/stats"));
});

test("llms.txt names every game with its address", () => {
  const txt = seo.llmsTxt();
  assert.match(txt, /# Tricky Games/);
  for (const game of Object.values(content.games)) {
    assert.ok(txt.includes(`https://trickygames.io${game.path}`), `${game.name} address`);
  }
});

// ---- escaping ----

test("markup in the content can't break out of an attribute or a script", () => {
  const html = seo.htmlFor("/", TEMPLATE);
  const head = html.slice(0, html.indexOf("</head>"));
  // Every attribute in the head we generate should be closed properly: no bare
  // double quote can appear inside one.
  for (const m of head.matchAll(/content="([^"]*)"/g)) {
    assert.ok(!m[1].includes("<"), `unescaped < in ${m[1].slice(0, 40)}`);
  }
  // Nothing inside the JSON-LD may be a literal `<`, which is the only way it
  // could close its own <script> early.
  const json = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1];
  assert.ok(!json.includes("<"), "JSON-LD should carry no raw < ");
  assert.doesNotThrow(() => JSON.parse(json.replace(/\\u003c/g, "<")));
});
