<img src="src/assets/images/feuillet.svg" alt="" width="88" align="right">

# Feuillet

Feuillet is a collaborative LaTeX and Typst editor that you run on your own
server (see [Hosting](#hosting)): real-time editing, review, version history
and GitHub integration.

It is a fork of [TeXlyre](https://github.com/TeXlyre/texlyre), a local-first
LaTeX and Typst editor that runs in the browser. Feuillet keeps TeXlyre's
editor and adds a server for projects, accounts, sharing, review, versions
and compiling with TeX Live.

**User guide: [English](docs/en/README.md) · [Français](docs/fr/README.md).**

## What Feuillet adds to TeXlyre

- **Collaboration through a server.** Documents are Yjs documents relayed
  over WebSocket and stored on the server
  ([`server/collab`](server/collab)), instead of peer-to-peer connections:
  collaborators need not be online at the same time.
- **Accounts on the server.** The same projects on every device, and the
  same preferences; signing in with a password, GitHub, Google or ORCID,
  with two-factor authentication and recovery codes; sign-up open, by
  invitation or for chosen email domains. A guest session still works
  without an account.
- **A project list.** Your projects, those shared with you, archived ones
  and the trash; tags with colors; copying a project; leaving a shared one; deleting one for
  good erases it from the server.
- **Sharing.** Invitations by account name or by email, with the roles of
  editor, reviewer and reader; links that open the project for editing,
  review or reading, which the owner can replace.
- **Review.** Comments and tracked changes, for everyone or for chosen
  people; accepting or rejecting from the text or from the panel; an
  overview of the whole project. Reviewers are held to comments and tracked
  changes by the server.
- **Versions.** Saved automatically with their authors; labels, comparing
  any two, restoring a file or the whole project, downloading a version.
- **Compiling with TeX Live** on the server ([`server/texlive`](server/texlive)):
  pdfLaTeX, XeLaTeX or LuaLaTeX, with the main document, engine and TeX Live
  year set for the whole project, auto compile, draft mode, stopping at the
  first error, SyncTeX, and explanations of common errors in French;
  Markdown export and import with Pandoc.
- **GitHub and Git.** Sign in with GitHub, create or link a repository, push
  and pull with merging, Git history; GitLab, Gitea and Forgejo too. Each
  project can also be cloned with Git, and what is pushed appears at once.
- **Claude.** An MCP connector with its own OAuth, so that Claude (claude.ai,
  the desktop app or Claude Code) reads, searches, compiles, comments and
  suggests changes under the user's own subscription; an "Ask Claude" button
  in the editor.
- **Editor.** A visual editor with figure and table toolbars, a LaTeX code
  check, spell checking with Hunspell (in 15 languages), grammar and style
  checking with LanguageTool on the server
  ([`server/languagetool`](server/languagetool)), a symbol palette, searching
  the bibliography from `\cite{…}`, `.bib` files as JabRef shows them (a
  list to search and sort, each entry as a form with the fields its type
  takes in BibTeX or biblatex, and its preview), the commands a project
  defines in the completion, a command palette, a presentation mode, a focus
  mode, and going to a collaborator's cursor from their avatar.
- **Administration.** For the accounts named administrators: the server's
  disk, emails, backups and compiles, every account with its projects, the
  links to sign up.

From TeXlyre, Feuillet keeps Typst, language servers (LSP), the bibliography
tools (Zotero, OpenAlex), draw.io and TikZ diagrams, MathLive formulas,
themes and editor keybindings; see the
[TeXlyre documentation](https://texlyre.org/docs/intro).

## Privacy

What the server keeps, for how long, and which other services are involved
is listed in the app (the **Privacy** link at the bottom of the page) and in
[`src/components/common/PrivacyModal.tsx`](src/components/common/PrivacyModal.tsx).
There are no visit statistics, no advertising and no tracking cookies.

## Hosting

Feuillet runs on a Linux machine with Docker and Apache or nginx, at an
address of its own:

```bash
git clone https://github.com/fbastin/Feuillet.git
cd Feuillet
sudo deploy/install.sh feuillet.example.org   # servers, web site, HTTPS
deploy/publish.sh                             # the app, for that address
```

The guide gives the steps, what the machine needs and what to set up next:
[English](docs/en/hosting.md) · [Français](docs/fr/heberger.md).
[`deploy/README.md`](deploy/README.md) details every setting: the web server
serves the app and proxies the collaboration and TeX Live servers, which run
in Docker; another web server than Apache or nginx needs only the routes it
lists.

## Development

```bash
git clone https://github.com/fbastin/Feuillet.git
cd Feuillet
npm install
npm run dev
```

`npm run build` builds the app into `dist/`; `npm test` runs the unit tests.
The servers are in [`server/collab`](server/collab) and
[`server/texlive`](server/texlive), each with its own `package.json`.

## Acknowledgments

Feuillet is built on [TeXlyre](https://github.com/TeXlyre/texlyre) and, through it, on several key technologies:

### Core Technologies
- **[SwiftLaTeX](https://github.com/SwiftLaTeX/SwiftLaTeX)** - WASM-based LaTeX compilation engine
- **[BusyTeX](https://github.com/busytex/busytex)** - WASM-based LaTeX compilation engine
- **[typst.ts](https://github.com/Myriad-Dreamin/typst.ts)** - WASM-based Typst compilation engine
- **[Yjs](https://github.com/yjs/yjs)** - Conflict-free collaborative editing with CRDTs
- **[CodeMirror](https://codemirror.net/)** - Extensible code editor
- **[PDF.js](https://github.com/mozilla/pdf.js)** - PDF rendering in JavaScript
- **[FilePizza](https://github.com/kern/filepizza)** - Secure peer-to-peer file transfers

### Editor Extensions
- **[codemirror-vim](https://github.com/replit/codemirror-vim)** - Vim keybindings for CodeMirror
- **[codemirror-helix](https://gitlab.com/_rvidal/codemirror-helix)** - Helix keybindings for CodeMirror
- **[codemirror-emacs](https://github.com/replit/codemirror-emacs)** - Emacs keybindings for CodeMirror
- **[codemirror-lang-typst](https://github.com/kxxt/codemirror-lang-typst)** - Typst language support for CodeMirror
- **[uiw/codemirror-themes-all](https://github.com/uiwjs/react-codemirror/tree/master/themes/all)** - Collection of themes for CodeMirror
- **[Milkdown](https://github.com/Milkdown/milkdown)** - A markdown editor built on top of [ProseMirror](https://prosemirror.net/) and [remark](https://github.com/remarkjs/remark)
- **[OpenDyslexic](https://github.com/antijingoist/opendyslexic)** (SIL OFL 1.1) - OpenDyslexic Mono, an editor font for dyslexic readers, by Abbie Gonzalez (`src/assets/fonts/opendyslexic-mono/`, with its license)

### LaTeX Tools
- **[TeXstudio](https://github.com/texstudio-org/texstudio)** (GPL 3.0) - Completion word lists of LaTeX packages and classes, from which the editor completes the commands and environments of the packages a project loads (derived data in `src/extensions/codemirror/autocomplete/__generated__/texstudio/`, with TeXstudio's license)
- **[TeX Live](https://tug.org/texlive/)** - Its package database (`texlive.tlpdb`) gives the names and descriptions of the packages, classes and BibTeX styles offered in `\usepackage{…}`, `\documentclass{…}` and `\bibliographystyle{…}`
- **[tex-fmt](https://github.com/WGUNDERWOOD/tex-fmt)** - LaTeX code formatter
- **[TeXcount](https://app.uio.no/ifi/texcount/)** - Word counter for LaTeX documents
- **[BibTeX-Tidy](https://github.com/FlamingTempura/bibtex-tidy)** - BibTeX file cleaner and formatter
- **[Pandoc](https://pandoc.org)** (GPL 2.0 or later) - Markdown export and import, run on the TeX Live server (`server/texlive`)
- **[LanguageTool](https://languagetool.org)** (LGPL 2.1 or later) - Grammar and style checking, its official release run on the server (`server/languagetool`)
- **[Hunspell](https://github.com/hunspell/hunspell)** through **[hunspell-wasm](https://github.com/rotemdan/hunspell-wasm)** (MPL 1.1, GPL 2.0 or LGPL 2.0) - Spell checking, with the dictionaries packaged by [wooorm/dictionaries](https://github.com/wooorm/dictionaries): French of [Grammalecte](https://grammalecte.net/) (MPL 2.0); English of [SCOWL](http://wordlist.aspell.net/) (MIT and BSD); German of [igerman98](https://www.j3e.de/ispell/igerman98/index_en.html) (GPL 2.0 or 3.0); Spanish of [RLA-ES](https://github.com/sbosio/rla-es) (GPL 3.0, LGPL 3.0 or MPL 1.1); Italian of [plio.it](http://www.plio.it) (GPL 3.0); Brazilian Portuguese of [LibreOffice](https://github.com/LibreOffice/dictionaries) (LGPL 3.0 or MPL 2.0); European Portuguese of [Natura](https://natura.di.uminho.pt) (GPL 2.0, LGPL 2.1 or MPL 1.1); Dutch of [OpenTaal](https://github.com/OpenTaal/opentaal-hunspell) (BSD or CC BY 3.0); Catalan of [Softcatalà](https://github.com/Softcatala/catalan-dict-tools) (GPL 2.0 or LGPL 2.1); Polish of [SJP.PL](http://extensions.openoffice.org/en/project/polish-dictionary-pack) (GPL 3.0, LGPL 3.0 or MPL 2.0); Russian of [LibreOffice](https://github.com/LibreOffice/dictionaries) (BSD); Swedish of [Den stora svenska ordlistan](https://extensions.libreoffice.org/extensions/swedish-spelling-dictionary-den-stora-svenska-ordlistan) (LGPL 3.0); Danish of [Stavekontrolden](https://stavekontrolden.dk) (GPL 2.0, LGPL 2.1 or MPL 1.1); Romanian of [RoSpell](https://rospell.wordpress.com) (GPL 2.0, LGPL 2.1 or MPL 1.1)

### Typst Tools
- **[typstyle](https://github.com/typstyle-rs/typstyle)** - Typst code formatter
- **[typst-wordometer](https://github.com/Jollywatt/typst-wordometer)** - Word counter for Typst documents

### Diagram & Visualization
- **[Draw.io](https://github.com/jgraph/drawio)** - Diagramming tool for collaborative diagram editing
- **[TikZ Editor](https://github.com/DominikPeters/tikz-editor)** - WYSIWYG editor for TikZ diagrams in LaTeX with collaborative editing support
- **[MathLive](https://github.com/arnog/mathlive)** - Math rendering and full editing with built-in symbol and expression keyboard
- **[Detypify](https://github.com/QuarticCat/detypify)** - Handwritten symbol recognition powered by a client-side ONNX model, used for draw-to-insert symbol search

### Runtime
- **[WebPerl](https://github.com/haukex/webperl)** - Perl interpreter compiled to WebAssembly
- **[wasm-bindgen](https://github.com/wasm-bindgen/wasm-bindgen)** - Rust/Wasm interoperability

Third-party logo and icon attributions: http://texlyre.org/docs/attributions.

### Generative AI

Generative AI has been used for selected development and maintenance tasks, including scoped code changes, adaptation of existing integrations, debugging, refactoring, tests, and project configuration.

The tools, interaction summaries, and AI-assisted development areas are documented in [`genai/`](genai/README.md).


## Contributing

Bug reports and suggestions are welcome as
[issues](https://github.com/fbastin/Feuillet/issues). For TeXlyre itself, see
its [contribution guide](CONTRIBUTING.md).

## License

Feuillet, like TeXlyre, is licensed under the GNU Affero General Public
License v3.0 (AGPL-3.0). See [LICENSE](LICENSE) for the complete license
text.

## Funding of TeXlyre

[TeXlyre is funded by NLnet](https://nlnet.nl/project/Texlyre/) through the
NGI0 Commons Fund, which is supported by the European Commission's Next
Generation Internet programme.
