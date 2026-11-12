# Alabama Endangered Species

A compendium of the plants and animals in Alabama that are protected under the federal Endangered Species Act.  It is being built one group at a time.  So far it covers the plants and the insects.

Each entry says what the species looks like, where it lives, where in Alabama it is found, why it is at risk, when to look for it, and where to read more.

The site is served at <https://wgvisots.github.io/alabama-endangered-species/>.

## How the repository is laid out

| Path | What it holds |
| --- | --- |
| `data/plants.json`, `data/insects.json` | One record per species.  These are the files to edit. |
| `data/site.json` | The site's name, address, review date, groups, general sources, and the hosts that photos may load from. |
| `src/` | The stylesheet, the script, the icon, and the text of the About page. |
| `build.mjs` | Turns `data/` and `src/` into the finished site. |
| `docs/` | The finished site, which GitHub Pages serves.  Do not edit it by hand; it is rebuilt from scratch every time. |

## Building

The build needs Node 18 or newer and nothing else.  There are no packages to install.

```sh
node build.mjs             # check the data, then rebuild docs/
node build.mjs --validate  # check the data only
```

To look at the result, serve `docs/` with any static file server, for example:

```sh
python3 -m http.server --directory docs 8000
```

Commit `docs/` along with the change that produced it.

## Publishing

GitHub Pages serves the `docs/` folder of the `main` branch.  A change goes live when it is merged into `main`.

If the site ever moves to another address, change `basePath` and `siteUrl` in `data/site.json` and rebuild.

## The three kinds of entry

Each group's page keeps these apart.

- **Listed, and found in Alabama.**  The ordinary case.
- **Listed, but thought to be gone from Alabama.**  Set `"presence": "historical"`.
- **Proposed for listing.**  Set `"status": "P"`.  A proposal protects nothing until a final rule follows, and the pages say so.

## Editing an entry

Each record has these fields.

| Field | Meaning |
| --- | --- |
| `slug` | The address of the page: lowercase letters, digits, and hyphens. |
| `common`, `scientific` | The names.  `scientific` is the name on the federal list. |
| `nameInText` | Optional.  The common name as it reads in the middle of a sentence, if that differs: `monarch`, not `Monarch`. |
| `otherNames` | Other common and scientific names. |
| `kind`, `family` | What sort of plant or animal it is, and its family. |
| `status` | `E` for endangered, `T` for threatened, `P` for proposed threatened. |
| `listedDate`, `fr` | For a listed species: the date the final listing rule was published, and its Federal Register citation. |
| `proposedDate`, `fr` | For a proposed species: the date of the proposal, and how to cite it. |
| `presence` | Optional.  `historical` for a listed species that once lived in Alabama and is not known here today. |
| `habitatType` | A short phrase.  For plants it must be one of the habitat groups named in `data/site.json`. |
| `season` | The months to look for it, as numbers 1 to 12: flowering for a plant, flight for an insect.  `null` where that does not apply or no source gives months. |
| `seasonNote` | The season in words. |
| `seasonShort` | Optional.  A few words to show in the list when `season` is `null`. |
| `summary`, `description`, `habitat`, `life`, `alabama`, `threats`, `notes` | The text of the entry.  `life` and `notes` are optional.  Wrap a scientific name in underscores, `_Sarracenia rubra_`, to set it in italics. |
| `counties` | Alabama counties.  The build rejects a name that is not one of the 67. |
| `countiesText` | Required when `counties` is empty: what to show instead, such as `All 67`. |
| `range` | The whole range, in a phrase. |
| `image` | A photo, or `null`.  See below. |
| `photoElsewhere` | Optional: a link to a photo that cannot be shown here. |
| `refs` | The documents the entry was written from. |

The build stops with a list of problems if a record is missing a field, names a county that does not exist, links to a page that is not `https`, or points a photo at a host that is not allowed.

## Adding a group

Add a data file, then describe the group in the `groups` list of `data/site.json`: its name, its nouns, the headings and labels its pages use, whether its list has filters, and its general sources.  The build makes the group's list page, its entry pages, its place in the contents, and its link in the header.

## Rules the entries follow

- **Every claim comes from a cited document.**  If the sources say little, the entry says little.
- **Status comes from the federal lists themselves,** 50 CFR 17.11 and 17.12, not from a secondary source.
- **Places stop at the county or the river.**  Exact sites are left out, because rare species are taken by collectors.
- **The text is written fresh.**  Nothing is copied from a source.

## Photos

Only photos in the public domain or under an open license are shown, each with its credit.  At present they all come from the U.S. Fish & Wildlife Service media library and load directly from `fws.gov`.  Nothing is copied into this repository.

Some entries have no photo yet.  The About page of the site lists them.

To allow photos from another host, add it to `imageHosts` in `data/site.json`.  The build then permits it in the site's content security policy.

## Sources

- [Alabama Listed Plants](https://www.fws.gov/project/alabama-listed-plants) and [Species Point of Contact in Alabama](https://www.fws.gov/project/species-point-contact-alabama), U.S. Fish & Wildlife Service
- [50 CFR Part 17](https://www.ecfr.gov/current/title-50/chapter-I/subchapter-B/part-17), the Lists of Endangered and Threatened Wildlife and Plants
- [Endangered and Threatened Plants of Alabama](https://encyclopediaofalabama.org/article/endangered-and-threatened-plants-of-alabama/) and [Endangered and Threatened Animal Species of Alabama](https://encyclopediaofalabama.org/article/endangered-and-threatened-animal-species-of-alabama/), Encyclopedia of Alabama
- [Alabama Butterfly Atlas](https://alabama.butterflyatlas.usf.edu/)
- The species profiles, recovery plans, status assessments, and five-year reviews linked from each entry

The entries were last checked against these on November 11, 2026.  Listings change.

## Security

See [SECURITY.md](SECURITY.md).

## License

Copyright 2026 wgvisots.

The text and code in this repository are licensed under the Apache License, Version 2.0.  See [LICENSE](LICENSE).

The photos shown on the site are not part of this repository and are not covered by that license.  Each is in the public domain and is credited where it appears.
