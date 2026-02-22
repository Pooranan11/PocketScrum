# Déploiement PocketScrum sur Hetzner

## Prérequis sur le VPS

Connectez-vous en SSH puis installez Docker :

```bash
# Mise à jour du système
apt update && apt upgrade -y

# Installation de Docker
curl -fsSL https://get.docker.com | sh

# Vérification
docker --version
docker compose version
```

---

## 1. Cloner le dépôt

```bash
git clone https://github.com/Pooranan11/PocketScrum.git
cd PocketScrum
```

---

## 2. Créer le fichier `.env`

```bash
cp .env.example .env
nano .env
```

Remplissez les valeurs :

```env
# Clé secrète — générez une valeur unique :
# python3 -c "import secrets; print(secrets.token_hex(32))"
SECRET_KEY=votre-cle-secrete-generee

# IP publique ou domaine de votre VPS
CORS_ORIGINS=http://votre-ip-ou-domaine

APP_ENV=production
RATE_LIMIT_PER_MINUTE=60
```

---

## 3. Lancer l'application

```bash
docker compose up -d --build
```

Vérifiez que les 3 conteneurs sont en cours d'exécution :

```bash
docker compose ps
```

Testez que le backend répond :

```bash
curl http://localhost/health
# → {"status":"ok","service":"pocketscrum"}
```

L'application est accessible sur **http://votre-ip**.

---

## 4. Commandes utiles

```bash
# Voir les logs en direct
docker compose logs -f

# Logs d'un service spécifique
docker compose logs -f backend

# Redémarrer après une mise à jour du code
git pull
docker compose up -d --build

# Arrêter l'application
docker compose down

# Arrêter et supprimer les données Redis
docker compose down -v
```

---

## 5. HTTPS avec Let's Encrypt (optionnel, nécessite un nom de domaine)

Si vous avez un domaine pointant vers votre VPS, installez Certbot :

```bash
apt install certbot python3-certbot-nginx -y

# Arrêtez nginx temporairement
docker compose stop nginx

# Obtenez un certificat
certbot certonly --standalone -d votre-domaine.com

# Modifiez nginx/nginx.conf pour écouter sur 443 et ajouter les certificats,
# puis mettez à jour docker-compose.yml pour monter /etc/letsencrypt en volume
# et exposer le port 443.

docker compose up -d --build
```

Mettez également à jour votre `.env` :
```env
CORS_ORIGINS=https://votre-domaine.com
```

---

## Architecture de production

```
Internet
    │
    ▼ :80
  Nginx (conteneur)
  ├── /          → fichiers statiques React (Vite build)
  ├── /api/*     → backend:8000 (FastAPI)
  └── /ws/*      → backend:8000 (WebSocket)
    │
    ▼
  Backend FastAPI (conteneur)
    │
    ▼
  Redis 7 (conteneur, données persistées dans un volume)
```
