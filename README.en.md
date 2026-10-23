# WhatsApp Group Summarizer

A small self-hosted server that listens to your WhatsApp groups, asks Google Gemini what is **important or urgent**, and sends you a short summary on WhatsApp every morning. If nothing matters, no message is sent. Everything is managed from a mobile-friendly web dashboard (Hebrew, right-to-left).

[עברית / Hebrew README](README.md)

## Features

- **Collections:** group your chats by topic ("Work", "Family", "Kids"), each with its own send time and its own prompt. Each morning you get a summary of the **previous day** per collection.
- **Concise:** only what is important or urgent; nothing important means no message.
- **Several accounts:** link more than one WhatsApp number (e.g. a couple). Each account has its own password and sees only itself; the first one with a password is the manager.
- **Auto-reply:** a fixed message to chosen people during chosen hours, optionally lightly personalised by AI.
- **Phone alerts** (ntfy) when the link drops or a summary fails.
- History import, daily backups, 7-day message retention.

## Read this first

> - **This is not an official WhatsApp tool.** It links as a "companion device" through an unofficial library ([Baileys](https://github.com/WhiskeySockets/Baileys)). That goes against WhatsApp's terms of service and your account can be restricted or banned. Use at your own risk, ideally with a number you can afford to lose.
> - **Privacy:** group names, sender names and message text of the groups you choose are **sent to Google Gemini**. On the free tier Google may use the data. Do not include sensitive groups (medical, legal, other people's personal data) unless you accept that. A paid key has different terms.
> - **No transport encryption:** the dashboard is plain HTTP. Fine on a home network; use [Tailscale](https://tailscale.com) or similar for remote access.
> - The `auth/` folder holds **your WhatsApp account keys**. Anyone with those files controls the account. Never copy or publish them.

## Requirements

- An always-on machine: Raspberry Pi (a Zero W works, slowly), mini PC, home server or VPS. About 100 MB of RAM per linked account (max 4 accounts).
- Node.js 18 or newer.
- A free Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey).
- Your phone, once, to scan a QR code (WhatsApp, Linked devices).

## Install

```bash
# 1. Node.js 18+ (see nodejs.org). On a Raspberry Pi Zero / Pi 1 (armv6) use the unofficial build:
cd /tmp
curl -O https://unofficial-builds.nodejs.org/download/release/v18.20.4/node-v18.20.4-linux-armv6l.tar.xz
sudo tar -xJf node-v18.20.4-linux-armv6l.tar.xz -C /usr/local --strip-components=1

# 2. Code and dependencies
sudo apt install -y git
git clone https://github.com/<USER>/<REPO>.git whatsapp-summarizer
cd whatsapp-summarizer
npm install

# 3. Try it
npm start        # then open http://<machine-ip>:3000  (hostname -I shows the IP)
```

Run it permanently with systemd:

```bash
nano deploy/whatsapp-summarizer.service      # set User and the two paths
sudo cp deploy/whatsapp-summarizer.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now whatsapp-summarizer
journalctl -u whatsapp-summarizer -f         # logs
```

## First-time setup (5 minutes)

1. **Password first:** Settings, "Security and system", "Dashboard password". Until you set one, anyone on your network can open the dashboard.
2. **Gemini key:** same section, "Gemini key".
3. **Link WhatsApp:** on the home screen press "Show QR code", then on the phone WhatsApp, Linked devices, Link a device. The code is valid for about a minute and refreshes itself.
4. **Pick groups:** "Groups" tab, switch on monitoring for the groups you want. **A group that is not monitored is not read at all.**
5. **Create a collection:** "Collections" tab, green "+" button: name, send time, groups, optional extra prompt.
6. **Test:** on home press the green floating button, choose a collection, "Summarize now" (last 24 hours).
7. Monitored groups that are in no collection are summarised together as the "main summary" at its own time.

Capture starts only when the link is up and the group is monitored. Earlier messages are not available, except the short history WhatsApp sends right when you link a device (Settings, "History import").

## Good to know

- Scheduled summaries cover the **previous calendar day**; "Summarize now" covers the last 24 hours.
- "Nothing important/urgent" is recorded in the history and nothing is sent.
- **Auto-reply:** Settings, "Auto-reply". Private chats only, new messages only, at most 20 replies per hour, once per person per cool-down. AI personalisation is off by default; when on, the sender's first name and message are sent to Gemini and any failure falls back to your own text.
- **Phone alerts:** install the free [ntfy](https://ntfy.sh) app, subscribe to **exactly** the topic name shown in Settings, press "Send test".
- **Remote access:** do not expose the dashboard to the internet. Use Tailscale on the server and your phone.
- **Files:** `config.json` (settings, password hashes), `auth/` (WhatsApp keys, secret), `data/` (messages for 7 days, contacts, history), `backups/` (daily, 7 days). All are in `.gitignore`. Backups are on the same machine, so copy `config.json` and `auth/` somewhere safe now and then.

## Updating

```bash
git pull && npm install && sudo systemctl restart whatsapp-summarizer
```

Do **not** restart repeatedly: stopping in the middle of receiving can leave encryption keys half-written and messages stop decrypting. One clean restart is enough.

## Troubleshooting

| Problem | What to do |
|---|---|
| No QR code | Reload the page and wait a few seconds, or press "Show QR code". |
| `Closed (428)` again and again, messages not captured | Link again (Settings, "History import"). |
| `Closed (401)` | The device was removed on the phone. Link again. |
| `Closed (440)` | A second copy of the server is using the same `auth/` folder. Keep one. |
| Recipient sees "Waiting for this message" | The server could not re-send after a restart. The text is on the home screen under "Last summary". |
| Forgot the password | Stop the server, edit `config.json`: delete the account's `auth` field (and `authManager` if needed), start again. The dashboard stays open until you set a new password. |

Diagnostics from the machine itself: `curl localhost:3000/_diag` (counters only, no content).

## Configuration

| | |
|---|---|
| `COUNTRY_CODE` env var or `countryCode` in `config.json` | Country code used to complete local numbers such as `052-1234567`. Default `972` (Israel). |
| `port` in `config.json` | Dashboard port. Default `3000`. |

## Development

```bash
npm test       # unit tests for the pure logic
```

One server file (`server.js`) and one static dashboard (`public/index.html`, no build step). Contributions welcome.

## License

[MIT](LICENSE). Provided as is, without warranty.
