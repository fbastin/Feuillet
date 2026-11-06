# Getting started

*[Français](../fr/demarrer.md)*

## Creating an account

At <https://feuillet.slashbin.net>, choose **Create account** and give a
username, a password and, if you wish, an email address: a link sent there
confirms it, and it will serve if you forget your password (see
[Account](account.md)). The account exists in your
browser and on Feuillet's server: signing in on another device with the same
name and password brings back your projects.

A **guest session** lets you try Feuillet without an account, but it has no
account on the server: nobody can invite it, and it cannot share by
invitation.

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
Feuillet. The address is `https://feuillet.slashbin.net/docs`, with the same
fields as Overleaf's (`https://www.overleaf.com/docs`): replacing one with
the other is enough.

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
(replace `OWNER/REPO`):

```markdown
[![Open in Feuillet](https://feuillet.slashbin.net/badges/open-in-feuillet.svg)](https://feuillet.slashbin.net/docs?snip_uri=https://github.com/OWNER/REPO/archive/HEAD.zip)
```

The French badge is `badges/ouvrir-dans-feuillet.svg`. To keep the project
linked to the repository and push your changes to it, import the repository
from GitHub instead (see [GitHub](github.md)).

## The editor

- On the left, the **Files** tree, with the **Collaborators** (see
  [Collaborating](collaborating.md)), **Search** across the project, the
  **Review overview**, the **Versions** and the **Git history**. **New File**
  creates a LaTeX, BibTeX or other file; images can be dropped there too.
- In the middle, the text, in **Code** or **Visual** mode. Visual mode shows
  headings, lists, formulas, figures and tables as in the document; a
  toolbar helps with formatting.
- On the right, the output: the compile **Log** and the PDF.

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

In `\cite{…}` (and `\citep`, `\parencite`…), as Overleaf's advanced
reference search, the editor offers the entries of the project's `.bib` files
from any words of their key, authors, title, year or journal, in any order
and whatever the accents: `\cite{einstein 1905`, or `\cite{schrodinger` for
`Schr{\"o}dinger`. **Enter** replaces the words with the chosen key; after a
comma, you search for the next reference.

The spell checker underlines mistakes in LaTeX and Typst text; a right click
offers corrections. Its language follows the document's: babel's or
polyglossia's in LaTeX, `#set text(lang: "en")`'s in Typst. The words added
to the dictionary are seen, removed or added in **Settings**, **Words added
to the dictionary**; your account takes them to your other devices.

As Writefull does on Overleaf, grammar and style are checked too, with
LanguageTool on Feuillet's server, in English and French: mistakes are
underlined in blue (spelling stays red). Hovering a mistake shows the
explanation and the corrections, one click away; **Ignore** puts it aside,
**Turn this rule off** turns the rule off everywhere (rules turned off are
turned on again in **Settings**). Commands, formulas and citations do not
count, nor the spaces before « : ; ! ? » that babel adds. Checking needs an
account signed in to the server, and is turned off in **Settings**,
**Grammar and style checking**.

When the window is narrow, the least used tools of the editor's toolbar go
into the **…** menu.

## Compiling

**Ctrl+Enter** (or **Cmd+Enter**) compiles the project with TeX Live, on
Feuillet's server. The menu next to the compile button offers:

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
