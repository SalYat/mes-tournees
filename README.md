# Mes Tournées

Application de gestion de tournées de livraison, utilisable sur **ordinateur, Android et iPhone** depuis un simple lien, et installable sur l'écran d'accueil comme une application.

- **Espace Chauffeur** (téléphone) : choisir son nom, voir ses tournées, suivre le prochain arrêt, lancer la navigation (Google Maps, Waze, Plans), valider « Livré » (nom du réceptionnaire, photo) ou « Problème » (motif).
- **Espace Responsable** (ordinateur ou tablette) : chiffres du jour, création et attribution des tournées, ajout d'arrêts ou collage depuis Excel, ordre des arrêts, suivi en direct, historique et export CSV, gestion des chauffeurs.

Pile technique : HTML / CSS / JavaScript sans compilation, données et connexion avec [Supabase](https://supabase.com), hébergement gratuit avec GitHub Pages.

## Mise en route (environ 15 minutes)

### 1. Créer la base de données
1. Créer un compte et un projet sur [supabase.com](https://supabase.com) (région Europe conseillée : Paris ou Francfort).
2. Ouvrir **SQL Editor > New query**, coller le contenu de `supabase/schema.sql`, cliquer **Run**.
3. Dans **Project Settings > API**, copier la **Project URL** et la clé **anon public**.

### 2. Relier l'application
Ouvrir `config.js` et coller les deux valeurs :
```js
window.MT_CONFIG = {
  supabaseUrl: "https://xxxx.supabase.co",
  supabaseAnonKey: "eyJhbGciOi..."
};
```

### 3. Mettre en ligne avec GitHub Pages
1. Dans le dépôt GitHub : **Settings > Pages > Source : Deploy from a branch**, branche `main`, dossier `/ (root)`.
2. L'adresse de l'application s'affiche (ex. `https://salyat.github.io/mes-tournees/`).
3. Dans Supabase, **Authentication > URL Configuration** : mettre cette adresse dans **Site URL** et dans **Redirect URLs**.

### 4. Installer sur les téléphones
- **Android (Chrome)** : ouvrir le lien, menu ⋮ > **Ajouter à l'écran d'accueil**.
- **iPhone (Safari)** : ouvrir le lien, bouton Partager > **Sur l'écran d'accueil**.

## Connexion
Chaque utilisateur se connecte avec son adresse e-mail et un mot de passe. À la création du compte, un e-mail de confirmation est envoyé une seule fois. « Mot de passe oublié ? » envoie un lien pour en choisir un nouveau. Pour réserver l'accès à vos équipes : Supabase > **Authentication > Sign In / Providers > Email**, désactiver **Allow new users to sign up** après avoir invité vos utilisateurs (**Authentication > Users > Invite user**).

## Limites de la version 1
- Tous les utilisateurs connectés ont les mêmes droits (pas encore de rôle « chauffeur » restreint).
- Pas de carte en direct ni d'optimisation automatique de l'ordre des arrêts (ordre réglé à la main).
- Il faut du réseau pour enregistrer une livraison ; l'interface reste affichée en cas de coupure.
- Les photos sont stockées avec des noms aléatoires dans un espace public de Supabase.

## Structure
```
index.html             page unique
style.css              apparence (thème clair et sombre)
app.js                 logique de l'application
config.js              paramètres Supabase à renseigner
manifest.webmanifest   installation sur téléphone
sw.js                  disponibilité hors ligne de l'interface
supabase/schema.sql    tables, sécurité, temps réel, photos
```
