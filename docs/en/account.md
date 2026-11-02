# Account and privacy

*[Français](../fr/compte.md)*

## Several devices

Your account exists in your browser and on Feuillet's server. Signing in
elsewhere with the same name and password brings back the list of your
projects, the projects themselves and the words added to your dictionary. An
account made before Feuillet had a server is linked to it from the profile,
or from **Share** when inviting.

## The profile

Your account menu, at the top right, opens the profile:

- changing your password; your other devices will have to sign in again,
  and assistants such as Claude lose their access;
- **Recovery email** and **Recovery codes**, in case you forget your
  password (see below);
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

- **Recovery email**: as on Overleaf, give an email address; a link sent
  there confirms it, for 24 hours. If you forget your password, **Forgot
  your password?**, on the sign-in page, asks for your name or that address,
  and sends a link there, valid one hour, to choose a new password. The
  address serves only for that and is shown to no one. This is offered only
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

## What the server keeps

The **Privacy** link, at the bottom of the page, says in detail what
Feuillet's server keeps, for how long, and what goes to other services
(GitHub, Anthropic, TeXlyre…) when you use them. In short:

- your account: name, a hash of the password (never the password), hashes
  of your recovery codes, your recovery email if you gave one, the
  signed-in devices (browser and system), the list of your projects;
- your projects, their versions and their sharing, for your collaborators;
- the web server's logs, 14 days; the collaboration server's, 30 MB at
  most;
- no visit statistics, no advertising, no tracking cookies.
