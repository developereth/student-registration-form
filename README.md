# Officer Registration Form

Simple registration form for college admin officers with Telegram notifications.

## Setup Instructions

### 1. Prerequisites
- [GitHub account](https://github.com)
- [Cloudflare account](https://cloudflare.com)
- [Upstash account](https://upstash.com)
- Telegram account

### 2. Create Telegram Bot
1. Open Telegram and search for `@BotFather`
2. Send `/newbot` and follow instructions
3. Save the bot token
4. Search for your bot and send `/start`
5. Get your chat ID from `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`

### 3. Create Upstash Redis Database
1. Go to [Upstash Console](https://console.upstash.com)
2. Create new Redis database
3. Copy the REST URL and token

### 4. Configure Environment Variables
Edit `wrangler.toml`:
- `FORM_PASSWORD` - Password for officers to access the form
- `ADMIN_PIN` - Your private PIN for admin panel
- `UPSTASH_REDIS_URL` - Your Upstash Redis URL
- `UPSTASH_REDIS_TOKEN` - Your Upstash Redis token
- `TELEGRAM_BOT_TOKEN` - Your Telegram bot token
- `TELEGRAM_CHAT_ID` - Your Telegram chat ID

### 5. Deploy to Cloudflare
```bash
# Install Wrangler
npm install

# Login to Cloudflare
npx wrangler login

# Deploy
npx wrangler deploy
