# WhatsApp Affiliate Bot

## Reliable single-server deployment

`deploy/wa-bot.service` runs Node and all Chrome children in one systemd group,
with a 512 MiB RAM ceiling and up to 1 GiB swap on a shared 1 GiB EC2 host.
Do not run PM2 and this service against the same LocalAuth directory together.
These limits protect the other bot and host; sustained memory pressure still
requires more RAM or a lighter browser workload.

Matching source messages are saved in `.data/queue.json` and processed one at a
time. URL resolution has two workers. Successful message IDs are retained across
restarts. Failed jobs retry with backoff up to five attempts and remain saved for
inspection; an administrator can retry them with `POST /api/queue/retry`.
WhatsApp does not provide an exactly-once guarantee for ambiguous send failures.

`GET /healthz` returns 200 only when connected and without failed queue jobs.
`GET /api/stats` includes available host RAM, whole-service RAM, swap and queue
counts. Host usage excludes reclaimable cache where Linux exposes MemAvailable.
The existing public dashboard can still display these read-only metrics.
Private logs, chat listing, QR login and pairing/retry controls require an SSH
tunnel or the optional `DASHBOARD_TOKEN` (X-Dashboard-Token header, or HTTP Basic
password). A connected bot rejects attempts to reset pairing.

Disconnects, failed initialization and stuck shutdowns exit for the service
manager to restart after a delay. Never delete `.wwebjs_auth` during an ordinary
restart; it contains the saved login. Run `npm test -- --runInBand` before rollout.

A Node.js-based WhatsApp bot that automatically parses Amazon and Flipkart links sent to it, processes them, and replies with properly formatted affiliate links containing your unique tags.

## Core Features
* **Unified Link Processor**: All URLs are routed through `src/linkProcessor.js`.
* **Amazon Links**: Handles standard URLs, `amzn.to` shortlinks, and `link.amazon` deep links. It strips unnecessary tracking parameters (like `?th=1`) and appends the configured affiliate tag.
* **Flipkart Links**: Direct replacement strategy to bypass WAF limitations on Cuelinks. 
* **Self-loop Protection**: The bot intelligently ignores its own messages to prevent infinite processing loops.

## Infrastructure & Hosting (AWS EC2)
The bot is hosted on an AWS EC2 instance running Ubuntu. 

### Storage Configuration (Expanded)
WhatsApp Web sessions and PM2 logs can consume space over time. The instance's EBS volume has been expanded from the default 8GB to **15GB**.

**Storage Expansion Reference:**
If the disk ever needs to be expanded again in AWS, the following commands were used to safely grow the partition and filesystem without rebooting:
```bash
# 1. Grow the partition
sudo growpart /dev/nvme0n1 1

# 2. Resize the ext4 filesystem to use the new space
sudo resize2fs /dev/nvme0n1p1

# 3. Verify the new size
df -h
```

### Process Management
The application is managed using **PM2** to ensure it stays online continuously and automatically restarts on failure.
* **View Logs**: `pm2 logs wa-bot`
* **Restart Bot**: `pm2 restart wa-bot`
* **Monitor Performance**: `pm2 monit`

## Authentication & Dashboard
The bot exposes an Express web server on port `3000` to handle authentication.
* **Dashboard URL**: `http://<YOUR_EC2_ELASTIC_IP>:3000`
* **Login**: Navigate to the dashboard to scan the generated QR code using WhatsApp's "Linked Devices" feature.
* **Session Persistance**: Once authenticated, the session is saved securely in the `.wwebjs_auth/` directory. If PM2 restarts the bot, it will automatically restore the session without requiring a new QR scan.
