# GitHub

*[Français](../fr/github.md)*

A Feuillet project can be linked to a GitHub repository, as on Overleaf: you
push your changes to GitHub and pull those made there. GitLab, Gitea and
Forgejo work the same way.

## Connecting

The **GitHub** button, at the top of the editor, opens the sync window. The
first time, **Connect to GitHub** has you authorize Feuillet on GitHub; you
may also give a personal access token. The token is encrypted and kept in
your browser; Feuillet's server does not keep it. If GitHub refuses an
expired or revoked token, Feuillet says so and asks for another one
(**Change token**).

## Linking a project to a repository

- **Create a new repository**: give its name, a description if you wish,
  choose **Private** or **Public**, then **Create repository and push**.
- **Use an existing repository**: choose the repository and the branch, then
  **Link repository and pull**.

To create a project from a repository, use **Import** in the project list
instead.

Feuillet brings in the repository's whole history, with the same commits as
on GitHub. For a long history, the window shows how far it is (commits, then
files): count about a minute for 300 commits. GitHub limits how many
requests each account makes, per minute and per hour; Feuillet stays below,
and if the limit is reached anyway, it says at what time to try again.

## Pushing and pulling

Once the project is linked, the window tells where it stands: files changed
since the last commit, commits not yet on GitHub, changes on GitHub not yet
in the project.

- **Push to GitHub** makes a commit with your message and pushes it. If
  GitHub received other changes in the meantime, they are merged first. The
  commit names you with the **Git commit email** of your profile; your
  GitHub noreply address links it to your GitHub account without showing
  your address.
- **Pull from GitHub** merges GitHub's changes into the project. When the
  same lines changed on both sides, Feuillet shows the conflicts to resolve;
  you may also cancel the merge.

Every file of the repository is kept as it is, binary files, executables,
`.gitignore` and the `.github` folder included. Three kinds of entries stay
on GitHub without being in the project; the GitHub window names them, under
**On GitHub, not in the project**:

- a **submodule** shows as an empty folder. Feuillet keeps the commit it
  points to, and updates it when it changes on GitHub, but does not have its
  files: a compile in Feuillet does not have them;
- a file kept with **Git LFS** is only its pointer, a few lines of text; an
  LFS image therefore shows empty. A file put in its place in Feuillet is
  pushed without LFS;
- a **symbolic link** does not show.

Pushes from Feuillet leave them as they are on GitHub.

By default, comments and tracked changes do not go to GitHub: only the text
is pushed, as it would be once the changes are accepted.

The **Git history** tab, on the left, shows the commits and their
differences. **Unlink repository** undoes the link without touching the
project or its history.

## Working on a branch

To have changes reviewed before they reach the main branch, as is done with
GitHub, the **Branch** section of the GitHub window tells which branch the
project is on (it is GitHub's alone).

1. **Work on a new branch**: give it a name (Feuillet offers one, such as
   `feuillet-2026-11-06`), then **Create the branch and follow it**. The
   branch starts from the current branch on GitHub. The files do not change;
   the next pushes go to the new branch.
2. Edit the project and push your changes as usual.
3. **Open a pull request**: give a title and a description; what is not on
   GitHub yet is pushed to the branch first. Your coauthors review the pull
   request on GitHub, comment on it and merge it there. A box marks it as a
   draft. The section then shows the pull request's state, with a link to
   it.
4. Once the pull request is merged, **Go back to main** (or the branch it
   went into) puts the project back on that branch: its files become the
   branch's, which now holds your changes. What you wrote after the pull
   request, and is not on GitHub yet, comes along: Feuillet merges it with
   the files of main, and you push it to main when it is ready.

**Switch to another branch** does the same with any branch of the
repository, a coauthor's for instance. What is not on GitHub yet is pushed
first to the branch being left, so that nothing is lost; then the project's
files become those of the other branch.

### A branch deleted on GitHub

Many repositories delete the branch of a pull request as soon as it is
merged (the *Automatically delete head branches* option), and a coauthor may
delete one too. Feuillet does not quietly make it again at the next push:
the GitHub button shows a dot, and the window says the branch no longer
exists. Nothing is lost, and two choices are offered:

- **Go back to main** (or to another branch): your changes that were not on
  GitHub come along, merged with the files of that branch, and you push them
  then.
- **Make it again on GitHub**: the branch comes back, with everything the
  project has since, and the project keeps following it.

The branch is the project's, not only yours: when you change it, the files
change for every collaborator, and those who linked the repository from
their browser follow the same branch. Comments and tracked changes stay
attached to the text that does not change.

## Compiling on GitHub at each push

For the repository to always have an up-to-date PDF, changes made outside
Feuillet included, the **Compile on GitHub at each push** section adds a
GitHub Actions file to the repository, `.github/workflows/feuillet.yml`. It
compiles the project as Feuillet does: same main document, engine and year
of TeX Live (TeX Live's official Docker images), glossaries and
nomenclatures included.

- **Add the file on GitHub** writes it on the linked branch; it then comes
  into the project like any change made on GitHub.
- Each push and each pull request starts a compile, in the repository's
  **Actions** tab. The PDF is in each run, under **Artifacts**. A compile
  error shows as a failed check on the pull request.
- When the project's main document, engine or TeX Live change, the section
  offers to **update the file**. A file of that name that Feuillet did not
  make is left as it is.

GitHub accepts this file only from a token that has the **workflow** scope
as well as **repo**. Otherwise it refuses it and nothing changes in the
project; the section then offers to **change the token**, and the token
creation link ticks both scopes.

## Publishing a release

Once the project is linked, the **Publish a release on GitHub** section of
the GitHub window makes a release: a tag on the repository's latest commit,
with the project's PDF attached, compiled then and there with TeX Live. It is
what GitHub shows under **Releases**, and what one cites or sends.

- The suggested **Tag** follows the latest one (`v2` after `v1`, `1.4` after
  `1.3`); the **Title** and **Notes** are yours.
- The project must be up to date with GitHub: push and pull first, so that
  the PDF is made of what the release points to.
- **Pre-release** marks it so on GitHub; one may also publish without the
  PDF.
- The PDF goes through Feuillet's server, which GitHub takes it from when the
  browser cannot send it: you must be signed in to a Feuillet account. The
  server hands the PDF and the token to GitHub without keeping them. If GitHub
  refuses the PDF, nothing is published.
- The token must be allowed to write to the repository: the `repo` access
  (the one **Connect to GitHub** asks for), or **Contents: write** for a
  fine-grained token.

If the repository is linked to [Zenodo](https://zenodo.org/account/settings/github/),
each published release is archived there and receives a DOI, to cite for a
thesis, a report or a preprint.

## Working on your computer

To work on your computer, with your usual tools or with
[Claude Code](claude.md), clone the project itself with [Git](git.md): the
**Git** button, at the top of the editor, gives its command, and the GitHub
window leads there too (**Work on it on your computer**, **Clone with
Git**). Your pushes go straight into the project; **Push to GitHub** then
sends them to GitHub, like any other change.

The two are separate: the GitHub repository and Feuillet's Git repository
each have their own history. A clone therefore pushes to where it came
from; Feuillet refuses the pushes of a clone of the GitHub repository.

For a project kept only in your browser, without the server, the window
gives the GitHub repository's `git clone` command instead: clone it, push
your commits to GitHub, then **Pull from GitHub** in Feuillet.

## An "Open in Feuillet" badge

In a public repository's `README.md`, this badge lets anyone open it in
Feuillet in one click (replace `OWNER/REPO`):

```markdown
[![Open in Feuillet](https://feuillet.slashbin.net/badges/open-in-feuillet.svg)](https://feuillet.slashbin.net/docs?snip_uri=https://github.com/OWNER/REPO/archive/HEAD.zip)
```

The badge looks like this: ![Open in Feuillet](../../public/badges/open-in-feuillet.svg).
For French readers, use `badges/ouvrir-dans-feuillet.svg`.

Feuillet shows what the link holds, then creates the project, named after
the repository, when asked; one signs in first if needed. The project is a
**copy** of the repository, not linked to it: to push your changes to the
repository, import it from GitHub instead (**Import** in the project list)
or link a project to the repository (see above).

- `HEAD` takes the default branch; for another branch, write
  `archive/refs/heads/BRANCH.zip`.
- Feuillet's server downloads the archive without your GitHub token: the
  badge only works for a public repository.
- The link follows the "Open in Overleaf" format: other options (LaTeX code
  in the link, several files, engine, main document) are described in
  [Open in Feuillet](getting-started.md#open-in-feuillet).
