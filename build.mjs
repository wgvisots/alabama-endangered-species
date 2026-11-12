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
// SAT is "threatened due to similarity of appearance": listed only because it
// looks like a species that is in trouble.  XN is an experimental population.
const STATUS = {
  E: { label: 'Endangered', sentence: 'endangered', listed: true },
  T: { label: 'Threatened', sentence: 'threatened', listed: true },
  SAT: { label: 'Threatened by similarity of appearance', sentence: 'threatened by similarity of appearance', listed: true },
  XN: { label: 'Experimental population', sentence: 'an experimental population', listed: true },
  P: { label: 'Proposed threatened', sentence: 'proposed for listing as threatened', listed: false },
  PE: { label: 'Proposed endangered', sentence: 'proposed for listing as endangered', listed: false },
};

// Every entry falls in one of four sets, shown apart on a group's page.
const SET_ORDER = ['listed', 'sat', 'proposed', 'gone'];
const SETS = {
  listed: { heading: 'Listed, and found in Alabama' },
  sat: {
    heading: 'Listed only for their likeness to another species',
    note: 'Not in danger themselves.  Each is on the list because it is hard to tell from a species that is, and the listing limits collecting or trade.',
  },
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
// Italics for a scientific name or a title, with rank words such as "var." left upright.
const sci = (name) => name.split(/ (var\.|ssp\.|subsp\.|f\.) /)
  .map((part, i) => (i % 2 ? ` ${esc(part)} ` : `<i>${esc(part)}</i>`))
  .join('');

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
const setOf = (e) => (e.presence === 'historical' ? 'gone'
  : e.status === 'SAT' ? 'sat'
    : STATUS[e.status].listed ? 'listed' : 'proposed');
// A common name as it reads mid-sentence: "the spotfin chub", but "the Alabama sturgeon".
const PROPER = /^(Alabama|American|Anthony's|Barbour's|Black Warrior|Cahaba|Canoe Creek|Chipola|Choctaw|Coosa|Cumberland|Cumberlandian|Escambia|Florida|Georgia|Gulf|Indiana|Kemp's|Kral's|Louisiana|Mitchell's|Mohr's|Morefield's|Perdido|Price's|Red Hills|Tennessee|West Indian)\b/;
const inText = (e) => e.nameInText || (PROPER.test(e.common) ? e.common : e.common[0].toLowerCase() + e.common.slice(1));

function seasonStrip(e, g) {
  if (!e.season) {
    const text = e.seasonShort || g.seasonNone || '';
    return text ? `<p class="bloom-none">${esc(text)}</p>` : '';
  }
  const label = `${g.seasonLabel || 'Season'}: ${oxford(e.season.map((m) => MONTHS[m - 1]))}`;
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
      if ('description' in e && (typeof e.description !== 'string' || !e.description.trim())) bad('description is empty; leave it out instead');

      for (const key of ['slug', 'common', 'scientific', 'kind', 'family', 'status', 'fr',
        'habitatType', 'summary', 'habitat', 'alabama', 'range', 'threats']) {
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
      if (e.season !== null && e.season !== undefined) {
        const ok = Array.isArray(e.season) && e.season.length > 0
          && e.season.every((m) => Number.isInteger(m) && m >= 1 && m <= 12);
        if (!ok) bad('season must be null or a list of month numbers 1-12');
      }
      if (!Array.isArray(e.counties)) bad('counties must be a list');
      else if (e.counties.length === 0 && !e.countiesText && !(e.waters && e.waters.length)) bad('give counties, waters, or countiesText to say why there are none');
      if (e.waters !== undefined && !(Array.isArray(e.waters) && e.waters.every((w) => typeof w === 'string' && w.trim()))) bad('waters must be a list of names');
      if (g.waters) for (const w of e.waters || []) if (!g.waters.includes(w)) bad(`not one of this group's waters: ${w}`);
      if (e.season === undefined) bad('season must be given, as null or a list of months');
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
          const v = String(e.image[key]);
          if (isRemote(v)) {
            if (!site.imageHosts.some((h) => v.startsWith(h))) {
              bad(`image ${key} must be hosted on one of: ${site.imageHosts.join(', ')}, or be a file in src/images/`);
            }
          } else if (!LOCAL_IMAGE.test(v)) {
            bad(`image ${key} "${v}" must be an https address or the name of a .jpg or .png file in src/images/`);
          }
        }
        for (const f of e.image.badFiles || []) bad(`image file src/images/${f} is missing or is not a JPEG or PNG`);
        if (e.image.kind && !['photo', 'drawing'].includes(e.image.kind)) bad(`image kind "${e.image.kind}" must be photo or drawing`);
        checkLink(where, e.image.page, 'image page');
        if (!(e.image.badFiles || []).length && !(e.image.w > 0 && e.image.h > 0)) bad('image needs w and h');
      }
      if (e.photoElsewhere) checkLink(where, e.photoElsewhere.url, 'photoElsewhere');
    }
  }
  for (const s of site.sources) checkLink('site.json', s.url, 'source');
  return problems;
}

// ---------- page shell ----------

function layout(site, groups, { title, description, rel, canonical, body, current }) {
  const mark = (id) => (id === current ? ' aria-current="page"' : '');
  const groupNav = groups.map((g) => `<a href="${rel}${g.id}/"${mark(g.id)}>${g.title}</a>`).join('\n        ');

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
        <a href="${rel}report/"${mark('report')}>Report a sighting</a>
        <a href="${rel}about/"${mark('about')}>About and sources</a>
      </nav>
    </div>
    <div class="wrap">
      <nav class="groups-nav" aria-label="Groups">
        ${groupNav}
      </nav>
    </div>
  </header>
  <main id="main" class="wrap">
${body}
  </main>
  <footer class="site-footer">
    <div class="wrap">
      <p>Checked against federal sources on ${longDate(site.reviewed)}.  Listings change, so confirm a species' status with the U.S. Fish &amp; Wildlife Service before you rely on it.</p>
      <p><a href="${rel}report/">Report a sighting</a> <a href="${rel}about/">About and sources</a> <a href="${esc(site.repoUrl)}" rel="noopener noreferrer">Source on GitHub</a> <a href="${rel}about/#license">Text under CC BY 4.0, code under Apache 2.0</a></p>
    </div>
  </footer>
</body>
</html>
`;
}

// ---------- pictures ----------

// A picture is either loaded from an allowed host, or is a file kept in src/images/.
const isRemote = (v) => /^https:\/\//.test(String(v));
const LOCAL_IMAGE = /^[a-z0-9][a-z0-9-]*\.(jpg|png)$/;
const imgSrc = (rel, v) => (isRemote(v) ? v : `${rel}assets/images/${v}`);
const isDrawing = (e) => e.image && e.image.kind === 'drawing';
const pictureWord = (e) => (isDrawing(e) ? 'Drawing' : 'Photo');
const sourceName = (image) => image.source || host(image.page).replace(/^www\./, '');

// Width and height of a PNG or JPEG, read from its header.
function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      if (marker === 0xff) { i += 1; continue; }
      const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isFrame) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
      const bare = marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8);
      i += bare ? 2 : 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

// Reads the size of every local picture, and notes the files that are missing or unreadable.
async function readLocalImages(groups) {
  const used = new Set();
  for (const g of groups) {
    for (const e of g.entries) {
      if (!e.image) continue;
      for (const key of ['thumb', 'full']) {
        const v = e.image[key];
        if (!v || isRemote(v) || !LOCAL_IMAGE.test(v)) continue;
        let size = null;
        try {
          size = imageSize(await readFile(path.join(ROOT, 'src/images', v)));
        } catch {
          size = null;
        }
        if (!size) {
          e.image.badFiles = [...(e.image.badFiles || []), v];
        } else {
          used.add(v);
          if (key === 'full') Object.assign(e.image, size);
        }
      }
    }
  }
  return used;
}

// ---------- shared pieces ----------

function photoThumb(e, rel) {
  if (!e.image) {
    return '<div class="thumb thumb-empty" aria-hidden="true"><span>No photo yet</span></div>';
  }
  return `<div class="thumb" data-photo>
          <img src="${esc(imgSrc(rel, e.image.thumb))}" alt="" width="${e.image.w}" height="${e.image.h}" loading="lazy" decoding="async" referrerpolicy="no-referrer">
          <span class="thumb-fallback" hidden>${pictureWord(e)} unavailable</span>
        </div>`;
}

function featureFigure(site, groups, rel) {
  const [gid, slug] = (site.featured || '').split('/');
  const g = groups.find((x) => x.id === gid);
  const e = g && g.entries.find((x) => x.slug === slug && x.image);
  if (!e) return '';
  return `
      <figure class="hero-photo" data-photo>
        <a href="${rel}${g.id}/${e.slug}/"><img src="${esc(imgSrc(rel, e.image.full))}" alt="${esc(e.image.alt)}" width="${e.image.w}" height="${e.image.h}" decoding="async" referrerpolicy="no-referrer"></a>
        <figcaption>${esc(e.common)}.  ${pictureWord(e)}: ${esc(e.image.credit)}, ${esc(e.image.license.toLowerCase())}.</figcaption>
      </figure>`;
}

// "23 listed: 14 endangered and 9 threatened", or "1 listed, 1 proposed, 1 gone from Alabama".
function tally(g) {
  const by = (set) => g.entries.filter((e) => setOf(e) === set);
  const listed = by('listed');
  const nE = listed.filter((e) => e.status === 'E').length;
  const nT = listed.filter((e) => e.status === 'T').length;
  const plainSplit = nE + nT === listed.length && nE && nT;
  const parts = [plainSplit ? `${listed.length} listed: ${nE} endangered and ${nT} threatened` : `${listed.length} listed`];
  if (by('sat').length) parts.push(`${by('sat').length} listed for likeness`);
  if (by('proposed').length) parts.push(`${by('proposed').length} proposed`);
  if (by('gone').length) parts.push(`${by('gone').length} gone from Alabama`);
  return parts.join(plainSplit ? '; ' : ', ');
}

function groupLede(g) {
  const by = (set) => g.entries.filter((e) => setOf(e) === set);
  const listed = by('listed');
  const sat = by('sat');
  const proposed = by('proposed');
  const gone = by('gone');
  const n = (st) => listed.filter((e) => e.status === st).length;
  const out = [];

  if (listed.length === 0) {
    out.push(`No ${g.one} found in Alabama today is on the federal list of endangered and threatened species.`);
  } else if (listed.length === 1) {
    out.push(`Alabama has one ${g.one} on the federal list of endangered and threatened species: the ${inText(listed[0])}, listed as ${STATUS[listed[0].status].sentence}.`);
  } else {
    const bits = [];
    if (n('E')) bits.push(`${n('E')} as endangered`);
    if (n('T')) bits.push(`${n('T')} as threatened`);
    if (n('XN')) bits.push(`${n('XN')} as an experimental population`);
    const split = bits.length === 1
      ? `${listed.length === 2 ? 'both' : 'all'} listed ${bits[0].replace(/^\d+ /, '')}`
      : oxford(bits.map((b, i) => (i ? b : b.replace(/^(\d+) /, '$1 listed '))));
    out.push(`Alabama has ${listed.length} ${g.many} on the federal list of endangered and threatened species: ${split}.`);
  }
  if (sat.length === 1) out.push(`One more, the ${inText(sat[0])}, is on the list only because it is hard to tell from a species in danger.`);
  else if (sat.length > 1) out.push(`Another ${sat.length} are on the list only because they are hard to tell from species in danger.`);
  if (proposed.length === 1) out.push(`One more, the ${inText(proposed[0])}, has been proposed for listing.`);
  else if (proposed.length > 1) out.push(`Another ${proposed.length} have been proposed for listing.`);
  if (gone.length === 1) out.push(`One listed ${g.one}, the ${inText(gone[0])}, once lived here and is thought to be gone.`);
  else if (gone.length > 1) out.push(`Another ${gone.length} listed ${g.many} once lived here and are thought to be gone.`);
  return out.join('  ');
}

// ---------- pages ----------

function renderHome(site, groups) {
  const all = groups.flatMap((g) => g.entries);
  const covered = oxford(groups.map((g) => g.many));
  const nListed = all.filter((e) => setOf(e) === 'listed').length;
  const present = new Set(all.map((e) => e.status));
  const KEY = [['E', 'Endangered'], ['T', 'Threatened'], ['XN', 'Experimental population'], ['SAT', 'Listed for likeness'], ['P', 'Proposed']];
  const key = KEY.filter(([st]) => present.has(st) || (st === 'P' && present.has('PE')))
    .map(([st, label]) => `<span><span class="dot dot-${st}" aria-hidden="true"></span>${label}</span>`).join(' ');

  const sections = groups.map((g) => {
    const names = g.entries.map((e) => {
      const set = setOf(e);
      const tag = set === 'gone' ? ' <span class="name-tag">gone from Alabama</span>'
        : set === 'proposed' ? ' <span class="name-tag">proposed</span>'
          : set === 'sat' ? ' <span class="name-tag">listed for likeness</span>' : '';
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
        <p class="lede">A compendium of the species in Alabama protected under the federal Endangered Species Act.  It covers ${all.length} species and subspecies in ${groups.length} groups, ${nListed} of them listed and found in the state today.</p>
        <p class="hero-note key">${key}</p>
      </div>${featureFigure(site, groups, '')}
    </section>

${sections}`;

  return layout(site, groups, {
    title: `${site.title}: the federally listed plants and animals of Alabama`,
    description: `The plants and animals in Alabama protected under the federal Endangered Species Act, with descriptions, places, and references: ${covered}.`,
    rel: './',
    canonical: '',
    body,
    current: '',
  });
}

function entryRow(e, g) {
  const hay = [e.common, e.scientific, ...e.otherNames, e.family, e.habitatType, ...e.counties, ...(e.waters || [])]
    .join(' ').toLowerCase();
  const placeField = g.filters && g.filters.place;
  return `        <li class="entry" data-status="${e.status}" data-habitat="${esc(e.habitatType)}" data-places="${esc(placeField ? (e[placeField] || []).join('|') : '')}" data-season="${e.season ? e.season.join(' ') : ''}" data-first="${e.season ? e.season[0] : 99}" data-name="${esc(e.common.toLowerCase())}" data-search="${esc(hay)}">
        ${g.entries.some((x) => x.image) ? photoThumb(e, '../') : '<!-- no photos in this group yet -->'}
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
  const nT = listed.filter((e) => e.status === 'T').length;
  const several = SET_ORDER.filter((s) => by(s).length).length > 1;
  const f = g.filters || null;
  const place = f && f.place;
  const places = place ? [...new Set(listed.flatMap((e) => e[place] || []))].sort((x, y) => x.localeCompare(y)) : [];
  const placeLabel = place === 'waters' ? 'River system' : 'County';

  const controls = f ? `
      <form class="controls" id="controls" data-one="${esc(g.one)}" data-many="${esc(g.many)}" data-now="${esc(g.seasonLabel || '')} in" hidden>
        <div class="field field-search">
          <label for="q">Search</label>
          <input type="search" id="q" name="q" autocomplete="off" placeholder="Name, family, or ${placeLabel.toLowerCase()}">
        </div>
        <fieldset class="field segmented">
          <legend>Status</legend>
          <label><input type="radio" name="status" value="" checked><span>All ${listed.length}</span></label>
          <label><input type="radio" name="status" value="E"><span>Endangered ${nE}</span></label>
          <label><input type="radio" name="status" value="T"><span>Threatened ${nT}</span></label>
        </fieldset>${g.habitats ? `
        <div class="field">
          <label for="habitat">Habitat</label>
          <select id="habitat" name="habitat">
            <option value="">Any habitat</option>
            ${g.habitats.map((h) => `<option>${esc(h)}</option>`).join('\n            ')}
          </select>
        </div>` : ''}${place ? `
        <div class="field">
          <label for="place">${placeLabel}</label>
          <select id="place" name="place">
            <option value="">Any ${placeLabel.toLowerCase()}</option>
            ${places.map((c) => `<option>${esc(c)}</option>`).join('\n            ')}
          </select>
        </div>` : ''}${f.season ? `
        <div class="field">
          <label for="sort">Sort by</label>
          <select id="sort" name="sort">
            <option value="name">Name</option>
            <option value="season">${esc(g.seasonSort)}</option>
          </select>
        </div>
        <label class="check"><input type="checkbox" id="now" name="now"> <span id="now-label">${esc(g.seasonLabel)} this month</span></label>` : ''}
      </form>
      <p class="count" id="count" aria-live="polite">${count(listed.length, g.one, g.many)}</p>` : '';

  const list = (set, id) => {
    const rows = by(set);
    if (!rows.length) return '';
    const head = several ? `
      <h2 class="set-title">${SETS[set].heading}</h2>${SETS[set].note ? `\n      <p class="set-note">${SETS[set].note}</p>` : ''}` : '';
    return `${head}
      <ul class="entries${g.entries.some((x) => x.image) ? '' : ' entries-plain'}"${id ? ` id="${id}"` : ''}>
${rows.map((e) => entryRow(e, g)).join('\n')}
      </ul>`;
  };

  const figure = site.featured.startsWith(`${g.id}/`) ? featureFigure(site, groups, '../') : '';
  const body = `    <section class="hero${figure ? '' : ' hero-plain'}">
      <div class="hero-text">
        <h1>${esc(g.heading)}</h1>
        <p class="lede">${esc(groupLede(g))}  Each entry says what the ${g.one} looks like, ${g.habitatHeading.toLowerCase()}, why it is at risk, and where to read more.</p>
${g.seasonHelp ? `        <p class="hero-note">${esc(g.seasonHelp)}<span id="now-note" hidden>  The outlined square is this month.</span></p>\n` : ''}${g.note ? `        <p class="hero-note">${esc(g.note)}</p>\n` : ''}      </div>${figure}
    </section>

    <section aria-labelledby="list-title">
      <h2 id="list-title" class="visually-hidden">The ${g.many}</h2>${controls}${list('listed', 'entries')}
      <div class="empty" id="empty" hidden>
        <p>No ${g.many} match these filters.</p>
        <button type="button" id="clear">Clear filters</button>
      </div>${list('sat')}${list('proposed')}${list('gone')}
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
            <img src="${esc(imgSrc('../../', e.image.full))}" alt="${esc(e.image.alt)}" width="${e.image.w}" height="${e.image.h}" decoding="async" referrerpolicy="no-referrer">
            <p class="photo-fallback" hidden>${isRemote(e.image.full) && sourceName(e.image) === 'fws.gov'
    ? `The photo could not be loaded from fws.gov.  <a href="${esc(e.image.page)}" rel="noopener noreferrer">See it on the Fish &amp; Wildlife Service site.</a>`
    : `The ${pictureWord(e).toLowerCase()} could not be loaded.  <a href="${esc(e.image.page)}" rel="noopener noreferrer">See the original.</a>`}</p>
            <figcaption>${prose(e.image.caption)}  ${pictureWord(e)}: ${esc(e.image.credit)}.  ${esc(e.image.license)}.  <a href="${esc(e.image.page)}" rel="noopener noreferrer">Original at ${esc(sourceName(e.image))}</a></figcaption>
          </figure>`;
  } else {
    const profile = e.refs.find((r) => /fws\.gov\/species\/|ecos\.fws\.gov\/ecp\/species\//.test(r.url));
    const elsewhere = e.photoElsewhere
      ? `  <a href="${esc(e.photoElsewhere.url)}" rel="noopener noreferrer">${esc(e.photoElsewhere.label)}.</a>`
      : profile ? `  The <a href="${esc(profile.url)}" rel="noopener noreferrer">Fish &amp; Wildlife Service profile</a> is the best place to look for one.` : '';
    photo = `          <div class="photo-missing">
            <p>No photo here yet.  This site only shows photos that are in the public domain or openly licensed, and none has been found for this ${g.one}.${elsewhere}</p>
          </div>`;
  }

  const notice = set === 'gone'
    ? `      <p class="notice"><strong>Thought to be gone from Alabama.</strong>  This ${g.one} is on the federal list and once lived in the state, but it is not known here today.</p>\n`
    : set === 'proposed'
      ? `      <p class="notice"><strong>Proposed, not listed.</strong>  This ${g.one} has no protection under the Endangered Species Act unless a final rule lists it.</p>\n`
      : set === 'sat'
        ? `      <p class="notice"><strong>Listed for its likeness, not its rarity.</strong>  This ${g.one} is on the federal list only because it is hard to tell from a species that is in danger.</p>\n`
        : e.status === 'XN'
          ? `      <p class="notice"><strong>An experimental population.</strong>  The ${g.many === 'birds' ? 'birds' : 'animals'} in Alabama belong to a population released to bring the species back, which the Act treats under looser rules than it does the species elsewhere.</p>\n`
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
    e.season || e.seasonNote ? [g.seasonFact || 'Season', `${e.season ? season : ''}<span class="bloom-note${e.season ? '' : ' bloom-note-alone'}">${esc(e.seasonNote || '')}</span>`] : null,
    ['Habitat', esc(e.habitatType)],
    e.waters && e.waters.length ? ['Alabama waters', esc(e.waters.join(', '))] : null,
    e.counties.length ? ['Alabama counties', esc(e.counties.join(', '))]
      : e.countiesText ? ['Where in Alabama', esc(e.countiesText)] : null,
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
          <p class="facts-report">Seen one?  <a href="../../report/">How to report a sighting</a>, and how to look without doing harm.</p>
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
  const credits = all.filter((x) => x.e.image).map((x) => `        <li>${link(x)}${isDrawing(x.e) ? ', a drawing' : ''}: ${esc(x.e.image.credit)}.  ${esc(x.e.image.license)}.  <a href="${esc(x.e.image.page)}" rel="noopener noreferrer">Original</a></li>`).join('\n');
  const photos = all.filter((x) => x.e.image && !isDrawing(x.e));
  const drawings = all.filter((x) => isDrawing(x.e));
  const nPd = photos.filter((x) => x.e.image.license === 'Public domain').length;
  const nOpen = photos.length - nPd;

  const fill = {
    coverage: oxford(groups.map((g) => count(g.entries.length, g.one, g.many))),
    total: all.length,
    reviewed: longDate(site.reviewed),
    repoUrl: esc(site.repoUrl),
    issuesUrl: esc(`${site.repoUrl}/issues`),
    licenseUrl: esc(`${site.repoUrl}/blob/main/LICENSE`),
    contentLicenseUrl: esc(`${site.repoUrl}/blob/main/LICENSE-CC-BY-4.0`),
    sources,
    credits,
    withPhotos: photos.length,
    drawingsNote: drawings.length
      ? `  ${drawings.length === 1 ? 'One more has' : `Another ${drawings.length} have`} a drawing instead: an old plate or figure in the public domain, copied into this site and credited to the naturalist who made it and the library or museum that scanned it.`
      : '',
    missingByGroup: oxford(groups.filter((g) => g.entries.some((e) => !e.image))
      .map((g) => {
        const n = g.entries.filter((e) => !e.image).length;
        const many = `<a href="../${g.id}/">${g.many}</a>`;
        return n === g.entries.length ? `all ${n} ${many}` : `${n} of the ${g.entries.length} ${many}`;
      })),
    photoLicenses: nOpen
      ? `${nPd} are in the public domain, and ${nOpen} ${nOpen === 1 ? 'is' : 'are'} under a Creative Commons license that asks only for credit.`
      : 'All are in the public domain.',
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

function renderReport(site, groups, template) {
  const fill = { issuesUrl: esc(`${site.repoUrl}/issues`) };
  const body = template.replace(/\{\{(\w+)\}\}/g, (m, key) => {
    if (!(key in fill)) throw new Error(`report.html uses an unknown placeholder: ${m}`);
    return fill[key];
  });
  return layout(site, groups, {
    title: `Report a sighting | ${site.title}`,
    description: 'How to report a sighting of an endangered or threatened species in Alabama: how to look without doing harm, what to write down, and who would like to hear of it.',
    rel: '../',
    canonical: 'report/',
    body,
    current: 'report',
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

  const localImages = await readLocalImages(groups);
  const problems = validate(groups, site);
  if (problems.length) {
    console.error(`Data problems (${problems.length}):\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  for (const g of groups) {
    console.log(`Data OK: ${g.title}: ${tally(g)}; ${g.entries.filter((e) => e.image).length} of ${g.entries.length} with pictures.`);
  }
  if (validateOnly) return;

  await rm(OUT, { recursive: true, force: true });
  const write = async (file, content) => {
    const full = path.join(OUT, file);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  };

  const urls = ['', 'about/', 'report/'];
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
  const reportTemplate = await readFile(path.join(ROOT, 'src/report.html'), 'utf8');
  await write('report/index.html', renderReport(site, groups, reportTemplate));
  await write('404.html', render404(site, groups));

  await mkdir(path.join(OUT, 'assets'), { recursive: true });
  for (const f of ['styles.css', 'app.js', 'favicon.svg']) {
    await copyFile(path.join(ROOT, 'src', f), path.join(OUT, 'assets', f));
  }

  if (localImages.size) await mkdir(path.join(OUT, 'assets/images'), { recursive: true });
  for (const f of localImages) {
    await copyFile(path.join(ROOT, 'src/images', f), path.join(OUT, 'assets/images', f));
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
