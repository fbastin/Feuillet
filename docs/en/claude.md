# Claude

*[Français](../fr/claude.md)*

Claude, Anthropic's assistant, can work on your Feuillet projects, under your
own Claude subscription, through the **Feuillet connector**: it reads and
searches projects, compiles, comments and suggests changes, as far as your
role in each project allows. Its changes arrive as
[tracked changes](review.md), under its name, which you accept or reject.

## Connecting Claude

The connector's address is:

```
https://feuillet.slashbin.net/collab/mcp
```

You also find it in your profile, **Assistants** tab, or through **Connect
Claude** in your account menu.

- **In Claude (web or desktop app)**: open the settings, then the
  connectors, choose "Add custom connector" and paste the address. Claude
  then asks you to sign in with your Feuillet username and password, and to
  allow access.
- **In Claude Code**: in a terminal, run

  ```
  claude mcp add --transport http feuillet https://feuillet.slashbin.net/collab/mcp
  ```

  then type `/mcp` in Claude Code to sign in.

This needs an account on Feuillet's server; a guest session has none.

## What Claude can do

- list your projects and their files, read a file, search for text in a
  project;
- list the open comments and suggested changes;
- suggest changes, as tracked suggestions; an editor may also have it change
  the text directly, unless the project tracks their changes (everyone's, or
  theirs);
- create a file;
- comment, and answer comments;
- compile the project with TeX Live and read the errors, with their file and
  line.

A reviewer lets Claude only comment and suggest; a reader, only read. The
project's versions name Claude and your account as their authors.

## Asking Claude from the editor

The **Ask Claude** button (the sparkles), in the editor's toolbar, prepares
a request about the selected passage or the project: improve the style,
correct the spelling, explain, translate, compile and fix the errors, answer
the comments, or whatever you write. The request names the project, the
file and the line.

- **Open in Claude** opens claude.ai with the request. It is also copied:
  paste it if the message box is empty.
- **Copy for Claude Code** copies it, to paste in Claude Code.

In the compile log, each error has its **Ask Claude** button too, as
Overleaf's error assist: the request, already written, names the error's
file and line and quotes its message; Claude reads the file through the
connector and proposes its fix as a suggestion.

## Disconnecting Claude

In your profile, **Assistants** tab, **Disconnect** takes away an
application's access. Changing your password or deleting your account does
too.

## Working on a local copy

For Claude Code to work on files on your computer rather than through the
connector, link the project to [GitHub](github.md), clone the repository,
push the changes, then pull them in Feuillet.
