# Alabama Endangered Species

A compendium of the plants and animals in Alabama that are protected under the federal Endangered Species Act.  It covers mammals, birds, reptiles, amphibians, fishes, mussels, snails, crustaceans, insects, and plants.

Each entry says what the species looks like, where it lives, where in Alabama it is found, why it is at risk, and where to read more.

The site is served at <https://wgvisots.github.io/alabama-endangered-species/>.

## How the repository is laid out

| Path | What it holds |
| --- | --- |
| `data/plants.json`, `data/mussels.json`, and the rest | One file for each group, with one record per species.  These are the files to edit. |
| `data/site.json` | The site's name, address, review date, groups, general sources, and the hosts that photos may load from. |
| `src/` | The stylesheet, the script, the icon, and the text of the About page. |
| `src/images/` | Pictures kept in the repository: public-domain drawings, and any photo that is not loaded from another site. |
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

## The four kinds of entry

Each group's page keeps these apart.

- **Listed, and found in Alabama.**  The ordinary case: status `E`, `T`, or `XN`.
- **Listed only for its likeness to another species.**  Status `SAT`.  The species is not in danger itself.
- **Proposed for listing.**  Status `P` or `PE`.  A proposal protects nothing until a final rule follows, and the pages say so.
- **Listed, but thought to be gone from Alabama.**  Set `"presence": "historical"`.

When a proposed species is listed, change its `status`, replace `proposedDate` with `listedDate`, and put the final rule's citation in `fr`.

## Editing an entry

Each record has these fields.

| Field | Meaning |
| --- | --- |
| `slug` | The address of the page: lowercase letters, digits, and hyphens. |
| `common`, `scientific` | The names.  `scientific` is the name on the federal list. |
| `nameInText` | Optional.  The common name as it reads in the middle of a sentence, when the build would get it wrong.  The build lowercases the first letter unless the name begins with a place or a person. |
| `otherNames` | Other common and scientific names. |
| `kind`, `family` | What sort of plant or animal it is, and its family. |
| `status` | `E` endangered, `T` threatened, `SAT` threatened by similarity of appearance, `XN` experimental population, `P` proposed threatened, `PE` proposed endangered. |
| `listedDate`, `fr` | For a listed species: the date the final listing rule was published, and its Federal Register citation, such as `58 FR 14330`. |
| `proposedDate`, `fr` | For a proposed species: the date of the proposal, and how to cite it. |
| `presence` | Optional.  `historical` for a listed species that once lived in Alabama and is not known here today. |
| `habitatType` | A short phrase.  For plants it must be one of the habitat groups named in `data/site.json`. |
| `season` | The months to look for it, as numbers 1 to 12: flowering for a plant, flight for an insect, nesting for a sea turtle.  `null` where that does not apply or no source gives months. |
| `seasonNote` | The season in words. |
| `seasonShort` | Optional.  A few words to show in the list when `season` is `null`. |
| `summary`, `habitat`, `alabama`, `threats` | The required text of the entry. |
| `description`, `life`, `notes` | Optional text.  Leave `description` out when no source describes the species; do not write one from memory. |
| `counties` | Alabama counties.  The build rejects a name that is not one of the 67. |
| `waters` | Optional.  The river systems it lives in, from the list in `data/site.json`.  The fish, mussel, and snail pages can be narrowed by these. |
| `countiesText` | Required when `counties` and `waters` are both empty.  When `counties` is empty, it is shown in their place: `All 67`, or `Paint Rock River`. |
| `range` | The whole range, in a phrase. |
| `image` | A photo or a drawing, or `null`.  See below. |
| `photoElsewhere` | Optional: a link to a photo that cannot be shown here. |
| `refs` | The documents the entry was written from. |

In any text field, wrap a scientific name in underscores, `_Sarracenia rubra_`, to set it in italics.

The build stops with a list of problems if a record is missing a field, names a county or river system that does not exist, links to a page that is not `https`, or points a photo at a host that is not allowed.

## Adding a group

Add a data file, then describe the group in the `groups` list of `data/site.json`: its name, its nouns, the headings and labels its pages use, whether its list has filters, an optional note, and its general sources.  The build makes the group's list page, its entry pages, its place in the contents, and its link in the header.

## Rules the entries follow

- **Every claim comes from a cited document.**  If the sources say little, the entry says little.
- **Status comes from the federal list itself,** 50 CFR 17.11 and 17.12, not from a secondary source.  Proposals come from the Service's list of species proposed for listing.
- **Places stop at the county, the river, or the creek.**  Exact sites, and the names of caves and most springs, are left out, because rare species are taken by collectors.
- **The text is written fresh.**  Nothing is copied from a source.

## Photos and drawings

Only pictures in the public domain or under an open license are shown, each with its credit.  They come two ways.

- **Photos loaded from another site.**  At present these all come from the U.S. Fish & Wildlife Service media library and load directly from `fws.gov`.  `thumb` and `full` are `https` addresses, and `w` and `h` give the size of the original.
- **Pictures kept here.**  Put two JPEG or PNG files in `src/images/`, one about 650 pixels on its long side and one about 1,300, with lowercase names such as `black-rail-audubon-650.jpg`.  `thumb` and `full` are the two file names.  The build reads the size from the file, so leave `w` and `h` out.

An `image` record has these fields.

| Field | Meaning |
| --- | --- |
| `thumb`, `full` | The small and large versions, as above. |
| `kind` | Optional.  `drawing` for a plate or figure; the page then says "Drawing" where it would say "Photo". |
| `page` | The page the picture came from. |
| `source` | Optional.  How to name that page in the link under the picture, such as `the National Gallery of Art`.  Without it the link gives the site's address. |
| `alt` | What the picture shows, for readers who cannot see it. |
| `caption` | A sentence for under the picture.  For a drawing, give the title of the plate, the work it comes from, and the year. |
| `credit` | Who made it, and for a scan, the library or museum that holds it. |
| `license` | `Public domain`, or the name of the open license. |

Many entries have no picture yet, and no mussel or snail has one.  The About page of the site gives the count for each group.

To allow photos from another host, add it to `imageHosts` in `data/site.json`.  The build then permits it in the site's content security policy.

## Sources

- [Alabama Listed Plants](https://www.fws.gov/project/alabama-listed-plants) and [Species Point of Contact in Alabama](https://www.fws.gov/project/species-point-contact-alabama), U.S. Fish & Wildlife Service
- [50 CFR Part 17](https://www.ecfr.gov/current/title-50/chapter-I/subchapter-B/part-17), the Lists of Endangered and Threatened Wildlife and Plants
- [Species Proposed for Listing](https://ecos.fws.gov/ecp0/reports/ad-hoc-species-report?status=P&header=Species+Proposed+for+Listing&fleadreg=on&fstatus=on&finvpop=on), U.S. Fish & Wildlife Service
- [Endangered and Threatened Plants of Alabama](https://encyclopediaofalabama.org/article/endangered-and-threatened-plants-of-alabama/) and [Endangered and Threatened Animal Species of Alabama](https://encyclopediaofalabama.org/article/endangered-and-threatened-animal-species-of-alabama/), Encyclopedia of Alabama
- [Outdoor Alabama](https://www.outdooralabama.com/), the Alabama Department of Conservation and Natural Resources, including its [list of the state's freshwater mussels](https://www.outdooralabama.com/freshwater-mussels-alabama/alabama-freshwater-mussel-list)
- [Alabama Butterfly Atlas](https://alabama.butterflyatlas.usf.edu/)
- The species profiles, recovery plans, status assessments, five-year reviews, and listing rules linked from each entry

The entries were last checked against these on November 11, 2026.  Listings change.

## Security

See [SECURITY.md](SECURITY.md).

## License

Copyright 2026 wgvisots.

- **Written content** is licensed under the Creative Commons Attribution 4.0 International license (CC BY 4.0).  That covers the species entries in `data/`, the About page text in `src/about.html`, this README, and the pages built from them in `docs/`.  See [LICENSE-CC-BY-4.0](LICENSE-CC-BY-4.0).  A fitting credit is "Alabama Endangered Species, by wgvisots, CC BY 4.0."
- **Code** is licensed under the Apache License, Version 2.0.  That covers `build.mjs`, `src/app.js`, `src/styles.css`, and the page templates inside the build.  See [LICENSE](LICENSE).
- **Photos and drawings** are covered by neither license.  The photos load from `fws.gov` and are not part of this repository.  The drawings in `src/images/` are old plates in the public domain.  Each picture is credited where it appears.
