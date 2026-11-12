# Alabama Endangered Species

A compendium of the plants and animals in Alabama that are protected under the federal Endangered Species Act.  It begins with the plants: 23 of them, 14 endangered and 9 threatened.

Each entry says what the plant looks like, where it grows, where in Alabama it is found, why it is at risk, when it flowers, and where to read more.

Once GitHub Pages is turned on, the site is served at <https://wgvisots.github.io/alabama-endangered-species/>.

## How the repository is laid out

| Path | What it holds |
| --- | --- |
| `data/plants.json` | One record per plant.  This is the file to edit. |
| `data/site.json` | The site's name, address, review date, general sources, and the hosts that photos may load from. |
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

In the repository's settings, under Pages, choose "Deploy from a branch", branch `main`, folder `/docs`.

If the site ever moves to another address, change `basePath` and `siteUrl` in `data/site.json` and rebuild.

## Editing a plant

Each record in `data/plants.json` has these fields.

| Field | Meaning |
| --- | --- |
| `slug` | The address of the page: lowercase letters, digits, and hyphens. |
| `common`, `scientific` | The names.  `scientific` is the name on the federal list. |
| `otherNames` | Other common and scientific names. |
| `status` | `E` for endangered, `T` for threatened. |
| `listedDate`, `fr` | The date the final listing rule was published, and its Federal Register citation. |
| `habitatType` | One of the five habitat groups named at the top of `build.mjs`. |
| `bloom` | The months it flowers, as numbers 1 to 12, or `null` for ferns and their allies. |
| `bloomNote` | The flowering period in words. |
| `summary`, `description`, `habitat`, `alabama`, `threats`, `notes` | The text of the entry.  Wrap a scientific name in underscores, `_Sarracenia rubra_`, to set it in italics. |
| `counties` | Alabama counties.  The build rejects a name that is not one of the 67. |
| `range` | The whole range, in a phrase. |
| `image` | A photo, or `null`.  See below. |
| `photoElsewhere` | Optional: a link to a photo that cannot be shown here. |
| `refs` | The documents the entry was written from. |

The build stops with a list of problems if a record is missing a field, names a county that does not exist, links to a page that is not `https`, or points a photo at a host that is not allowed.

## Rules the entries follow

- **Every claim comes from a cited document.**  If the sources say little, the entry says little.
- **Status comes from the federal list itself,** 50 CFR 17.12, not from a secondary source.
- **Places stop at the county or the river.**  Exact sites are left out, because rare plants are dug up by collectors.
- **The text is written fresh.**  Nothing is copied from a source.

## Photos

Only photos in the public domain or under an open license are shown, each with its credit.  At present they all come from the U.S. Fish & Wildlife Service media library and load directly from `fws.gov`.  Nothing is copied into this repository.

Eleven plants have no photo yet.  The About page of the site lists them.

To allow photos from another host, add it to `imageHosts` in `data/site.json`.  The build then permits it in the site's content security policy.

## Sources

- [Alabama Listed Plants](https://www.fws.gov/project/alabama-listed-plants), U.S. Fish & Wildlife Service, Alabama Ecological Services Field Office
- [50 CFR 17.12, List of Endangered and Threatened Plants](https://www.ecfr.gov/current/title-50/chapter-I/subchapter-B/part-17)
- [Endangered and Threatened Plants of Alabama](https://encyclopediaofalabama.org/article/endangered-and-threatened-plants-of-alabama/), Encyclopedia of Alabama
- The species profiles, recovery plans, status assessments, and five-year reviews linked from each entry

The entries were last checked against these on November 12, 2026.  Listings change.

## Security

See [SECURITY.md](SECURITY.md).

## License

No license has been chosen yet.  Until one is added, the usual copyright rules apply to the text and code here.  The photos are not part of this repository and keep the terms given in their credits.
