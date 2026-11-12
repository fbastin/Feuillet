# Getting started

*[Français](../fr/demarrer.md)*

## Creating an account

On Feuillet's home page, choose **Create account** and give a
username, a password and, if you wish, an email address: a link sent there
confirms it, and it will serve if you forget your password (see
[Account](account.md)). The account exists in your
browser and on Feuillet's server: signing in on another device with the same
name and password brings back your projects.

A **guest session** lets you try Feuillet without an account, but it has no
account on the server: nobody can invite it, and it cannot share by
invitation. As on Overleaf, its own projects do not compile on the server,
but in the browser; a project opened by its owner's link does.

Depending on the server, creating an account may take an invitation: to a
project, or a link from its administrator; or an email address of a domain
it accepts, to which it mails a link.

## The project list

The left column sorts projects: **All Projects**, **Your Projects**,
**Shared with You**, **Archived Projects** and **Trash**. As on Overleaf,
each card says when the project was last changed, and by whom ("by you" for
yourself), from its last version. It also offers:

- **Open**;
- **Make a copy**, which creates a project of your own with the same
  documents and files, without the chat or the versions;
- **Download PDF** of a LaTeX project: Feuillet compiles it at once with
  TeX Live, its main document, engine and TeX Live version, then downloads
  the PDF under its name;
- **Archive**, to put a project away without deleting it;
- **Move to trash**, from where it can be restored (**Restore**) or deleted
  (**Delete for good**). Deleting one of your projects for good also erases
  it from the server, for its collaborators as well;
- for a project shared with you, **Leave project**
  (see [Collaborating](collaborating.md)).

### New project

**New Project** offers templates: blank, example, article, book, letter,
homework, poster, presentation, report, thesis, CV. The project compiles
with TeX Live from the start.

### Import

**Import** creates a project from:

- a `.zip` archive, such as a project downloaded from Overleaf;
- a GitHub, GitLab, Gitea or Forgejo repository (see also
  [GitHub](github.md));
- a web address (a repository or an archive);
- TeXlyre's template gallery.

### Open in Feuillet

As "Open in Overleaf", a link or a form on another page creates a project in
Feuillet. The address is the server's followed by `/docs`
(`https://feuillet.example.org/docs`), with the same fields as Overleaf's
(`https://www.overleaf.com/docs`): replacing one with the other is enough.

- `snip_uri`: the address of a file (`.tex`, `.bib`, image…) or of a `.zip`
  archive, or a `data:` address. Several files:
  `snip_uri[]=…&snip_uri[]=…`;
- `snip` or `encoded_snip`: LaTeX code, as is or encoded
  (`encodeURIComponent`). Without `\documentclass`, it goes into Overleaf's
  preamble (12 pt article, `amsmath`, `tikz`);
- `snip_name` (or `snip_name[]`): each file's name, in order;
- `engine`: `pdflatex`, `latex_dvipdf` (the LaTeX engine), `xelatex` or
  `lualatex`;
- `main_document`: the main document;
- `visual_editor=true`: offers the visual editor.

A link is followed with GET; a form is sent with POST
(`application/x-www-form-urlencoded`, up to 10 MB). Feuillet shows the files
and where they come from, and creates the project only when you ask; without
an open account, it first asks you to sign in. The server downloads files
from other sites for your account, as adding a file **From external URL**
does. It keeps the request for 30 minutes, in memory only: after that, open
the link again.

For a public GitHub repository, this badge opens a copy of the repository
(replace `feuillet.example.org` with the server's address and `OWNER/REPO`
with the repository):

```markdown
[![Open in Feuillet](https://feuillet.example.org/badges/open-in-feuillet.svg)](https://feuillet.example.org/docs?snip_uri=https://github.com/OWNER/REPO/archive/HEAD.zip)
```

The French badge is `badges/ouvrir-dans-feuillet.svg`. To keep the project
linked to the repository and push your changes to it, import the repository
from GitHub instead (see [GitHub](github.md)).

## The editor

- On the left, the **Files** tree, with the **Collaborators** (see
  [Collaborating](collaborating.md)), **Search** across the project, the
  **Review overview**, the **Versions** and the **Git history**. **New File**
  creates a LaTeX, BibTeX or other file; images can be dropped there too.
  A right click on a file or folder opens its menu (rename, move,
  duplicate, delete…).
- In the middle, the text, in **Code** or **Visual** mode. Visual mode shows
  headings, lists, formulas, figures and tables as in the document; a
  toolbar helps with formatting, and **Ctrl+B** and **Ctrl+I** (**Cmd** on
  a Mac) make the selection bold or italic. Renaming an environment, in
  `\begin{…}` or in `\end{…}`, renames the other too (except while changes
  are tracked, where each change is proposed on its own).
- On the right, the output: the compile **Log** and the PDF. The editor and
  the PDF share the width half and half; the divider can be moved, and the
  proportion chosen follows the window.

In visual mode, as in Overleaf's table editor, a click in a table selects a
cell and shows its toolbar: rows, columns, alignment, borders, merging and
caption. A double click edits the cell. **Shift** with a click or the arrows
selects several cells of a row; **Merge cells** joins them (`\multicolumn`),
and **Unmerge cells** splits them again. The **Caption** menu puts the
caption above or below the table, or takes it away with its label; a table
without a `table` environment gets one, centred.

An image pasted in the text, or dropped from the computer, joins the project
in the `images` folder (under its own name, when dropped) and becomes a
figure there. A file dragged from the files tree puts what refers to it: a
figure for an image, `\input` for a `.tex` file, `\bibliography` (or
`\addbibresource` with biblatex) for a `.bib`, `#include` or
`#bibliography` in Typst, else its path.

The **Figure** button of the editor's toolbar takes the image from the
project's files, the computer, another project or a URL, as on Overleaf;
the last two keep their source, to be refreshed as other imported files.
With the cursor at the start of a line (on `\end{document}`, say), the
figure goes before it.

In `\cite{…}` (and `\citep`, `\parencite`…), as Overleaf's advanced
reference search, the editor offers the entries of the project's `.bib` files
from any words of their key, authors, title, year or journal, in any order
and whatever the accents: `\cite{einstein 1905`, or `\cite{schrodinger` for
`Schr{\"o}dinger`. **Enter** replaces the words with the chosen key; after a
comma, you search for the next reference.

In `\usepackage{…}`, `\documentclass{…}`, `\bibliographystyle{…}` and
Beamer's themes (`\usetheme{…}`…), the editor offers, as Overleaf does, every
package, class, BibTeX style and theme of TeX Live, the project's own first
(its `.sty`, `.cls` and `.bst` files). Next to the name stands the TeX Live
package that provides it, when it is called otherwise (`tikz` comes from
`pgf`), and the engine it needs, when it is only for LuaLaTeX or XeLaTeX; the
description of that package shows beside the list, or under it.

The commands and environments of the packages and of the class the project
loads are offered too, with their arguments as fields to fill (**Tab** goes
to the next): `\usepackage{siunitx}` brings `\qty{number}{unit}`,
`\documentclass{beamer}` brings `\frametitle`, and `\begin{` offers `align`
once amsmath is loaded. A package loaded in another file of the project
counts too.

In options, the keys the command takes are offered: `\includegraphics[`
offers `width`, `angle` or `keepaspectratio`, `\usepackage[…]{geometry}`
offers `margin` or `paper`, `\documentclass[` the class's options,
`\begin{tcolorbox}[` tcolorbox's. A key that takes a length or a text comes
with that field selected; after a key that has values, as `labelfont=` of
`\captionsetup`, its values are offered. These lists come from
[TeXstudio](https://github.com/texstudio-org/texstudio)'s.

With the cursor on a `\begin{…}` or on its `\end{…}`, both are outlined,
as matching brackets are; in red when their names differ.

Above the editor, after the file's path, come the headings the cursor is
under: `/main.tex › Methods › Data` (parts, chapters, sections… in LaTeX,
headings in Typst). A click on one puts the cursor there.

The spell checker underlines mistakes in LaTeX and Typst text; a right click
offers corrections. It knows 15 languages: French, English (United States
and United Kingdom), German, Spanish, Italian, Portuguese (Brazil and
Portugal), Dutch, Catalan, Polish, Russian, Swedish, Danish and Romanian.
Its language follows the document's: babel's or polyglossia's in LaTeX,
`#set text(lang: "en")`'s in Typst, otherwise the one the text is written
in; **Settings**, **Spell checking** sets one. The words added
to the dictionary are seen, removed or added in **Settings**, **Words added
to the dictionary**; your account takes them to your other devices.

As Writefull does on Overleaf, grammar and style are checked too, with
LanguageTool on Feuillet's server, in the same languages: mistakes are
underlined in blue (spelling stays red). Hovering a mistake shows the
explanation and the corrections, one click away; **Ignore** puts it aside,
**Turn this rule off** turns the rule off everywhere (rules turned off are
turned on again in **Settings**). Commands, formulas and citations do not
count, nor the spaces before « : ; ! ? » that babel adds. Checking needs an
account signed in to the server, and is turned off in **Settings**,
**Grammar and style checking**.

As on Overleaf, you can write in several places at once. **Ctrl+Alt+→**
(**Cmd+Alt+→** on a Mac) selects the word under the cursor, then, at each
press, its next occurrence, and **Ctrl+Alt+←** the previous one;
**Ctrl+Alt+↑** and **Ctrl+Alt+↓** add a cursor on the line above or below; **Ctrl+click** (**Cmd+click**) adds one where
you click (on a link, it follows it, as before); **Alt** while dragging
selects a rectangle, the same columns on several lines. What you type goes
to every cursor, the toolbar buttons (bold, italic…) act on each selection,
one undo takes it all back, and track changes suggests one change per
place. **Escape** goes back to the main cursor alone. **Ctrl+D**
(**Cmd+D**) deletes the line, as on Overleaf.

Overleaf's other shortcuts are there too: **Ctrl+/** comments or
uncomments the lines, **Ctrl+U** and **Ctrl+Shift+U** put the selection (or
the word under the cursor) in upper or lower case, **Ctrl+Shift+L** goes to
a line, **Ctrl+J** shows or hides the review panel and **Ctrl+Shift+A**
turns track changes on or off. The full list opens from the **Keyboard Map** link at the bottom of the
page (behind the **⋯** button when needed).

As in Overleaf's settings, **Settings** sets the editor's **Line height**
(compact, normal or wide, under **Appearance**) and **Auto-close brackets**:
when it is off, typing `{`, `[` or `$` does not write the closing one. In
LaTeX, as on Overleaf, `$` comes in pairs (`$|$`), a lone `(` and quotes are
not closed, and nothing is closed after a backslash (`\$`, `\{`).

When the window is narrow, the least used tools of the editor's toolbar go
into the **…** menu.

## Compiling

**Ctrl+Enter** (or **Cmd+Enter**) compiles the project with TeX Live, on
Feuillet's server; so does **Ctrl+S** (**Cmd+S**), as on Overleaf. The menu next to the compile button offers:

- the project's **main document** and **engine** (pdfLaTeX, LaTeX, XeLaTeX
  or LuaLaTeX), the same for every collaborator. As on Overleaf and arXiv,
  **LaTeX** goes through DVI and PostScript (`latex`, `dvips`, then
  `ps2pdf`): it is the engine for PSTricks, and images are then EPS;
- the **TeX Live version**, also the project's: **Latest**, the default,
  follows Feuillet's updates; a year stays the same for the project, as
  TeX Live 2025, the one arXiv compiles with. Choosing the latest's year
  keeps the project on it when TeX Live moves to a new year;
- the **compile mode**: normal, or fast (draft), which draws images as
  boxes;
- **error handling**: compile despite errors, or stop at the first one;
- **Auto compile**, as Overleaf's: the project compiles two seconds after
  you stop typing, with what you just wrote. A collaborator's changes
  compile on their side, if they turned it on. Each project has its own
  setting;
- compiling with the cache cleared.

As on Overleaf, the bibliography (BibTeX or Biber), the index, the glossaries
of the `glossaries` package (glossary, acronyms, symbols, numbers) and the
nomenclature of `nomencl` are made by themselves, in as many runs as needed.
For the server's safety, Feuillet runs `makeindex` itself rather than
`makeglossaries`; xindy and bib2gls are not run.

As on Overleaf, a document may run programs while compiling (`\write18`,
shell escape): Inkscape for the `svg` package, TikZ's externalization,
PythonTeX, minted, gnuplot… The compile server has no network access: a
document can neither download nor reach anything.

As on Overleaf, a project compiles when it opens; its last PDF shows first,
while it compiles. The **Auto-compile on project open** setting (Settings,
Compilation) turns this off.

Projects made before Feuillet had TeX Live compiled in the browser: they
move to TeX Live, with their engine, the next time an editor opens them. The
browser compiler is still offered: choose **LaTeX** as the compiler in the
project's details (the pencil next to its name), and the project keeps it.

### Understanding an error

The **Log** lists errors and warnings with their file and line; a click goes
to the line. Under each common error, an explanation says what TeX did not
understand and how to fix it, such as an unknown command or an environment
that needs a package. The lines involved are also marked in the editor, and
their tooltip gives the same explanation. These explanations are in the
interface's language.

### The compile's other files

Under the Log, the **Other logs and files** menu lists, as on Overleaf, the
files the last compile wrote on the server: the whole log (`.log`), the
formatted bibliography (`.bbl`), the BibTeX or Biber log (`.blg`), the
`.aux`, and so on. A click downloads the file. The server keeps them while
the editor stays open: after a long pause, compile again to get them.

### Submitting to arXiv

In the export menu (the arrow next to the download button), **Package for
arXiv (.zip)** compiles the project, then downloads an archive ready to
upload to arXiv:

- the project's sources, without what compiling writes (`.aux`, `.log`, the
  document's PDF…) or hidden files;
- the `.bbl` of that compile, named after the main document as arXiv asks,
  since arXiv runs neither BibTeX nor Biber (and the index and glossaries:
  `.ind`, `.gls`, `.acr`, `.sls` or `.nls`, when there are some);
- a `00README.json` file telling arXiv the main document, the compiler
  (pdfLaTeX, LaTeX or XeLaTeX) and the TeX Live year. If the project has its own
  `00README`, that one goes.

The menu then says what the archive holds and what arXiv may refuse:
LuaLaTeX, which arXiv does not offer; a main document outside the root,
since arXiv compiles from the root; a bibliography without a `.bbl`; a
biblatex `.bbl` in another format than arXiv's; compile errors. For the
`.bbl` to be the one arXiv expects, choose **TeX Live 2025 (arXiv)** as the
TeX Live version before exporting.

### From text to PDF, and back

A double click in the PDF goes to the matching line of the text. The sync
button of the editor's toolbar does the reverse: it shows in the PDF where
the cursor is.

### Presenting slides

The **Presentation mode** button of the PDF toolbar (the screen on its stand)
shows the PDF alone, full screen on black, one page at a time as large as the
screen allows, as on Overleaf; it is made for Beamer slides. The arrows, the
space bar, Page Up/Page Down (those of a presentation remote), a click or the
wheel turn the pages; Shift+click goes back, Home and End go to the first and
the last. Links in the PDF still work, and the pointer hides when the mouse
stays still. Escape ends the presentation, at the page reached. To present on
a projector while keeping the editor in view, first open the PDF in a
separate window (**Open output in new window**, beside the compile button),
drag it to the projector, then start presentation mode there.
