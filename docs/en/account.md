# Account and privacy

*[Français](../fr/compte.md)*

## Several devices

Your account exists in your browser and on Feuillet's server. Signing in
elsewhere with the same name and password brings back the list of your
projects, the projects themselves and the words added to your dictionary. An
account made before Feuillet had a server is linked to it from the profile,
or from **Share** when inviting.

As on Overleaf, your preferences follow your account too: the interface's
language, the theme variant (light or dark), the editor's settings (font,
size, keybindings, spelling…), those of compiling and of the PDF, your Git
commit email and your color. A change made on one device reaches the others
at their next sync, within a few minutes or on reloading the page. The
servers' addresses and what belongs to the device (theme layout, storage,
offline mode) stay with each browser.

## The profile

Your account menu, at the top right, opens the profile:

- changing your password; your other devices will have to sign in again,
  and assistants such as Claude lose their access;
- **Account email** and **Recovery codes**, in case you forget your
  password (see below);
- **Git commit email**: the author address of your commits, which anyone
  who sees the repository reads (on GitHub, for example, your noreply
  address); it is apart from the account email;
- **Devices**: the devices signed in to your account, with their browser
  and system, when they signed in and were last used. **Sign out** ends a
  device's session, such as a shared computer's; **Sign out all other
  devices** ends all of them but this one. Unused, a session ends by itself
  after 90 days;
- **Assistants**: the address of the Claude connector and the connected
  applications (see [Claude](claude.md));
- **Export Account**: your projects and settings in an archive;
- **Delete Account**.

## Forgotten password

Two ways, to prepare in your profile, **Account** tab:

- **Account email**: as on Overleaf, the address given when signing up, or
  later in the profile, receives a link that confirms it, for 24 hours; it
  serves only once confirmed. If you forget your password, **Forgot your
  password?**, on the sign-in page, asks for your name or that address, and
  sends a link there, valid one hour, to choose a new password. A confirmed
  address also lets Feuillet send your invitations itself (see
  [Collaborating](collaborating.md)). It is shown to no one, not even the
  people you invite, nor written in your Git commits. This is offered only
  if the server sends email.
- **Recovery codes**: keep them somewhere safe; they are shown only once.
  **Forgot your password?**, then **I have a recovery code**, asks for your
  name, one of these codes and a new password. Each code works once; new
  codes replace the old ones.

Either way, your other devices will have to sign in again, and assistants
such as Claude lose their access.

## Deleting

- **Delete for good** on one of your projects, from the trash, also erases
  it from the server: documents, files, versions and links, for its
  collaborators as well. No link opens it any more. This cannot be undone.
- For a project shared with you, deleting it means leaving it (**Leave
  project**): it leaves your list, and the project stays with its owner.
- **Delete Account** erases your account on the server and the projects you
  own, in the same way; you leave the others' projects.

The server's backups, made each night, keep what was erased for two weeks
at most; only the server's administrator can read them.

The server's administrator sees, on an administration page, each account's
name, when it was made and last used, how many devices and projects it has,
the space its projects take and whether its email address is confirmed, but
neither the address nor the projects; they may delete an account, with the
projects it owns, and the projects no one can find any more: those on no
account's list, a guest's among them, and those whose owner's account was
deleted.

## What the server keeps

The **Privacy** link, at the bottom of the page, says in detail what
Feuillet's server keeps, for how long, and what goes to other services
(GitHub, Anthropic, TeXlyre…) when you use them. In short:

- your account: name, a hash of the password (never the password), hashes
  of your recovery codes, your email address if you gave one, the
  signed-in devices (browser and system), the list of your projects, the
  words of your dictionary and your preferences;
- your projects, their versions and their sharing, for your collaborators;
- the web server's logs, 14 days; the collaboration server's, 30 MB at
  most;
- no visit statistics, no advertising, no tracking cookies.
