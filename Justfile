# PocketScrum — Justfile racine
# Utilisation : just <commande>

# Afficher les commandes disponibles
default:
    @just --list

# Lancer backend + frontend en parallèle
dev:
    #!/bin/bash
    trap 'kill $(jobs -p) 2>/dev/null' EXIT INT TERM
    (cd backend && .venv/bin/uvicorn main:app --reload --host 0.0.0.0 --port 8000) &
    (cd frontend && npm run dev) &
    wait
