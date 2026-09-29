# Lenra API — manual production deployment

Production deploys are **manual** on the VPS (SSH + tmux). GitHub Actions runs **tests only** — it does not deploy.

Priorities: **SAFE → SIMPLE → FAST**

---

## First-time server setup

1. Clone the repo (if not already present):

   ```bash
   git clone git@github.com:SabawSh/lenra-api.git /home/ubuntu/projects/lenra-api
   ```

2. Ensure environment file exists (not in git):

   ```bash
   ls -la /home/ubuntu/projects/lenra-api/.env
   ```

3. Make scripts executable:

   ```bash
   cd /home/ubuntu/projects/lenra-api
   chmod +x scripts/deploy-production.sh scripts/docker-cleanup.sh
   ```

4. Confirm Docker and the MySQL network:

   ```bash
   docker info
   docker network inspect mysql-network
   ```

5. Nginx should already proxy `/api/` to `127.0.0.1:4000` — **do not change nginx** as part of deploy.

---

## Deploy a release

From your laptop:

```bash
ssh ubuntu@<your-vps-host>
```

On the VPS, use **tmux** so `docker build` continues if SSH disconnects:

```bash
tmux new -s deploy
# reattach later: tmux attach -t deploy
```

Checkout the exact commit you intend to ship (**the deploy script verifies HEAD matches the SHA you pass**):

```bash
cd /home/ubuntu/projects/lenra-api
git fetch origin
git checkout <full-or-short-git-sha>
git rev-parse HEAD   # confirm
```

Run deploy (use the same SHA):

```bash
./scripts/deploy-production.sh <git-sha>
```

What the script does:

1. Verifies git HEAD matches `<git-sha>` (no automatic `git checkout`)
2. Checks disk, Docker, `.env`
3. `docker build -t lenra-api:<sha> .`
4. Tags current production as `lenra-api:previous`
5. Starts **candidate** `lenra-api-new` on `127.0.0.1:4001`
6. Waits for `GET /health` and `GET /ready` on the candidate
7. Stops old `lenra-api`, starts new `lenra-api` on `127.0.0.1:4000`
8. Verifies `/ready` again; on failure restores `lenra-api:previous`
9. Writes `/home/ubuntu/projects/lenra-api/.deploy-state`

Detach tmux: `Ctrl-b` then `d`.

---

## Rollback

Each successful deploy tags the prior production image as `lenra-api:previous` and saves inspect output to `.deploy-previous-inspect.json`.

Check state:

```bash
cat /home/ubuntu/projects/lenra-api/.deploy-state
```

Manual rollback to the previous image:

```bash
cd /home/ubuntu/projects/lenra-api
docker stop lenra-api
docker rm -f lenra-api
docker run -d \
  --name lenra-api \
  --restart unless-stopped \
  --network mysql-network \
  --env-file /home/ubuntu/projects/lenra-api/.env \
  -p 127.0.0.1:4000:4000 \
  lenra-api:previous
curl -sf http://127.0.0.1:4000/health
curl -sf http://127.0.0.1:4000/ready
```

Or rollback to a specific SHA tag:

```bash
docker run -d ... lenra-api:<git-sha>
```

If a deploy **failed during cutover**, `deploy-production.sh` attempts to restore `lenra-api:previous` automatically.

---

## Disk cleanup

Safe cleanup (Lenra API images only — **never** volume prune):

```bash
cd /home/ubuntu/projects/lenra-api
./scripts/docker-cleanup.sh
```

Keeps: running image, `lenra-api:previous`, `lenra-api:latest`.  
Removes: other `lenra-api:<sha>` tags and old deploy tarballs.

**Never run** on production:

- `docker system prune -af`
- `docker image prune -af`
- `docker volume prune`

---

## Safety rules

- Deploy only from a **verified** git checkout; the script refuses SHA mismatch.
- Do not deploy from GitHub Actions to production.
- Candidate must pass `/ready` (includes DB) before production is stopped.
- MySQL data lives in MySQL containers/volumes — cleanup scripts do not touch volumes.

---

## Local smoke build (optional)

On a dev machine:

```bash
./scripts/docker-build.sh $(git rev-parse HEAD)
```
