# Compte et confidentialité

*[English](../en/account.md)*

## Plusieurs appareils

Votre compte existe dans votre navigateur et sur le serveur de Feuillet. En
vous connectant ailleurs avec le même nom et le même mot de passe, vous
retrouvez la liste de vos projets, vos projets eux-mêmes et les mots ajoutés
à votre dictionnaire. Un compte créé avant que Feuillet ait un serveur se lie
à celui-ci depuis le profil, ou depuis **Partager** quand on veut inviter.

## Le profil

Le menu de votre compte, en haut à droite, ouvre le profil :

- changer de mot de passe; vos autres appareils devront se reconnecter, et
  les assistants comme Claude perdent leur accès;
- **Courriel du compte** et **Codes de récupération**, si vous oubliez
  votre mot de passe (voir plus bas);
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

## Ce que garde le serveur

Le lien **Confidentialité**, en bas de la page, dit en détail ce que garde le
serveur de Feuillet, combien de temps, et ce qui part chez d'autres services
(GitHub, Anthropic, TeXlyre…) quand vous les utilisez. En bref :

- votre compte : nom, empreinte du mot de passe (jamais le mot de passe),
  empreintes de vos codes de récupération, adresse courriel si vous en
  avez donné une, appareils connectés (navigateur et système), liste de
  vos projets;
- vos projets, leurs versions et leur partage, pour vos collaborateurs;
- les journaux du serveur web, 14 jours; ceux du serveur de collaboration,
  limités à 30 Mo;
- ni statistiques de visite, ni publicité, ni témoins de suivi.
