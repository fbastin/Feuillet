# Feuillet guide

*[Français](../fr/README.md)*

Feuillet is an online collaborative LaTeX editor in the spirit of Overleaf,
linked to GitHub, that you install on your own server (see
[Running your own server](hosting.md)).

It comes from [TeXlyre](https://texlyre.org) and keeps its editor: LaTeX
and Typst, a visual editor, spell checking, formulas, diagrams. It adds a
server that keeps projects and accounts, with sharing, review, versions,
compiling with TeX Live, GitHub sync, Git and working with Claude.

The interface is in French or English, as chosen in the settings; this
guide names the buttons as they read in English. Its examples write the
server's address `feuillet.example.org`: replace it with yours.

## Contents

1. [Getting started](getting-started.md): account, projects, "Open in
   Feuillet" links, editor, compiling.
2. [Collaborating](collaborating.md): sharing a project, inviting, roles,
   seeing who works where, chat.
3. [Review](review.md): comments, tracked changes, accepting or rejecting.
4. [Versions](versions.md): the project's history, labels, comparing,
   restoring.
5. [GitHub](github.md): linking a project to a repository, pushing, pulling,
   working on a branch and opening a pull request, compiling on GitHub at
   each push, publishing a release with its PDF, working on your computer, an "Open in
   Feuillet" badge for a README.
6. [Git](git.md): cloning a project with Git, pulling and pushing, without
   GitHub.
7. [Claude](claude.md): letting Claude read, compile, comment on and suggest
   changes to your projects.
8. [Account and privacy](account.md): devices, password, deleting, what the
   server keeps.
9. [Running your own server](hosting.md): what you need, installing,
   settings, updating.

## What comes from TeXlyre

These features are described in
[TeXlyre's documentation](https://texlyre.org/docs/intro): Typst, language
servers (LSP), the bibliography with Zotero and OpenAlex, draw.io and TikZ
diagrams, the MathLive formula editor, themes and editing keybindings (Vim,
Emacs).

In Feuillet, collaboration goes through Feuillet's server rather than
peer to peer, so TeXlyre's pages on collaboration, file sharing and hosting
do not apply; to host Feuillet, see [Running your own server](hosting.md).

## A question, a problem?

Open an issue on [GitHub](https://github.com/fbastin/Feuillet/issues).
