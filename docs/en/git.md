# Git

*[Français](../fr/git.md)*

A Feuillet project can be cloned with Git, as on Overleaf, without going
through GitHub: you work on it on your computer, with your usual tools or
with [Claude Code](claude.md), and what you push appears in Feuillet at
once, for your collaborators too.

## A Git token

Git does not take your Feuillet password: it asks for a Git token. In your
profile (**Profile Settings**, in your account menu), the **Git** tab makes
one: say what it is for if you wish (*My laptop*), give your password, then
**Make a Git token**. Copy it at once: it is shown only once.

Git asks for it as the password, the first time you clone, pull or push.
Git for Windows and Git on macOS then keep it for you. Elsewhere, keep it in
your password manager, or run this command once so that Git keeps it,
unencrypted, in `~/.git-credentials`:

```
git config --global credential.helper store
```

The tab lists your tokens, with when they were made and last used; **Delete**
takes one back, and Git can no longer use it. Changing your password deletes
them all. An account has ten at most.

## Cloning

The **Git** button, at the top of the editor, gives the project's
`git clone` command, with your account name in the address. Run it in a
terminal; when Git asks for a password, give your Git token.

```
git clone -c user.name="alice" -c user.email="alice@example.org" https://alice@feuillet.slashbin.net/collab/git/<project> "Thesis"
```

The project's owner and its editors clone, pull and push; its reviewers and
readers clone and pull. Git is for the collaborators invited by name: a
link alone does not give it.

## Pulling and pushing

`git pull` brings the changes made in Feuillet since your last pull, as a
commit **Update from Feuillet**, with the names of those who made them.
`git push` sends your commits: their changes go into the project at once,
under **Git (your name)** in its [history](versions.md).

- Pull before you push: a push is refused when the project changed in
  Feuillet since your last pull. Feuillet takes no forced push.
- Only the `master` branch is kept: no other branch, no tags.
- Symbolic links and submodules are refused, and so are file names with
  `< > : " | ? *`.

## What Git sees

The files hold the text as people read it: comments and tracked changes
stay in Feuillet, tracked changes as if accepted. When you push a change to
a document, the comments and tracked changes on the text you left stay where
they were. A file you delete, rename or add in Git is deleted, renamed or
added in Feuillet.

Your name in Feuillet and the author of your commits are two things. To
sign in, Git sends the account name in the address, with your token; that
is what Feuillet checks, and the project's history says **Git (your account
name)**. A commit's author is the name and address Git gives it
(`user.name` and `user.email`), which the collaborators who clone the
project see; Feuillet does not use it.

The **Git** button's command sets the clone's author: `user.name` to your
name in Feuillet, the one the commits **Update from Feuillet** carry too,
and `user.email` to your profile's **Git commit email**, if it has one, the
one pushes to [GitHub](github.md) use. You thus appear under one name and
one address. Your other repositories are left as they are. Without a Git
commit email in the profile, the address stays your Git settings' one. To
change the address of a clone already made, run in its folder:

```
git config user.email "address your collaborators may see"
```
