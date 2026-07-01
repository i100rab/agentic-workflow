# Deploying on fresh OCI infrastructure

This provisions a new compute instance, deploys the web console (real
agents + the optimizer library) on it with HTTPS and username/password
login, verifies it end to end, and only then removes the old VM.

**Order matters here and deliberately doesn't match the order you asked
for.** OCI's free-tier ARM capacity ("out of host capacity" errors) is
unreliable right now, and free-tier ARM limits were just halved in
mid-June 2026. If the old VM is deleted first and the new one fails to
provision, you're left with nothing running. Provisioning the new instance
first costs nothing extra and removes that risk entirely.

---

## Part 0 — Which shape to use

Two Always Free options, real tradeoff between them, worth deciding before
you start rather than mid-setup:

**VM.Standard.A1.Flex (Ampere ARM)** — as of June 2026, free tier accounts
get 2 OCPUs / 12 GB total (down from 4/24 previously; Pay-As-You-Go
accounts with a card on file may still get the higher limit). Plenty of
headroom for this app, no OOM risk. The catch: it's frequently unavailable
("out of host capacity") in busy regions and availability domains. If your
first attempt fails, try a different availability domain, or a nearby
region, or just retry every few minutes.

**VM.Standard.E2.1.Micro (AMD)** — 1/8 OCPU, 1 GB RAM. This is the
memory-constrained shape that caused the OOM issue on the old VM. More
reliably available, but you'll need the same swapfile fix as before, and
it's tighter even with that.

**Recommendation:** try A1.Flex first, with 1 OCPU / 6 GB (no need for the
full 2/12 for this app). Fall back to E2.1.Micro + swapfile only if A1.Flex
capacity genuinely isn't available in your region after a few retries.

---

## Part 1 — Provision the new instance

In the OCI Console:

`Compute → Instances → Create Instance`

- **Name:** something identifiable, e.g. `agentic-workflow-vm`
- **Image:** Ubuntu 22.04 (simpler package management than Oracle Linux for
  this stack — `ufw` instead of `firewalld`, no SELinux by default, which
  removes two of the specific issues from the last deployment)
- **Shape:** Change shape → Ampere → VM.Standard.A1.Flex → set 1 OCPU / 6 GB
  (see Part 0)
- **Networking:** create a new VCN if you don't want to reuse the old one —
  the wizard's "Create new virtual cloud network" default option handles
  the VCN, subnet, internet gateway, and route table for you
- **SSH keys:** generate a new pair or reuse an existing one:
  ```bash
  ssh-keygen -t ed25519 -f ~/.ssh/oci-agentic-workflow
  ```
  Paste the contents of the `.pub` file into the console's SSH key field.
- Click **Create**, and note the public IP once it's running.

If you hit "out of host capacity": change the availability domain dropdown
and retry, or switch region if you have a preferred nearby one, or fall
back to E2.1.Micro per Part 0.

---

## Part 2 — Networking: Security List

`Networking → Virtual Cloud Networks → (your new VCN) → Security Lists → Default Security List`

Add ingress rules if they're not already present from the wizard:

- TCP 22 (SSH) — usually added automatically
- TCP 80 (HTTP) — needed for Let's Encrypt and the redirect to HTTPS
- TCP 443 (HTTPS) — the actual app traffic

Source CIDR `0.0.0.0/0` for both, matching destination port.

---

## Part 3 — SSH in and confirm the VM is reachable

```bash
ssh -i ~/.ssh/oci-agentic-workflow ubuntu@<new-public-ip>
```

(Username is `ubuntu` for the Ubuntu image, `opc` for Oracle Linux.)

---

## Part 4 — Base setup

Swapfile (worth having regardless of shape, cheap insurance):

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Node.js — on Ubuntu, the NodeSource setup script is simpler than the binary
tarball approach used last time, and shouldn't hit the same OOM issue given
the extra RAM on A1.Flex:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
```

If you fell back to E2.1.Micro, use the binary tarball approach instead
(same as before) to avoid compiling anything during install:

```bash
cd ~
wget https://nodejs.org/dist/latest-v20.x/node-v20.*-linux-x64.tar.xz
tar -xf node-v20.*-linux-x64.tar.xz
sudo cp -r node-v20.*-linux-x64/{bin,lib,include,share} /usr/local/
node -v
```

Install nginx and certbot:

```bash
sudo apt-get update
sudo apt-get install -y nginx certbot python3-certbot-nginx apache2-utils
```

(`apache2-utils` gives you `htpasswd`, needed for Part 8.)

---

## Part 5 — Get the code

The repo needs pushing first — see Part 11. Once it's on GitHub:

```bash
cd ~
git clone https://github.com/i100rab/agentic-workflow.git
cd agentic-workflow
npm install --production
```

---

## Part 6 — Environment variables

```bash
cp .env.example .env
nano .env
```

Set:
```
ANTHROPIC_API_KEY=sk-ant-...
OPTIMIZE=true
```

`OPTIMIZE=true` is what routes every agent through the caching +
compression wrapper for the live demo. Leave it unset for a raw comparison
run if you want to show the difference live.

---

## Part 7 — Run persistently with pm2

```bash
sudo npm install -g pm2
pm2 start server.js --name agentic-workflow-web
pm2 save
pm2 startup
```

Run the command `pm2 startup` prints, so it survives a reboot. Confirm it's
up:

```bash
curl -I http://localhost:3001
```

---

## Part 8 — nginx: HTTPS + username/password

The new public IP gives you a fresh sslip.io hostname automatically — no
DNS setup needed, since sslip.io just resolves `<ip-with-dashes>.sslip.io`
back to that IP. If your new IP is e.g. `140.238.12.34`, your hostname is
`140-238-12-34.sslip.io`.

**Set the password first:**

```bash
sudo htpasswd -c /etc/nginx/.htpasswd yourusername
```

(You'll be prompted to set a password. Drop the `-c` if adding a second
user later, `-c` overwrites the file.)

**Get the certificate:**

```bash
sudo certbot certonly --nginx -d 140-238-12-34.sslip.io
```

(Replace with your actual dash-formatted IP.)

**nginx config**, save as `/etc/nginx/sites-available/agentic-workflow`:

```nginx
server {
    listen 443 ssl;
    server_name 140-238-12-34.sslip.io;

    ssl_certificate     /etc/letsencrypt/live/140-238-12-34.sslip.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/140-238-12-34.sslip.io/privkey.pem;

    auth_basic "Restricted";
    auth_basic_user_file /etc/nginx/.htpasswd;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }

    # SSE stream needs buffering off, or live progress won't appear live
    location /api/runs/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
        proxy_read_timeout 3600s;
    }
}

server {
    listen 80;
    server_name 140-238-12-34.sslip.io;
    return 301 https://$host$request_uri;
}
```

Enable it and reload:

```bash
sudo ln -s /etc/nginx/sites-available/agentic-workflow /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

**Ubuntu firewall** — `ufw` may be inactive by default, but check:

```bash
sudo ufw status
# if active:
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

---

## Part 9 — Verify end to end

1. Visit `https://140-238-12-34.sslip.io` (your actual hostname) — browser
   should show a valid padlock, no certificate warning.
2. You should hit a username/password prompt before seeing anything else.
3. After logging in: the console loads, enter a topic, set a budget cap,
   start a run, watch the five agents progress live.
4. Check `pm2 logs agentic-workflow-web` if anything looks wrong.

Don't move to Part 10 until this all genuinely works.

---

## Part 10 — Now remove the old VM

`Compute → Instances → (old instance) → Terminate`

You'll be asked whether to also delete the attached boot volume — fine to
delete it once the new deployment is confirmed working, since there's
nothing on it you need anymore.

---

## Part 11 — Push the code to GitHub

This needs to happen before Part 5, but is last here since it's the one
step outside the VM. Generate a fresh fine-grained personal access token
(Settings → Developer settings → Personal access tokens → Fine-grained
tokens, scoped to this repo only, Contents: Read and write) and send it
over — I'll push directly, then you revoke it. This is what makes the
optimizer library, the web console, and the support-triage example
actually available to pull down and hand to leadership as a real,
version-controlled deliverable.
