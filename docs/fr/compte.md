# Compte et confidentialité

*[English](../en/account.md)*

## Plusieurs appareils

Votre compte existe dans votre navigateur et sur le serveur de Feuillet. En
vous connectant ailleurs avec le même nom et le même mot de passe, vous
retrouvez la liste de vos projets, vos projets eux-mêmes et les mots ajoutés
à votre dictionnaire. Un compte créé avant que Feuillet ait un serveur se lie
à celui-ci depuis le profil, ou depuis **Partager** quand on veut inviter.

Comme sur Overleaf, vos préférences suivent aussi votre compte : la langue de
l'interface, la variante du thème (clair ou sombre), les couleurs de vos
étiquettes de projets, les réglages de l'éditeur (police, taille,
interligne, curseur, raccourcis clavier, orthographe…), ceux de la
compilation et du PDF, votre courriel des commits Git et votre couleur. Un
changement fait sur un appareil arrive sur les autres à leur prochaine
synchronisation, en quelques minutes au plus ou en rechargeant la page. Les
adresses des serveurs et ce qui tient à l'appareil (disposition du thème,
stockage, mode hors ligne) restent propres à chaque navigateur.

## Se connecter avec Google

Comme sur Overleaf, **Se connecter avec Google** ouvre votre compte d'un
clic, sur n'importe quel appareil, une fois votre compte associé à un compte
Google :

- depuis la page de connexion : si ce compte Google n'est encore associé à
  aucun compte Feuillet, Feuillet propose d'en créer un, qui lui sera
  associé. Choisissez un nom et un mot de passe : le mot de passe chiffre ce
  que le navigateur garde (vos jetons GitHub, par exemple) et confirme les
  changements importants, comme sur un compte ordinaire;
- depuis le profil, pour un compte qui existe déjà : **Associer un compte
  Google**, avec votre mot de passe. **Dissocier Google** retire
  l'association; votre mot de passe ouvre toujours votre compte.

Feuillet ne demande à Google que de quoi reconnaître votre compte Google, ni
son adresse, ni votre nom, ni votre photo, et n'en garde qu'une empreinte.
Sur un appareil où vous vous êtes connecté avec Google, Feuillet demande
votre mot de passe la première fois qu'il en a besoin.

## Se connecter avec ORCID

Comme sur Overleaf, **Se connecter avec ORCID** fait de même avec votre
identifiant ORCID, pratique entre chercheurs : depuis la page de connexion,
qui propose aussi d'**S'inscrire avec ORCID**, ou depuis le profil
(**Associer un compte ORCID**, **Dissocier ORCID**). Un même compte Feuillet
peut être associé à la fois à un compte Google et à un compte ORCID.

Feuillet n'apprend d'ORCID que votre identifiant ORCID et n'en garde qu'une
empreinte, jamais l'identifiant lui-même ni le nom qu'ORCID envoie avec lui.

## Le profil

Le menu de votre compte, en haut à droite, ouvre le profil :

- changer de mot de passe; vos autres appareils devront se reconnecter, et
  les assistants comme Claude perdent leur accès;
- **Se connecter avec Google** et **Se connecter avec ORCID** : associer
  un compte de chacun, ou le dissocier (voir plus haut);
- **Courriel du compte** et **Codes de récupération**, si vous oubliez
  votre mot de passe (voir plus bas). Sous l'adresse, **Courriels de
  relecture** dit si Feuillet vous écrit quand on répond dans un fil de
  commentaires où vous avez écrit, ou qu'on vous mentionne (voir
  [Relecture](relecture.md));
- **Courriel des commits Git** : l'adresse d'auteur de vos commits, que lit
  quiconque voit le dépôt (sur GitHub, par exemple votre adresse noreply);
  elle est distincte du courriel du compte;
- **Appareils** : les appareils connectés à votre compte, avec leur
  navigateur et leur système, la date de connexion et la dernière
  utilisation. **Déconnecter** ferme la session d'un appareil, par exemple
  un ordinateur partagé; **Déconnecter tous les autres appareils** les ferme
  toutes sauf celle-ci. Sans utilisation, une session se ferme d'elle-même
  après 90 jours;
- **Assistants** : l'adresse du connecteur Claude et les applications
  connectées (voir [Claude](claude.md));
- **Exporter le compte** : vos projets et réglages dans une archive;
- **Supprimer le compte**.

## Double authentification

Comme sur Overleaf, se connecter peut demander, en plus du mot de passe, le
code que montre une application de votre téléphone : Google Authenticator,
Aegis, FreeOTP, ou un gestionnaire de mots de passe. Dans le profil, onglet
**Compte**, **Mettre en place la double authentification** demande votre
mot de passe, puis montre un code QR à lire avec l'application (ou sa clé,
à taper); le code qu'elle affiche ensuite l'active. Si votre compte n'avait
pas de codes de récupération, Feuillet en fait alors : gardez-les, ils
remplacent un code quand le téléphone est perdu, une fois chacun.

Dès lors, se connecter sur un appareil, avec le mot de passe ou avec
Google ou ORCID, demande le code; autoriser Claude aussi (voir
[Claude](claude.md)). Chaque code ne sert qu'une fois. Les appareils déjà
connectés le restent : l'onglet **Appareils** les déconnecte. Un mot de
passe oublié se change comme ci-dessous, et la double authentification
reste active. Elle se désactive dans le profil, avec le mot de passe et un
code.

## Être prévenu des changements

Comme sur Overleaf, quand la façon d'ouvrir votre compte change, Feuillet
vous prévient au courriel de votre compte (voir plus bas), dans la langue
de votre interface : un nouveau mot de passe (changé dans le profil, par un
lien pour un mot de passe oublié ou avec un code de récupération), la
double authentification activée ou désactivée, de nouveaux codes de
récupération, la connexion avec Google ou ORCID ajoutée ou retirée, un
nouveau jeton Git. Quand une autre adresse est confirmée pour votre compte,
ou l'adresse retirée, c'est cette adresse-là qui est prévenue. Si le
changement ne vient pas de vous, changez votre mot de passe et déconnectez
les appareils que vous ne reconnaissez pas, dans votre profil. Sans
courriel de compte, ou sur un serveur qui n'envoie pas de courriels, rien
n'est envoyé.

## Mot de passe oublié

Deux moyens, à préparer dans votre profil, onglet **Compte** :

- **Courriel du compte** : comme sur Overleaf, l'adresse donnée à
  l'inscription, ou plus tard dans le profil, reçoit un lien qui la
  confirme, valable 24 heures; elle ne sert qu'une fois confirmée. Si vous
  oubliez votre mot de passe, **Mot de passe oublié?**, sur la page de
  connexion, demande votre nom ou cette adresse, et y envoie un lien,
  valable une heure, pour choisir un nouveau mot de passe. Une adresse
  confirmée permet aussi à Feuillet d'envoyer lui-même vos invitations (voir
  [Collaborer](collaborer.md)). Elle n'est montrée à personne, pas même aux
  personnes invitées, ni inscrite dans vos commits Git. Ce moyen n'est
  offert que si le serveur envoie des courriels.
- **Codes de récupération** : gardez-les en lieu sûr; ils ne sont affichés
  qu'une fois. **Mot de passe oublié?**, puis **J'ai un code de
  récupération**, demande votre nom, l'un de ces codes et un nouveau mot de
  passe. Chaque code ne sert qu'une fois; de nouveaux codes remplacent les
  anciens.

Dans les deux cas, vos autres appareils devront se reconnecter, et les
assistants comme Claude perdent leur accès.

## Supprimer

- **Supprimer définitivement** un de vos projets, depuis la corbeille,
  l'efface aussi du serveur : documents, fichiers, versions et liens, pour
  ses collaborateurs également. Aucun lien ne l'ouvre plus. C'est
  irréversible.
- Pour un projet partagé avec vous, la suppression revient à le **quitter** :
  il disparaît de votre liste, et le projet reste à son propriétaire.
- **Supprimer le compte** efface votre compte sur le serveur et les projets
  dont vous êtes propriétaire, de la même façon; vous quittez les projets des
  autres.

Les sauvegardes du serveur, faites chaque nuit, gardent au plus deux
semaines ce qui a été effacé; seul l'administrateur du serveur peut les lire.

L'administrateur du serveur voit, sur une page d'administration, le nom de
chaque compte, quand il a été créé et utilisé pour la dernière fois, son
nombre d'appareils et de projets, l'espace qu'occupent ses projets et si son
adresse courriel est confirmée, mais ni l'adresse ni les projets; il peut
supprimer un compte, avec les projets dont celui-ci est propriétaire, ainsi
que les projets que plus personne ne peut retrouver : ceux qui ne sont sur la
liste d'aucun compte, dont ceux des invités, et ceux dont le compte
propriétaire a été supprimé.

## Ce que garde le serveur

Le lien **Confidentialité**, en bas de la page, dit en détail ce que garde le
serveur de Feuillet, combien de temps, et ce qui part chez d'autres services
(GitHub, Anthropic, TeXlyre…) quand vous les utilisez. En bref :

- votre compte : nom, empreinte du mot de passe (jamais le mot de passe),
  empreintes de vos codes de récupération, adresse courriel si vous en
  avez donné une, empreinte de l'identifiant du compte Google associé s'il
  y en a un, appareils connectés (navigateur et système), liste de vos
  projets, mots de votre dictionnaire et préférences;
- vos projets, leurs versions et leur partage, pour vos collaborateurs;
- les journaux du serveur web, 14 jours; ceux du serveur de collaboration,
  limités à 30 Mo;
- ni statistiques de visite, ni publicité, ni témoins de suivi.
