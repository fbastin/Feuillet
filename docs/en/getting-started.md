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
**Shared with You**, **Archived Projects** and **Trash**. Each project card
offers:

- **Open**;
- **Make a copy**, which creates a project of your own with the same
  documents and files, without the chat or the versions;
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

## The editor

- On the left, the **Files** tree, with **Search** across the project, the
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

The spell checker underlines mistakes in LaTeX and Typst text; a right click
offers corrections. Its language follows the document's: babel's or
polyglossia's in LaTeX, `#set text(lang: "en")`'s in Typst.

When the window is narrow, the least used tools of the editor's toolbar go
into the **…** menu.

## Compiling

**Ctrl+Enter** (or **Cmd+Enter**) compiles the project with TeX Live, on
Feuillet's server. The menu next to the compile button offers:

- the project's **main document** and **engine** (pdfLaTeX, XeLaTeX or
  LuaLaTeX), the same for every collaborator;
- the **compile mode**: normal, or fast (draft), which draws images as
  boxes;
- **error handling**: compile despite errors, or stop at the first one;
- compiling with the cache cleared.

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
  since arXiv runs neither BibTeX nor Biber (and `.ind`, `.gls` or `.nls`
  when there are some);
- a `00README.json` file telling arXiv the main document, the compiler
  (pdfLaTeX or XeLaTeX) and the TeX Live year. If the project has its own
  `00README`, that one goes.

The menu then says what the archive holds and what arXiv may refuse:
LuaLaTeX, which arXiv does not offer; a main document outside the root,
since arXiv compiles from the root; a bibliography without a `.bbl`; a
biblatex `.bbl` in another format than arXiv's; compile errors.

### From text to PDF, and back

A double click in the PDF goes to the matching line of the text. The sync
button of the editor's toolbar does the reverse: it shows in the PDF where
the cursor is.
