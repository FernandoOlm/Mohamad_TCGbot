#!/bin/bash
# update.sh — Atualiza o bot e reinicia via PM2
# Disparado pelo comando !restart do Ferdinando

cd /home/folmdelima/Ferdinando_Cloud

sleep 2

git stash
git pull origin main
git stash pop
pm2 restart ferdinando-ia
