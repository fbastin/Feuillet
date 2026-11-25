# Claude

*[Français](../fr/claude.md)*

Claude, Anthropic's assistant, can work on your Feuillet projects, under your
own Claude subscription, through the **Feuillet connector**: it reads and
searches projects, compiles, comments and suggests changes, as far as your
role in each project allows. Its changes arrive as
[tracked changes](review.md), under its name, which you accept or reject.

## Connecting Claude

The connector's address is the server's followed by `/collab/mcp`, for
instance:

```
https://feuillet.example.org/collab/mcp
```

You find it, exactly, in your profile, **Assistants** tab, or through **Connect
Claude** in your account menu.

- **In Claude (web or desktop app)**: open the settings, then the
  connectors, choose "Add custom connector" and paste the address. Claude
  then asks you to sign in with your Feuillet username and password (and,
  with two-factor authentication, the code of your app), and to allow
  access.
- **In Claude Code**: in a terminal, run

  ```
  claude mcp add --transport http feuillet https://feuillet.example.org/collab/mcp
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
- list the requests written for it in the documents (`\prompt`), and answer
  them.

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

## Requests in your documents

Write a request where you want Claude's work, in the document itself. Load
the `feuillet` package in the preamble, which Feuillet has on its TeX Live
server and in the browser's compilers:

```latex
\usepackage{feuillet}
...
\prompt{Write a paragraph that sums up section 2.}
\prompt[claude]{Check that this proof's notation follows section 1.}
```

The request is read as it is written (`%`, `#`, `$`, `_` and `\` are its
own characters, and it may have several paragraphs); only its braces must
pair. The optional argument names the assistant it is for: `claude` is for
Claude and Claude Code, `claude code` for Claude Code only. Without it, any
assistant may answer.

Until it is answered, the PDF shows the request where it stands, in green,
and the log warns of it with its line. `\usepackage[final]{feuillet}` hides
the requests in the PDF; the log still lists them. If the document already
has a `\prompt` of its own, the package leaves it alone: write the requests
`\feuilletprompt{…}`.

Claude answers each request with a **suggestion that replaces it**, which
you accept or reject in the [review panel](review.md): accepted, the request
is gone and its answer is your text; rejected, the request is back, for
another try. When a request asks a question rather than for text, the answer
is in the suggestion's thread.

**Ask Claude** lists the project's requests:

- **Ask for them in Claude** writes the request for them: open it in Claude
  or copy it for Claude Code, which answer through the connector, under your
  subscription.
- **Answer with …** has Claude answer them from Feuillet itself, through
  Anthropic's API, with your own API key (console.anthropic.com), which you
  add in your profile, **Assistants** tab, with the model and the
  assistant's name. These calls are billed to your API account. The key is
  encrypted with your account password and kept only in this browser; the
  server receives it each time Claude answers, uses it for those calls
  alone, and keeps it nowhere.

To compile the project elsewhere than in Feuillet (Git, an archive), add a
copy of `feuillet.sty` to the project: **Add feuillet.sty** in the same
list, a guest session's too. The package can also be downloaded at the
site's address followed by `/feuillet.sty`
(`https://feuillet.example.org/feuillet.sty`): put it next to the document,
or in `texmf/tex/latex/feuillet/` of your personal tree (`kpsewhich
-var-value TEXMFHOME`). It needs a LaTeX from February 2020 or later.

A guest session sees its requests in the PDF, but no assistant answers
them: the connector and the API work only on projects kept on the server,
with an account.

## Disconnecting Claude

In your profile, **Assistants** tab, **Disconnect** takes away an
application's access. Changing your password or deleting your account does
too.

## Working on a local copy

For Claude Code to work on files on your computer rather than through the
connector, link the project to [GitHub](github.md), clone the repository,
push the changes, then pull them in Feuillet.
