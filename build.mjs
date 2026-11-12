#!/usr/bin/env node
// Builds the static site in docs/ from data/ and src/.
// No dependencies: run it with `node build.mjs` (Node 18 or newer).
// `node build.mjs --validate` checks the data and writes nothing.

import { readFile, writeFile, mkdir, rm, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, 'docs');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

// E and T are on the federal list.  P is only proposed, and carries no protection.
const STATUS = {
  E: { label: 'Endangered', sentence: 'endangered', listed: true },
  T: { label: 'Threatened', sentence: 'threatened', listed: true },
  P: { label: 'Proposed threatened', sentence: 'proposed for listing as threatened', listed: false },
};

// Every entry falls in one of three sets, shown apart on a group's page.
const SETS = {
  listed: { heading: 'Listed, and found in Alabama' },
  proposed: {
    heading: 'Proposed for listing',
    note: 'Not protected under the Endangered Species Act unless a final rule lists it.',
  },
  gone: {
    heading: 'Listed, but thought to be gone from Alabama',
    note: 'Federally listed species that once lived in the state and are not known here today.',
  },
};

const AL_COUNTIES = new Set(['Autauga', 'Baldwin', 'Barbour', 'Bibb', 'Blount', 'Bullock',
  'Butler', 'Calhoun', 'Chambers', 'Cherokee', 'Chilton', 'Choctaw', 'Clarke', 'Clay',
  'Cleburne', 'Coffee', 'Colbert', 'Conecuh', 'Coosa', 'Covington', 'Crenshaw', 'Cullman',
  'Dale', 'Dallas', 'DeKalb', 'Elmore', 'Escambia', 'Etowah', 'Fayette', 'Franklin',
  'Geneva', 'Greene', 'Hale', 'Henry', 'Houston', 'Jackson', 'Jefferson', 'Lamar',
  'Lauderdale', 'Lawrence', 'Lee', 'Limestone', 'Lowndes', 'Macon', 'Madison', 'Marengo',
  'Marion', 'Marshall', 'Mobile', 'Monroe', 'Montgomery', 'Morgan', 'Perry', 'Pickens',
  'Pike', 'Randolph', 'Russell', 'St. Clair', 'Shelby', 'Sumter', 'Talladega',
  'Tallapoosa', 'Tuscaloosa', 'Walker', 'Washington', 'Wilcox', 'Winston']);

// Reference links must be https, except for these hosts, which were only
// confirmed over http.
const HTTP_OK = new Set(['www.floraofalabama.org']);

// The one policy every page carries.  Images may come from this site and from
// the hosts in site.json; nothing else may load, and no script may be inline.
const csp = (site) => [
  "default-src 'none'",
  `img-src 'self' ${site.imageHosts.map((h) => new URL(h).origin).join(' ')}`,
  "style-src 'self'",
  "script-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

// ---------- helpers ----------

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Italicize a scientific name, leaving rank markers such as "var." upright.
const sci = (name) => name.split(' ')
  .map((w) => (/^(var\.|ssp\.|subsp\.|f\.)$/.test(w) ? esc(w) : `<i>${esc(w)}</i>`))
  .join(' ');

// Prose fields may mark a scientific name with underscores: _Sarracenia rubra_.
const prose = (s) => String(s).split(/_([^_]+)_/)
  .map((part, i) => (i % 2 ? sci(part) : esc(part)))
  .join('');
const plain = (s) => String(s).replace(/_([^_]+)_/g, '$1').replace(/\s+/g, ' ').trim();

const longDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(s));
const host = (url) => new URL(url).hostname.replace(/^www\./, '');

const oxford = (items) => {
  if (items.length < 2) return items.join('');
  if (items.length === 2) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
};

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const setOf = (e) => (e.presence === 'historical' ? 'gone' : STATUS[e.status].listed ? 'listed' : 'proposed');
const inText = (e) => e.nameInText || e.common;

function seasonStrip(e, g) {
  if (!e.season) {
    const text = e.seasonShort || g.seasonNone;
    return text ? `<p class="bloom-none">${esc(text)}</p>` : '';
  }
  const label = `${g.seasonLabel}: ${oxford(e.season.map((m) => MONTHS[m - 1]))}`;
  const cells = MONTHS.map((name, i) => {
    const on = e.season.includes(i + 1);
    return `<span class="m${on ? ' on' : ''}" data-m="${i + 1}">${name[0]}</span>`;
  }).join('');
  return `<div class="bloom" role="img" aria-label="${esc(label)}">${cells}</div>`;
}

const statusTag = (e) => `<span class="status status-${e.status}">${STATUS[e.status].label}</span>`;

// ---------- validation ----------

function validate(groups, site) {
  const problems = [];
  const checkLink = (where, url, what) => {
    let u;
    try { u = new URL(url); } catch { return problems.push(`${where}: ${what} is not a URL: ${url}`); }
    if (u.protocol === 'https:') return;
    if (u.protocol === 'http:' && HTTP_OK.has(u.hostname)) return;
    problems.push(`${where}: ${what} must be https: ${url}`);
  };
  const sourceIds = new Set(site.sources.map((s) => s.id));

  for (const g of groups) {
    const seen = new Set();
    for (const id of g.generalSources) {
      if (!sourceIds.has(id)) problems.push(`${g.id}: generalSources names an unknown source: ${id}`);
    }
    for (const e of g.entries) {
      const where = `${g.id}/${e.slug || e.common || '?'}`;
      const bad = (msg) => problems.push(`${where}: ${msg}`);

      for (const key of ['slug', 'common', 'scientific', 'kind', 'family', 'status', 'fr',
        'habitatType', 'seasonNote', 'summary', 'description', 'habitat', 'alabama', 'range',
        'threats']) {
        if (typeof e[key] !== 'string' || !e[key].trim()) bad(`missing ${key}`);
      }
      if (!/^[a-z0-9-]+$/.test(e.slug || '')) bad('slug must be lowercase letters, digits, and hyphens');
      if (seen.has(e.slug)) bad('duplicate slug');
      seen.add(e.slug);

      const st = STATUS[e.status];
      if (!st) {
        bad(`status must be one of ${Object.keys(STATUS).join(', ')}, got ${e.status}`);
      } else if (st.listed) {
        if (!isDate(e.listedDate)) bad(`listedDate must be YYYY-MM-DD, got ${e.listedDate}`);
        if (!/^\d+ FR \d+$/.test(e.fr || '')) bad(`fr must look like "53 FR 3560", got ${e.fr}`);
      } else if (!isDate(e.proposedDate)) {
        bad(`proposedDate must be YYYY-MM-DD, got ${e.proposedDate}`);
      }
      if (!['present', 'historical', undefined].includes(e.presence)) bad(`presence must be present or historical, got ${e.presence}`);
      if (g.habitats && !g.habitats.includes(e.habitatType)) bad(`unknown habitatType: ${e.habitatType}`);
      if (e.season !== null) {
        const ok = Array.isArray(e.season) && e.season.length > 0
          && e.season.every((m) => Number.isInteger(m) && m >= 1 && m <= 12);
        if (!ok) bad('season must be null or a list of month numbers 1-12');
      }
      if (!Array.isArray(e.counties)) bad('counties must be a list');
      else if (e.counties.length === 0 && !e.countiesText) bad('give counties, or countiesText to say why there are none');
      for (const c of e.counties || []) if (!AL_COUNTIES.has(c)) bad(`not an Alabama county: ${c}`);
      if (!Array.isArray(e.otherNames)) bad('otherNames must be a list');
      if (!Array.isArray(e.refs) || e.refs.length === 0) bad('needs at least one reference');
      for (const r of e.refs || []) {
        if (!r.label) bad('reference without a label');
        checkLink(where, r.url, 'reference');
      }
      if (e.image) {
        for (const key of ['thumb', 'full', 'page', 'alt', 'caption', 'credit', 'license']) {
          if (!e.image[key]) bad(`image is missing ${key}`);
        }
        for (const key of ['thumb', 'full']) {
          if (!site.imageHosts.some((h) => String(e.image[key]).startsWith(h))) {
            bad(`image ${key} must be hosted on one of: ${site.imageHosts.join(', ')}`);
          }
        }
        checkLink(where, e.image.page, 'image page');
        if (!(e.image.w > 0 && e.image.h > 0)) bad('image needs w and h');
      }
      if (e.photoElsewhere) checkLink(where, e.photoElsewhere.url, 'photoElsewhere');
    }
  }
  for (const s of site.sources) checkLink('site.json', s.url, 'source');
  return problems;
}

// ---------- page shell ----------

function layout(site, groups, { title, description, rel, canonical, body, current }) {
  const nav = [
    ...groups.map((g) => ({ id: g.id, href: `${rel}${g.id}/`, label: g.title })),
    { id: 'about', href: `${rel}about/`, label: 'About and sources' },
  ].map((n) => `<a href="${n.href}"${n.id === current ? ' aria-current="page"' : ''}>${n.label}</a>`).join('\n        ');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${esc(csp(site))}">
  <meta name="referrer" content="no-referrer">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  ${canonical !== null ? `<link rel="canonical" href="${esc(site.siteUrl + canonical)}">` : '<meta name="robots" content="noindex">'}
  <link rel="icon" href="${rel}assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="${rel}assets/styles.css">
  <script src="${rel}assets/app.js" defer></script>
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="wrap site-header-inner">
      <a class="site-name" href="${rel}">${esc(site.title)}</a>
      <nav aria-label="Site">
        ${nav}
      </nav>
    </div>
  </header>
  <main id="main" class="wrap">
${body}
  </main>
  <footer class="site-footer">
    <div class="wrap">
      <p>Checked against federal sources on ${longDate(site.reviewed)}.  Listings change, so confirm a species' status with the U.S. Fish &amp; Wildlife Service before you rely on it.</p>
      <p><a href="${rel}about/">About and sources</a> <a href="${esc(site.repoUrl)}" rel="noopener noreferrer">Source on GitHub</a> <a href="${esc(site.repoUrl)}/blob/main/LICENSE" rel="noopener noreferrer">Text and code under the Apache License 2.0</a></p>
    </div>
  </footer>
</body>
</html>
`;
}

// ---------- shared pieces ----------

function photoThumb(e) {
  if (!e.image) {
    return '<div class="thumb thumb-empty" aria-hidden="true"><span>No photo yet</span></div>';
  }
  return `<div class="thumb" data-photo>
          <img src="${esc(e.image.thumb)}" alt="" width="${e.image.w}" height="${e.image.h}" loading="lazy" decoding="async" referrerpolicy="no-referrer">
          <span class="thumb-fallback" hidden>Photo unavailable</span>
        </div>`;
}

function featureFigure(site, groups, rel) {
  const [gid, slug] = (site.featured || '').split('/');
  const g = groups.find((x) => x.id === gid);
  const e = g && g.entries.find((x) => x.slug === slug && x.image);
  if (!e) return '';
  return `
      <figure class="hero-photo" data-photo>
        <a href="${rel}${g.id}/${e.slug}/"><img src="${esc(e.image.full)}" alt="${esc(e.image.alt)}" width="${e.image.w}" height="${e.image.h}" decoding="async" referrerpolicy="no-referrer"></a>
        <figcaption>${esc(e.common)}.  Photo: ${esc(e.image.credit)}, ${esc(e.image.license.toLowerCase())}.</figcaption>
      </figure>`;
}

// "23 listed: 14 endangered and 9 threatened", or "1 listed, 1 proposed, 1 gone from Alabama".
function tally(g) {
  const by = (set) => g.entries.filter((e) => setOf(e) === set);
  const listed = by('listed');
  const nE = listed.filter((e) => e.status === 'E').length;
  const nT = listed.length - nE;
  const parts = [`${listed.length} listed`];
  if (by('proposed').length) parts.push(`${by('proposed').length} proposed`);
  if (by('gone').length) parts.push(`${by('gone').length} gone from Alabama`);
  if (parts.length === 1 && nE && nT) return `${listed.length} listed: ${nE} endangered and ${nT} threatened`;
  return parts.join(', ');
}

function groupLede(g) {
  const by = (set) => g.entries.filter((e) => setOf(e) === set);
  const listed = by('listed');
  const proposed = by('proposed');
  const gone = by('gone');
  const nE = listed.filter((e) => e.status === 'E').length;
  const nT = listed.length - nE;
  const out = [];

  if (listed.length === 0) {
    out.push(`No ${g.one} found in Alabama today is on the federal list of endangered and threatened species.`);
  } else if (listed.length === 1) {
    out.push(`Alabama has one ${g.one} protected under the federal Endangered Species Act: ${inText(listed[0])}, listed as ${STATUS[listed[0].status].sentence}.`);
  } else {
    const split = nE && nT ? `${nE} listed as endangered and ${nT} as threatened`
      : `all listed as ${nE ? 'endangered' : 'threatened'}`;
    out.push(`Alabama has ${listed.length} ${g.many} protected under the federal Endangered Species Act: ${split}.`);
  }
  if (proposed.length === 1) out.push(`One more, the ${inText(proposed[0])}, has been proposed for listing.`);
  else if (proposed.length > 1) out.push(`${proposed.length} more have been proposed for listing.`);
  if (gone.length === 1) out.push(`One listed ${g.one}, the ${inText(gone[0])}, once lived here and is thought to be gone.`);
  else if (gone.length > 1) out.push(`${gone.length} listed ${g.many} once lived here and are thought to be gone.`);
  return out.join('  ');
}

// ---------- pages ----------

function renderHome(site, groups) {
  const covered = oxford(groups.map((g) => g.many));
  const listedNow = groups.map((g) => count(g.entries.filter((e) => setOf(e) === 'listed').length, g.one, g.many));

  const sections = groups.map((g) => {
    const names = g.entries.map((e) => {
      const set = setOf(e);
      const tag = set === 'gone' ? ' <span class="name-tag">gone from Alabama</span>'
        : set === 'proposed' ? ' <span class="name-tag">proposed</span>' : '';
      return `          <li><span class="dot dot-${e.status}" aria-hidden="true"></span><span class="name"><a href="${g.id}/${e.slug}/">${esc(e.common)}</a> <span class="sci">${sci(e.scientific)}</span><span class="visually-hidden">, ${STATUS[e.status].label.toLowerCase()}</span>${tag}</span></li>`;
    }).join('\n');
    return `    <section class="group" aria-labelledby="g-${g.id}">
      <div class="group-head">
        <h2 id="g-${g.id}"><a href="${g.id}/">${esc(g.title)}</a></h2>
        <p class="group-count">${esc(tally(g))}</p>
      </div>
      <ul class="names">
${names}
      </ul>
    </section>`;
  }).join('\n\n');

  const body = `    <section class="hero">
      <div class="hero-text">
        <h1 class="home-title">Endangered plants and animals of Alabama</h1>
        <p class="lede">A compendium, one group at a time, of the species in Alabama protected under the federal Endangered Species Act.  So far it covers ${covered}: ${oxford(listedNow)} listed and found here today.</p>
        <p class="hero-note key"><span><span class="dot dot-E" aria-hidden="true"></span>Endangered</span> <span><span class="dot dot-T" aria-hidden="true"></span>Threatened</span> <span><span class="dot dot-P" aria-hidden="true"></span>Proposed</span></p>
      </div>${featureFigure(site, groups, '')}
    </section>

${sections}`;

  return layout(site, groups, {
    title: `${site.title}: the federally listed plants and animals of Alabama`,
    description: `The plants and animals in Alabama protected under the federal Endangered Species Act, with descriptions, seasons, counties, and references.  So far: ${covered}.`,
    rel: './',
    canonical: '',
    body,
    current: '',
  });
}

function entryRow(e, g) {
  const hay = [e.common, e.scientific, ...e.otherNames, e.family, e.habitatType, ...e.counties]
    .join(' ').toLowerCase();
  return `        <li class="entry" data-status="${e.status}" data-habitat="${esc(e.habitatType)}" data-counties="${esc(e.counties.join('|'))}" data-season="${e.season ? e.season.join(' ') : ''}" data-first="${e.season ? e.season[0] : 99}" data-name="${esc(e.common.toLowerCase())}" data-search="${esc(hay)}">
        ${photoThumb(e)}
        <div class="entry-text">
          <h3><a href="${e.slug}/">${esc(e.common)}</a></h3>
          <p class="sci">${sci(e.scientific)}</p>
          <p class="entry-summary">${prose(e.summary)}</p>
        </div>
        <div class="entry-side">
          <p class="entry-tags">${statusTag(e)} <span class="habitat">${esc(e.habitatType)}</span></p>
          ${seasonStrip(e, g)}
        </div>
      </li>`;
}

function renderGroup(site, groups, g) {
  const by = (set) => g.entries.filter((e) => setOf(e) === set);
  const listed = by('listed');
  const nE = listed.filter((e) => e.status === 'E').length;
  const nT = listed.length - nE;
  const counties = [...new Set(listed.flatMap((e) => e.counties))].sort((a, b) => a.localeCompare(b));
  const several = ['proposed', 'gone'].some((s) => by(s).length);

  const controls = g.filters ? `
      <form class="controls" id="controls" data-one="${esc(g.one)}" data-many="${esc(g.many)}" data-now="${esc(g.seasonLabel)} in" hidden>
        <div class="field field-search">
          <label for="q">Search</label>
          <input type="search" id="q" name="q" autocomplete="off" placeholder="Name, family, or county">
        </div>
        <fieldset class="field segmented">
          <legend>Status</legend>
          <label><input type="radio" name="status" value="" checked><span>All ${listed.length}</span></label>
          <label><input type="radio" name="status" value="E"><span>Endangered ${nE}</span></label>
          <label><input type="radio" name="status" value="T"><span>Threatened ${nT}</span></label>
        </fieldset>
        <div class="field">
          <label for="habitat">Habitat</label>
          <select id="habitat" name="habitat">
            <option value="">Any habitat</option>
            ${g.habitats.map((h) => `<option>${esc(h)}</option>`).join('\n            ')}
          </select>
        </div>
        <div class="field">
          <label for="county">County</label>
          <select id="county" name="county">
            <option value="">Any county</option>
            ${counties.map((c) => `<option>${esc(c)}</option>`).join('\n            ')}
          </select>
        </div>
        <div class="field">
          <label for="sort">Sort by</label>
          <select id="sort" name="sort">
            <option value="name">Name</option>
            <option value="season">${esc(g.seasonSort)}</option>
          </select>
        </div>
        <label class="check"><input type="checkbox" id="now" name="now"> <span id="now-label">${esc(g.seasonLabel)} this month</span></label>
      </form>
      <p class="count" id="count" aria-live="polite">${count(listed.length, g.one, g.many)}</p>` : '';

  const list = (set, id) => {
    const rows = by(set);
    if (!rows.length) return '';
    const head = several ? `
      <h2 class="set-title">${SETS[set].heading}</h2>${SETS[set].note ? `\n      <p class="set-note">${SETS[set].note}</p>` : ''}` : '';
    return `${head}
      <ul class="entries"${id ? ` id="${id}"` : ''}>
${rows.map((e) => entryRow(e, g)).join('\n')}
      </ul>`;
  };

  const figure = site.featured.startsWith(`${g.id}/`) ? featureFigure(site, groups, '../') : '';
  const body = `    <section class="hero${figure ? '' : ' hero-plain'}">
      <div class="hero-text">
        <h1>${esc(g.heading)}</h1>
        <p class="lede">${esc(groupLede(g))}  Each entry says what the ${g.one} looks like, ${g.habitatHeading.toLowerCase()}, why it is at risk, and where to read more.</p>
        <p class="hero-note">${esc(g.seasonHelp)}<span id="now-note" hidden>  The outlined square is this month.</span></p>
      </div>${figure}
    </section>

    <section aria-labelledby="list-title">
      <h2 id="list-title" class="visually-hidden">The ${g.many}</h2>${controls}${list('listed', 'entries')}
      <div class="empty" id="empty" hidden>
        <p>No ${g.many} match these filters.</p>
        <button type="button" id="clear">Clear filters</button>
      </div>${list('proposed')}${list('gone')}
    </section>`;

  return layout(site, groups, {
    title: `${g.heading} | ${site.title}`,
    description: `${groupLede(g)}  Descriptions, seasons, counties, and references.`,
    rel: '../',
    canonical: `${g.id}/`,
    body,
    current: g.id,
  });
}

function renderEntry(site, groups, g, i) {
  const e = g.entries[i];
  const n = g.entries.length;
  const prev = g.entries[(i - 1 + n) % n];
  const next = g.entries[(i + 1) % n];
  const rel = '../../';
  const st = STATUS[e.status];
  const set = setOf(e);

  let photo;
  if (e.image) {
    photo = `          <figure class="photo" data-photo>
            <img src="${esc(e.image.full)}" alt="${esc(e.image.alt)}" width="${e.image.w}" height="${e.image.h}" decoding="async" referrerpolicy="no-referrer">
            <p class="photo-fallback" hidden>The photo could not be loaded from fws.gov.  <a href="${esc(e.image.page)}" rel="noopener noreferrer">See it on the Fish &amp; Wildlife Service site.</a></p>
            <figcaption>${prose(e.image.caption)}  Photo: ${esc(e.image.credit)}.  ${esc(e.image.license)}.  <a href="${esc(e.image.page)}" rel="noopener noreferrer">Original at fws.gov</a></figcaption>
          </figure>`;
  } else {
    const elsewhere = e.photoElsewhere
      ? `  <a href="${esc(e.photoElsewhere.url)}" rel="noopener noreferrer">${esc(e.photoElsewhere.label)}.</a>`
      : `  The <a href="${esc(e.refs[0].url)}" rel="noopener noreferrer">Fish &amp; Wildlife Service profile</a> is the best place to look for one.`;
    photo = `          <div class="photo-missing">
            <p>No photo here yet.  This site only shows photos that are in the public domain or openly licensed, and none has been found for this ${g.one}.${elsewhere}</p>
          </div>`;
  }

  const notice = set === 'gone'
    ? `      <p class="notice"><strong>Thought to be gone from Alabama.</strong>  This ${g.one} is on the federal list and once lived in the state, but it is not known here today.</p>\n`
    : set === 'proposed'
      ? `      <p class="notice"><strong>Proposed, not listed.</strong>  This ${g.one} has no protection under the Endangered Species Act unless a final rule lists it.</p>\n`
      : '';

  const dated = st.listed
    ? ['Listed', `${longDate(e.listedDate)} <span class="cite">(${esc(e.fr)})</span>`]
    : ['Proposed', `${longDate(e.proposedDate)} <span class="cite">(${esc(e.fr)})</span>`];
  const season = seasonStrip(e, g);

  const facts = [
    ['Federal status', statusTag(e)],
    dated,
    set === 'gone' ? ['In Alabama today', 'Not known'] : null,
    [g.kindLabel, esc(e.kind)],
    ['Family', esc(e.family)],
    e.otherNames.length ? ['Also called', e.otherNames.map((x) => (/^[A-Z][a-z]+ [a-z]/.test(x) ? sci(x) : esc(x))).join(', ')] : null,
    [g.seasonFact, `${e.season ? season : ''}<span class="bloom-note${e.season ? '' : ' bloom-note-alone'}">${esc(e.seasonNote)}</span>`],
    ['Habitat', esc(e.habitatType)],
    ['Alabama counties', esc(e.counties.length ? e.counties.join(', ') : e.countiesText)],
    ['Whole range', esc(e.range)],
  ].filter(Boolean).map(([k, v]) => `            <div><dt>${k}</dt><dd>${v}</dd></div>`).join('\n');

  const link = (url, label) => `            <li><a href="${esc(url)}" rel="noopener noreferrer">${esc(label)}</a> <span class="host">${esc(host(url))}</span></li>`;
  const refs = e.refs.map((r) => link(r.url, r.label)).join('\n');
  const general = g.generalSources.map((id) => site.sources.find((s) => s.id === id))
    .map((s) => link(s.url, s.label)).join('\n');

  const section = (title, text) => (text ? `          <h2>${title}</h2>\n          <p>${prose(text)}</p>\n` : '');

  const body = `    <article class="plant">
      <p class="crumbs"><a href="../">All ${g.many}</a></p>
      <header class="plant-head">
        <h1>${esc(e.common)}</h1>
        <p class="sci">${sci(e.scientific)}</p>
        <p class="lede">${prose(e.summary)}</p>
      </header>
${notice}      <div class="plant-body">
        <div class="plant-text">
${photo}
${section('What it looks like', e.description)}${section(g.habitatHeading, e.habitat)}${section('How it lives', e.life)}${section('In Alabama', e.alabama)}${section('Why it is at risk', e.threats)}${section('Notes', e.notes)}          <h2>References</h2>
          <ul class="refs">
${refs}
          </ul>
          <p class="refs-general">General sources for this group:</p>
          <ul class="refs">
${general}
          </ul>
        </div>
        <aside class="facts" aria-label="Quick facts">
          <dl>
${facts}
          </dl>
        </aside>
      </div>
      <nav class="pager" aria-label="More ${g.many}">
        <a href="../${prev.slug}/" rel="prev"><span>Previous</span> ${esc(prev.common)}</a>
        <a href="../${next.slug}/" rel="next"><span>Next</span> ${esc(next.common)}</a>
      </nav>
    </article>`;

  const where = set === 'gone' ? `federally ${st.sentence}, and thought to be gone from Alabama`
    : st.listed ? `federally ${st.sentence} in Alabama` : `${st.sentence}, and found in Alabama`;
  return layout(site, groups, {
    title: `${e.common} (${e.scientific}) | ${site.title}`,
    description: `${e.common}, ${plain(e.scientific)}: ${where}.  ${plain(e.summary)}`,
    rel,
    canonical: `${g.id}/${e.slug}/`,
    body,
    current: '',
  });
}

function renderAbout(site, groups, template) {
  const all = groups.flatMap((g) => g.entries.map((e) => ({ e, g })));
  const link = (x) => `<a href="../${x.g.id}/${x.e.slug}/">${esc(x.e.common)}</a>`;
  const sources = site.sources.map((s) => `        <li><a href="${esc(s.url)}" rel="noopener noreferrer">${esc(s.label)}</a> <span class="host">${esc(host(s.url))}</span><br>${esc(s.use)}</li>`).join('\n');
  const credits = all.filter((x) => x.e.image).map((x) => `        <li>${link(x)}: ${esc(x.e.image.credit)}.  ${esc(x.e.image.license)}.  <a href="${esc(x.e.image.page)}" rel="noopener noreferrer">Original</a></li>`).join('\n');
  const missing = all.filter((x) => !x.e.image).map(link);

  const fill = {
    coverage: oxford(groups.map((g) => count(g.entries.length, g.one, g.many))),
    total: all.length,
    reviewed: longDate(site.reviewed),
    repoUrl: esc(site.repoUrl),
    issuesUrl: esc(`${site.repoUrl}/issues`),
    licenseUrl: esc(`${site.repoUrl}/blob/main/LICENSE`),
    sources,
    credits,
    withPhotos: all.filter((x) => x.e.image).length,
    missingPhotos: oxford(missing),
  };
  const body = template.replace(/\{\{(\w+)\}\}/g, (m, key) => {
    if (!(key in fill)) throw new Error(`about.html uses an unknown placeholder: ${m}`);
    return fill[key];
  });

  return layout(site, groups, {
    title: `About and sources | ${site.title}`,
    description: 'What this site covers, where its information comes from, and what it does not claim.',
    rel: '../',
    canonical: 'about/',
    body,
    current: 'about',
  });
}

function render404(site, groups) {
  const body = `    <section class="hero hero-plain">
      <div class="hero-text">
        <h1>Page not found</h1>
        <p class="lede">Nothing lives at this address.  The page you want may have moved, so try the contents.</p>
        <p><a href="${site.basePath}">See everything the site covers</a></p>
      </div>
    </section>`;
  return layout(site, groups, {
    title: `Page not found | ${site.title}`,
    description: 'Page not found.',
    rel: site.basePath,
    canonical: null,
    body,
    current: '',
  });
}

// ---------- run ----------

async function main() {
  const validateOnly = process.argv.includes('--validate');
  const site = JSON.parse(await readFile(path.join(ROOT, 'data/site.json'), 'utf8'));
  const groups = [];
  for (const g of site.groups) {
    const entries = JSON.parse(await readFile(path.join(ROOT, g.file), 'utf8'));
    entries.sort((a, b) => a.common.localeCompare(b.common));
    groups.push({ ...g, entries });
  }

  const problems = validate(groups, site);
  if (problems.length) {
    console.error(`Data problems (${problems.length}):\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  for (const g of groups) {
    console.log(`Data OK: ${g.title}: ${tally(g)}; ${g.entries.filter((e) => e.image).length} of ${g.entries.length} with photos.`);
  }
  if (validateOnly) return;

  await rm(OUT, { recursive: true, force: true });
  const write = async (file, content) => {
    const full = path.join(OUT, file);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  };

  const urls = ['', 'about/'];
  await write('index.html', renderHome(site, groups));
  for (const g of groups) {
    await write(`${g.id}/index.html`, renderGroup(site, groups, g));
    urls.push(`${g.id}/`);
    for (let i = 0; i < g.entries.length; i += 1) {
      await write(`${g.id}/${g.entries[i].slug}/index.html`, renderEntry(site, groups, g, i));
      urls.push(`${g.id}/${g.entries[i].slug}/`);
    }
  }
  const aboutTemplate = await readFile(path.join(ROOT, 'src/about.html'), 'utf8');
  await write('about/index.html', renderAbout(site, groups, aboutTemplate));
  await write('404.html', render404(site, groups));

  await mkdir(path.join(OUT, 'assets'), { recursive: true });
  for (const f of ['styles.css', 'app.js', 'favicon.svg']) {
    await copyFile(path.join(ROOT, 'src', f), path.join(OUT, 'assets', f));
  }

  // Tell GitHub Pages to serve the folder as it is, without running Jekyll.
  await write('.nojekyll', '');
  await write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${site.siteUrl}sitemap.xml\n`);
  await write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(site.siteUrl + u)}</loc><lastmod>${site.reviewed}</lastmod></url>`).join('\n')}\n</urlset>\n`);

  console.log(`Built ${urls.length + 1} pages in docs/.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
