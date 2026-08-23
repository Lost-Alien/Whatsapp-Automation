# WhatsApp Affiliate Bot

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
