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

By default, comments and tracked changes do not go to GitHub: only the text
is pushed, as it would be once the changes are accepted.

The **Git history** tab, on the left, shows the commits and their
differences. **Unlink repository** undoes the link without touching the
project or its history.

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
