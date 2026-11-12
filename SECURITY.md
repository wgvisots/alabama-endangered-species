# Security

## Reporting a problem

If you find a security problem with this site or repository, please report it privately.  Use "Report a vulnerability" under the repository's Security tab if it is offered.  If it is not, open an issue that says only that you have something to report, and leave the details out until you have been contacted.

Mistakes of fact are not security problems.  Open an ordinary issue for those.

## What there is to attack

Very little, by design.  The site is a folder of static files.

- It has no server-side code, no database, no accounts, and no forms that send anything anywhere.
- It sets no cookies and runs no analytics.
- It loads no scripts, styles, or fonts from any other site.
- The build has no dependencies, so there is no package supply chain to poison.
- The repository runs no GitHub Actions workflows of its own.

## What the pages enforce

Every page carries a content security policy that the build writes:

```
default-src 'none'; img-src 'self' https://www.fws.gov; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'
```

In plain terms: nothing loads unless it is named.  Scripts and styles come only from this site, and none may be written inline.  Images come only from this site and from the photo hosts listed in `data/site.json`.

Beyond the policy:

- The build refuses any photo whose address is not on an allowed host, and any reference link that is not `https`.  The one exception is the Alabama Plant Atlas, which was only confirmed over `http`.
- All text from the data files is escaped before it is written into a page.
- Links to other sites carry `rel="noopener noreferrer"`, and the pages ask browsers to send no referrer.

GitHub Pages does not let a site set its own response headers, so the policy is delivered in a `meta` tag.  That is why it cannot include `frame-ancestors`, which browsers honor only as a header.

## Settings worth keeping on

These live in the repository's settings on GitHub, not in the files here.

- Secret scanning and push protection.
- A ruleset on `main` that blocks force pushes and deletion.
- Private vulnerability reporting.
- Two-factor authentication on the owner's account.
