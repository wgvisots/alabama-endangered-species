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

const STATUS = {
  E: { label: 'Endangered', sentence: 'endangered' },
  T: { label: 'Threatened', sentence: 'threatened' },
};

const HABITATS = [
  'Bogs, seeps, and wet prairies',
  'Glades and outcrops',
  'Streams and shoals',
  'Woods and pinelands',
  'Bluffs, cliffs, and sinkholes',
];

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

const host = (url) => new URL(url).hostname.replace(/^www\./, '');

const oxford = (items) => {
  if (items.length < 2) return items.join('');
  if (items.length === 2) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
};

function bloomLabel(p) {
  if (!p.bloom) return 'No flowers';
  return `In flower: ${oxford(p.bloom.map((m) => MONTHS[m - 1]))}`;
}

function bloomStrip(p) {
  if (!p.bloom) return '<p class="bloom-none">No flowers; spreads by spores</p>';
  const cells = MONTHS.map((name, i) => {
    const on = p.bloom.includes(i + 1);
    return `<span class="m${on ? ' on' : ''}" data-m="${i + 1}">${name[0]}</span>`;
  }).join('');
  return `<div class="bloom" role="img" aria-label="${esc(bloomLabel(p))}">${cells}</div>`;
}

function statusTag(p) {
  return `<span class="status status-${p.status}">${STATUS[p.status].label}</span>`;
}

// ---------- validation ----------

function validate(plants, site) {
  const problems = [];
  const bad = (p, msg) => problems.push(`${p.slug || p.common || '?'}: ${msg}`);
  const seen = new Set();
  const imageHosts = site.imageHosts;

  const checkLink = (p, url, what) => {
    let u;
    try { u = new URL(url); } catch { return bad(p, `${what} is not a URL: ${url}`); }
    if (u.protocol === 'https:') return;
    if (u.protocol === 'http:' && HTTP_OK.has(u.hostname)) return;
    bad(p, `${what} must be https: ${url}`);
  };

  for (const p of plants) {
    for (const key of ['slug', 'common', 'scientific', 'group', 'family', 'status', 'listedDate',
      'fr', 'habitatType', 'bloomNote', 'summary', 'description', 'habitat', 'alabama',
      'range', 'threats']) {
      if (typeof p[key] !== 'string' || !p[key].trim()) bad(p, `missing ${key}`);
    }
    if (!/^[a-z0-9-]+$/.test(p.slug || '')) bad(p, 'slug must be lowercase letters, digits, and hyphens');
    if (seen.has(p.slug)) bad(p, 'duplicate slug');
    seen.add(p.slug);
    if (!STATUS[p.status]) bad(p, `status must be E or T, got ${p.status}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.listedDate || '') || Number.isNaN(Date.parse(p.listedDate))) {
      bad(p, `listedDate must be YYYY-MM-DD, got ${p.listedDate}`);
    }
    if (!/^\d+ FR \d+$/.test(p.fr || '')) bad(p, `fr must look like "53 FR 3560", got ${p.fr}`);
    if (!HABITATS.includes(p.habitatType)) bad(p, `unknown habitatType: ${p.habitatType}`);
    if (p.bloom !== null) {
      const ok = Array.isArray(p.bloom) && p.bloom.length > 0
        && p.bloom.every((m) => Number.isInteger(m) && m >= 1 && m <= 12);
      if (!ok) bad(p, 'bloom must be null or a list of month numbers 1-12');
    }
    if (!Array.isArray(p.counties) || p.counties.length === 0) bad(p, 'counties must list at least one county');
    for (const c of p.counties || []) if (!AL_COUNTIES.has(c)) bad(p, `not an Alabama county: ${c}`);
    if (!Array.isArray(p.otherNames)) bad(p, 'otherNames must be a list');
    if (!Array.isArray(p.refs) || p.refs.length === 0) bad(p, 'needs at least one reference');
    for (const r of p.refs || []) {
      if (!r.label) bad(p, 'reference without a label');
      checkLink(p, r.url, 'reference');
    }
    if (p.image) {
      for (const key of ['thumb', 'full', 'page', 'alt', 'caption', 'credit', 'license']) {
        if (!p.image[key]) bad(p, `image is missing ${key}`);
      }
      for (const key of ['thumb', 'full']) {
        if (!imageHosts.some((h) => String(p.image[key]).startsWith(h))) {
          bad(p, `image ${key} must be hosted on one of: ${imageHosts.join(', ')}`);
        }
      }
      checkLink(p, p.image.page, 'image page');
      if (!(p.image.w > 0 && p.image.h > 0)) bad(p, 'image needs w and h');
    }
    if (p.photoElsewhere) checkLink(p, p.photoElsewhere.url, 'photoElsewhere');
  }
  for (const s of site.sources) checkLink({ slug: 'site.json' }, s.url, 'source');
  return problems;
}

// ---------- page shell ----------

function layout(site, { title, description, rel, canonical, body, current }) {
  const nav = [
    { id: 'plants', href: `${rel}`, label: 'Plants' },
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
  ${canonical ? `<link rel="canonical" href="${esc(site.siteUrl + canonical)}">` : '<meta name="robots" content="noindex">'}
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
      <p>Checked against federal sources on ${longDate(site.reviewed)}.  Listings change, so confirm a plant's status with the U.S. Fish &amp; Wildlife Service before you rely on it.</p>
      <p><a href="${rel}about/">About and sources</a> <a href="${esc(site.repoUrl)}" rel="noopener noreferrer">Source on GitHub</a></p>
    </div>
  </footer>
</body>
</html>
`;
}

// ---------- pages ----------

function photoThumb(p, rel) {
  if (!p.image) {
    return '<div class="thumb thumb-empty" aria-hidden="true"><span>No photo yet</span></div>';
  }
  return `<div class="thumb" data-photo>
          <img src="${esc(p.image.thumb)}" alt="" width="${p.image.w}" height="${p.image.h}" loading="lazy" decoding="async" referrerpolicy="no-referrer">
          <span class="thumb-fallback" hidden>Photo unavailable</span>
        </div>`;
}

function renderIndex(site, plants) {
  const nE = plants.filter((p) => p.status === 'E').length;
  const nT = plants.filter((p) => p.status === 'T').length;
  const counties = [...new Set(plants.flatMap((p) => p.counties))].sort((a, b) => a.localeCompare(b));
  const feature = plants.find((p) => p.slug === 'green-pitcher-plant' && p.image) || plants.find((p) => p.image);

  const rows = plants.map((p) => {
    const hay = [p.common, p.scientific, ...p.otherNames, p.family, p.habitatType, ...p.counties]
      .join(' ').toLowerCase();
    return `      <li class="entry" data-status="${p.status}" data-habitat="${esc(p.habitatType)}" data-counties="${esc(p.counties.join('|'))}" data-bloom="${p.bloom ? p.bloom.join(' ') : ''}" data-first="${p.bloom ? p.bloom[0] : 99}" data-name="${esc(p.common.toLowerCase())}" data-search="${esc(hay)}">
        ${photoThumb(p)}
        <div class="entry-text">
          <h3><a href="plants/${p.slug}/">${esc(p.common)}</a></h3>
          <p class="sci">${sci(p.scientific)}</p>
          <p class="entry-summary">${prose(p.summary)}</p>
        </div>
        <div class="entry-side">
          <p class="entry-tags">${statusTag(p)} <span class="habitat">${esc(p.habitatType)}</span></p>
          ${bloomStrip(p)}
        </div>
      </li>`;
  }).join('\n');

  const featureHtml = feature ? `
      <figure class="hero-photo" data-photo>
        <a href="plants/${feature.slug}/"><img src="${esc(feature.image.full)}" alt="${esc(feature.image.alt)}" width="${feature.image.w}" height="${feature.image.h}" decoding="async" referrerpolicy="no-referrer"></a>
        <figcaption>${esc(feature.common)}.  Photo: ${esc(feature.image.credit)}, ${esc(feature.image.license.toLowerCase())}.</figcaption>
      </figure>` : '';

  const body = `    <section class="hero">
      <div class="hero-text">
        <h1>Federally listed plants of Alabama</h1>
        <p class="lede">Alabama has ${plants.length} plants protected under the federal Endangered Species Act: ${nE} listed as endangered and ${nT} as threatened.  Each entry says what the plant looks like, where it grows, why it is at risk, and where to read more.</p>
        <p class="hero-note">The strip beside each plant shows the months it flowers.  A filled square is a month in flower.<span id="now-note" hidden>  The outlined square is this month.</span></p>
      </div>${featureHtml}
    </section>

    <section aria-labelledby="list-title">
      <h2 id="list-title" class="visually-hidden">The plants</h2>
      <form class="controls" id="controls" hidden>
        <div class="field field-search">
          <label for="q">Search</label>
          <input type="search" id="q" name="q" autocomplete="off" placeholder="Name, family, or county">
        </div>
        <fieldset class="field segmented">
          <legend>Status</legend>
          <label><input type="radio" name="status" value="" checked><span>All ${plants.length}</span></label>
          <label><input type="radio" name="status" value="E"><span>Endangered ${nE}</span></label>
          <label><input type="radio" name="status" value="T"><span>Threatened ${nT}</span></label>
        </fieldset>
        <div class="field">
          <label for="habitat">Habitat</label>
          <select id="habitat" name="habitat">
            <option value="">Any habitat</option>
            ${HABITATS.map((h) => `<option>${esc(h)}</option>`).join('\n            ')}
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
            <option value="bloom">Flowering time</option>
          </select>
        </div>
        <label class="check"><input type="checkbox" id="now" name="now"> <span id="now-label">In flower this month</span></label>
      </form>
      <p class="count" id="count" aria-live="polite">${plants.length} plants</p>
      <ul class="entries" id="entries">
${rows}
      </ul>
      <div class="empty" id="empty" hidden>
        <p>No plants match these filters.</p>
        <button type="button" id="clear">Clear filters</button>
      </div>
    </section>`;

  return layout(site, {
    title: `Federally listed plants of Alabama | ${site.title}`,
    description: `The ${plants.length} plants in Alabama protected under the federal Endangered Species Act, with descriptions, flowering times, counties, and references.`,
    rel: './',
    canonical: '',
    body,
    current: 'plants',
  });
}

function renderPlant(site, plants, i) {
  const p = plants[i];
  const prev = plants[(i - 1 + plants.length) % plants.length];
  const next = plants[(i + 1) % plants.length];
  const rel = '../../';
  const st = STATUS[p.status];

  let photo;
  if (p.image) {
    photo = `          <figure class="photo" data-photo>
            <img src="${esc(p.image.full)}" alt="${esc(p.image.alt)}" width="${p.image.w}" height="${p.image.h}" decoding="async" referrerpolicy="no-referrer">
            <p class="photo-fallback" hidden>The photo could not be loaded from fws.gov.  <a href="${esc(p.image.page)}" rel="noopener noreferrer">See it on the Fish &amp; Wildlife Service site.</a></p>
            <figcaption>${prose(p.image.caption)}  Photo: ${esc(p.image.credit)}.  ${esc(p.image.license)}.  <a href="${esc(p.image.page)}" rel="noopener noreferrer">Original at fws.gov</a></figcaption>
          </figure>`;
  } else {
    const elsewhere = p.photoElsewhere
      ? `  <a href="${esc(p.photoElsewhere.url)}" rel="noopener noreferrer">${esc(p.photoElsewhere.label)}.</a>`
      : `  The <a href="${esc(p.refs[0].url)}" rel="noopener noreferrer">Fish &amp; Wildlife Service profile</a> is the best place to look for one.`;
    photo = `          <div class="photo-missing">
            <p>No photo here yet.  This site only shows photos that are in the public domain or openly licensed, and none has been found for this plant.${elsewhere}</p>
          </div>`;
  }

  const facts = [
    ['Federal status', `${statusTag(p)}`],
    ['Listed', `${longDate(p.listedDate)} <span class="cite">(${esc(p.fr)})</span>`],
    ['Kind of plant', esc(p.group)],
    ['Family', esc(p.family)],
    p.otherNames.length ? ['Also called', p.otherNames.map((n) => (/^[A-Z][a-z]+ [a-z]/.test(n) ? sci(n) : esc(n))).join(', ')] : null,
    ['Flowering', `${bloomStrip(p)}<span class="bloom-note">${esc(p.bloomNote)}</span>`],
    ['Habitat', esc(p.habitatType)],
    ['Alabama counties', esc(p.counties.join(', '))],
    ['Whole range', esc(p.range)],
  ].filter(Boolean).map(([k, v]) => `          <div><dt>${k}</dt><dd>${v}</dd></div>`).join('\n');

  const refs = p.refs.map((r) => `          <li><a href="${esc(r.url)}" rel="noopener noreferrer">${esc(r.label)}</a> <span class="host">${esc(host(r.url))}</span></li>`).join('\n');
  const general = site.sources.filter((s) => ['fws-al', 'cfr', 'eoa'].includes(s.id))
    .map((s) => `          <li><a href="${esc(s.url)}" rel="noopener noreferrer">${esc(s.label)}</a> <span class="host">${esc(host(s.url))}</span></li>`).join('\n');

  const body = `    <article class="plant">
      <p class="crumbs"><a href="${rel}">All plants</a></p>
      <header class="plant-head">
        <h1>${esc(p.common)}</h1>
        <p class="sci">${sci(p.scientific)}</p>
        <p class="lede">${prose(p.summary)}</p>
      </header>
      <div class="plant-body">
        <div class="plant-text">
${photo}
          <h2>What it looks like</h2>
          <p>${prose(p.description)}</p>
          <h2>Where it grows</h2>
          <p>${prose(p.habitat)}</p>
          <h2>In Alabama</h2>
          <p>${prose(p.alabama)}</p>
          <h2>Why it is at risk</h2>
          <p>${prose(p.threats)}</p>
${p.notes ? `          <h2>Notes</h2>\n          <p>${prose(p.notes)}</p>\n` : ''}          <h2>References</h2>
          <ul class="refs">
${refs}
          </ul>
          <p class="refs-general">Used for every entry:</p>
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
      <nav class="pager" aria-label="More plants">
        <a href="${rel}plants/${prev.slug}/" rel="prev"><span>Previous</span> ${esc(prev.common)}</a>
        <a href="${rel}plants/${next.slug}/" rel="next"><span>Next</span> ${esc(next.common)}</a>
      </nav>
    </article>`;

  return layout(site, {
    title: `${p.common} (${p.scientific}) | ${site.title}`,
    description: `${p.common}, ${plain(p.scientific)}: federally ${st.sentence} in Alabama.  ${plain(p.summary)}`,
    rel,
    canonical: `plants/${p.slug}/`,
    body,
    current: '',
  });
}

function renderAbout(site, plants, template) {
  const nE = plants.filter((p) => p.status === 'E').length;
  const nT = plants.filter((p) => p.status === 'T').length;
  const sources = site.sources.map((s) => `        <li><a href="${esc(s.url)}" rel="noopener noreferrer">${esc(s.label)}</a> <span class="host">${esc(host(s.url))}</span><br>${esc(s.use)}</li>`).join('\n');
  const credits = plants.filter((p) => p.image).map((p) => `        <li><a href="../plants/${p.slug}/">${esc(p.common)}</a>: ${esc(p.image.credit)}.  ${esc(p.image.license)}.  <a href="${esc(p.image.page)}" rel="noopener noreferrer">Original</a></li>`).join('\n');
  const missing = plants.filter((p) => !p.image).map((p) => `<a href="../plants/${p.slug}/">${esc(p.common)}</a>`);

  const fill = {
    count: plants.length,
    endangered: nE,
    threatened: nT,
    reviewed: longDate(site.reviewed),
    repoUrl: esc(site.repoUrl),
    issuesUrl: esc(`${site.repoUrl}/issues`),
    sources,
    credits,
    withPhotos: plants.filter((p) => p.image).length,
    missingPhotos: oxford(missing),
    missingCount: missing.length,
  };
  const body = template.replace(/\{\{(\w+)\}\}/g, (m, key) => {
    if (!(key in fill)) throw new Error(`about.html uses an unknown placeholder: ${m}`);
    return fill[key];
  });

  return layout(site, {
    title: `About and sources | ${site.title}`,
    description: 'What this site covers, where its information comes from, and what it does not claim.',
    rel: '../',
    canonical: 'about/',
    body,
    current: 'about',
  });
}

function render404(site) {
  const body = `    <section class="hero">
      <div class="hero-text">
        <h1>Page not found</h1>
        <p class="lede">Nothing lives at this address.  The plant you want may have moved, so try the full list.</p>
        <p><a href="${site.basePath}">See all plants</a></p>
      </div>
    </section>`;
  return layout(site, {
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
  const plants = JSON.parse(await readFile(path.join(ROOT, 'data/plants.json'), 'utf8'));
  plants.sort((a, b) => a.common.localeCompare(b.common));

  const problems = validate(plants, site);
  if (problems.length) {
    console.error(`Data problems (${problems.length}):\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  const nE = plants.filter((p) => p.status === 'E').length;
  console.log(`Data OK: ${plants.length} plants (${nE} endangered, ${plants.length - nE} threatened), ${plants.filter((p) => p.image).length} with photos.`);
  if (validateOnly) return;

  await rm(OUT, { recursive: true, force: true });
  await mkdir(path.join(OUT, 'assets'), { recursive: true });
  await mkdir(path.join(OUT, 'about'), { recursive: true });

  const write = async (file, content) => {
    const full = path.join(OUT, file);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  };

  await write('index.html', renderIndex(site, plants));
  for (let i = 0; i < plants.length; i += 1) {
    await write(`plants/${plants[i].slug}/index.html`, renderPlant(site, plants, i));
  }
  const aboutTemplate = await readFile(path.join(ROOT, 'src/about.html'), 'utf8');
  await write('about/index.html', renderAbout(site, plants, aboutTemplate));
  await write('404.html', render404(site));

  for (const f of ['styles.css', 'app.js', 'favicon.svg']) {
    await copyFile(path.join(ROOT, 'src', f), path.join(OUT, 'assets', f));
  }

  // Tell GitHub Pages to serve the folder as it is, without running Jekyll.
  await write('.nojekyll', '');
  await write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${site.siteUrl}sitemap.xml\n`);
  const urls = ['', 'about/', ...plants.map((p) => `plants/${p.slug}/`)];
  await write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(site.siteUrl + u)}</loc><lastmod>${site.reviewed}</lastmod></url>`).join('\n')}\n</urlset>\n`);

  console.log(`Built ${urls.length + 1} pages in docs/.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
