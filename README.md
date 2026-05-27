# COBE Capacity Planner

A lightweight capacity planning tool for COBE. Pulls data from Productive.io, stores it locally in SQLite, and visualises team availability and project allocations by week.

---

## Running locally

### Prerequisites

- Node.js 20+
- npm

### Setup

```bash
# Install dependencies
npm install

# Create .env file
cp .env.example .env   # or create .env manually (see below)

# Apply DB schema and seed reference data
npx prisma db push
npm run db:seed
```

### Environment variables

Create a `.env` file in the project root:

```env
DATABASE_URL="file:./prisma/dev.db"
PRODUCTIVE_API_TOKEN=your_token_here
PRODUCTIVE_ORG_ID=your_org_id_here
```

The `NEXTAUTH_*` and `GOOGLE_*` variables are only needed for server mode (v1.1) and can be left out for local use.

### Start the dev server

```bash
npm run dev
```

App runs at [http://localhost:3000](http://localhost:3000).

### Useful scripts

| Command | Description |
|---|---|
| `npm run db:push` | Apply schema changes to the local DB |
| `npm run db:seed` | Seed reference data (teams, roles, seniorities) |
| `npm run db:reset` | Drop and recreate the DB, then re-seed |
| `npm run db:studio` | Open Prisma Studio to browse the DB |
| `npm run sync` | Pull latest data from Productive |
| `npm run snapshot` | Create a capacity snapshot |
| `npm run export` | Export data to JSON |
| `npm run import` | Import data from JSON |

---

## Deploying to a Hetzner VPS with GitHub Actions

### 1. Provision the server

Create a Hetzner VPS (Ubuntu 22.04 recommended), then SSH in and set it up:

```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2
sudo npm install -g pm2

# Create app directory
mkdir -p /var/www/capacity-planner
```

### 2. Add GitHub Actions secrets

In your GitHub repo go to **Settings → Secrets and variables → Actions** and add:

| Secret | Value |
|---|---|
| `VPS_HOST` | Your server IP or hostname |
| `VPS_USER` | SSH user (e.g. `root` or `deploy`) |
| `VPS_SSH_KEY` | Private SSH key that can access the server |
| `DATABASE_URL` | `file:/var/www/capacity-planner/prisma/prod.db` |
| `PRODUCTIVE_API_TOKEN` | Your Productive API token |
| `PRODUCTIVE_ORG_ID` | Your Productive org ID |

### 3. Add the GitHub Actions workflow

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}

      - name: Copy files to server
        uses: appleboy/scp-action@v0.1.7
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          source: ".next,public,prisma,package.json,package-lock.json,next.config.ts"
          target: /var/www/capacity-planner

      - name: Deploy on server
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /var/www/capacity-planner

            # Write env file
            cat > .env <<EOF
            DATABASE_URL=${{ secrets.DATABASE_URL }}
            PRODUCTIVE_API_TOKEN=${{ secrets.PRODUCTIVE_API_TOKEN }}
            PRODUCTIVE_ORG_ID=${{ secrets.PRODUCTIVE_ORG_ID }}
            EOF

            npm ci --omit=dev
            npx prisma db push
            pm2 restart capacity-planner || pm2 start npm --name capacity-planner -- start
            pm2 save
```

### 4. (Optional) Reverse proxy with Nginx

If you want the app on port 80/443, install Nginx and add a site config:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Then run `sudo certbot --nginx` to add TLS.

### 5. First deploy

Push to `main`. The workflow will build, copy the files, migrate the DB, and start the app via PM2. On subsequent pushes it restarts automatically.
