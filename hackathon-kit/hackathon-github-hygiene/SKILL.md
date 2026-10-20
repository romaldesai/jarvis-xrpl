---
name: hackathon-github-hygiene
description: Repo, commit, secret-scanning, personal-info and release hygiene for a time-boxed hackathon where the commit history is judged. Use when setting up the repo, before every push, when flipping a repo public, and when tagging the final submission. Generic checklists only.
---

# Hackathon GitHub hygiene

The commit history after the window opens is evidence. Keep it honest, small-step and clean, and
keep every secret and every piece of personal information out of the repository, permanently.

## The window clock

- Window: **Saturday Oct 24, 8:30 AM ET to Sunday Oct 25, 8:00 PM ET.** Only work done inside it is
  judged, so the XRPL feature is built inside it and nowhere else.
- Before every commit, check the time in the event's time zone (`TZ=America/New_York date`).
- **Before 8:30 AM Saturday:** only docs, templates and tooling that is not the feature. No policy
  engine, no XRPL client code, no escrow code.
- **During the window:** all feature work. **After the freeze point** (set it with the owner),
  Sunday is stretch only, and the cut list decides what gets dropped.
- Cut list, first to go: Ledger, then Credentials, then on-chain kill switch, then stable-coin.
- Never backdate, rewrite or fake timestamps. Do not rebase, squash, amend or force-push anything
  that was already pushed during the window.

## Repo setup (one time, before the window)

- Repo is **private until the owner flips it public** at the start of the window. Do not make it
  public yourself, and never touch the owner's other repositories.
- Files: MIT `LICENSE`, `.gitignore`, `.env.example` (placeholders only), `README.md` that will
  run from a clean clone, `hackathon-kit/` (this kit).
- `.gitignore` must cover at least: `.env`, `.env.*` (but keep `.env.example`), `*.seed`, `*.key`,
  `*.pem`, `node_modules/`, the audit log (`audit.jsonl`), any wallet or key export, and local
  editor/agent settings.
- Commit identity for builder commits is a non-personal identity (for example the bot `noreply`
  address). Never use a personal email in this repo's history.

## Commit conventions

- Small and frequent: a commit whenever something works and the suite is green, roughly every
  20 to 45 minutes of real progress. A reviewer scrolling the history should see a story.
- One purpose per commit. Imperative subject under about 70 characters, with a type prefix:
  `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`. The body says *why*, and what was
  verified (for example "suite green; live testnet tx confirmed").
- Add the co-author trailer for builder commits:
  `Co-Authored-By: Claude <noreply@anthropic.com>`
- Do **not** put session links, chat links, names, emails, school or location details, or any
  private context in commit messages, PR text, issues or code comments.
- Work on `main` directly (single builder, linear history) unless the owner asks for branches.
  Push after every green commit so history is visible and nothing is lost.

## Secret hygiene

Never commit seeds, keys, tokens, passwords or connection strings. Real values live only in a local
`.env`. Placeholders look like `YOUR_..._HERE` or `REPLACE_ME`.

**Pre-push scan** (a script run by a git hook and again by CI, because local hooks do not travel
with a clone). It scans the staged diff and the whole tree for:

- XRPL family seeds (base58, 29 characters, starting with `s`; Ed25519 seeds start `sEd`) and
  64-character hex strings that could be raw private keys
- `-----BEGIN ... PRIVATE KEY-----` blocks
- Anthropic keys (`sk-ant-`), GitHub tokens (`ghp_`, `gho_`, `ghs_`, `github_pat_`), Neon keys
  (`napi_`), generic `postgres://user:password@` URLs, bearer-token headers, UUID-shaped tokens
- personal information: email addresses, phone numbers, street addresses, dates of birth,
  GPA or school identifiers (warn, then a human decides)
- binary and image files that are not obviously safe (screenshots can contain revealed secrets)

Lines containing a placeholder marker are allowed. Any other hit blocks the push, prints the file
and line (never the matched value), and exits non-zero.

**If a secret is ever committed or pasted anywhere:** stop pushing, treat it as burned, rotate it
immediately at the provider, and tell the owner. Do not rewrite history on your own: ask first.

## Personal information

The public repo contains no address, phone number, date of birth, email, grades, school details,
or anything else personal. This applies to files, docs, screenshots, demo recordings, audit logs,
test fixtures, example data and git metadata. Use fake names, testnet addresses and generic text.
Before the repo is flipped public, check the commit author and committer emails in the history:
anything personal there is visible too, so use the platform's private no-reply email setting.

## Flipping the repo public (owner does this)

Checklist before the flip:
1. Full-history secret scan is clean. No personal information anywhere, including author emails.
2. `LICENSE`, `README.md`, `.env.example` present. Description and topics set.
3. Clean-clone test passes (below).
4. Confirm the owner will flip it at 8:30 AM Saturday, and do not do XRPL feature work earlier.

## Release hygiene

- The final submission is **one tagged commit**: `v1.0-submission`. Push the tag, and put the
  commit hash in the submission form.
- **Clean-clone test** (do it twice: once mid-Sunday, once after the final commit):
  1. fresh empty directory, `git clone` the public URL, from a logged-out browser if possible
  2. copy `.env.example` to `.env`, fill testnet values only
  3. install exactly as the README says, run the tests, run the one-command demo
  4. note the wall-clock time; every README step must work as written
- After the tag, only fix typos in docs, and say so in the commit message. No feature changes.

## Time-box and cut-list enforcement

- At the start of each work block, write the block's single goal and its deadline in the commit
  log of the previous block or in a scratch note (not in the repo).
- At each checkpoint ask: is the core flow working end to end on testnet? If no, cut from the
  cut list rather than adding scope.
- Stop adding features at the freeze point. After it: bug fixes, README, visuals, rehearsal.
