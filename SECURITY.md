# אבטחה / Security

## דיווח על פגיעות / Reporting a vulnerability

מצאתם פגיעות? **אל תפתחו Issue ציבורי.** השתמשו ב-"Report a vulnerability" בלשונית Security של המאגר ב-GitHub (דיווח פרטי).

Found a vulnerability? **Please do not open a public issue.** Use "Report a vulnerability" in the repository's Security tab (private report).

## מודל האיום / Threat model

**מה מוגן:** הסיכומים, הודעות הקבוצות, אנשי הקשר, מפתח ה-Gemini ומפתחות הוואטסאפ, מפני מי שמגיע לדשבורד דרך הרשת.
**What is protected:** summaries, group messages, contacts, the Gemini key and the WhatsApp keys, against anyone who can reach the dashboard over the network.

| | |
|---|---|
| **כתובת האזנה / Listen address** | ברירת המחדל `0.0.0.0` (כל הממשקים), כדי שאפשר לפתוח את הדשבורד מהטלפון. `HOST=127.0.0.1` מגביל למחשב עצמו (לשימוש מאחורי reverse proxy או Tailscale Serve). Default `0.0.0.0` so a phone can open it; `HOST=127.0.0.1` restricts it to the machine itself. |
| **ללא סיסמה / No password** | כל עוד לא הוגדרה סיסמה, השרת עונה **רק** לרשת המקומית (`127.0.0.1`, `10/8`, `172.16/12`, `192.168/16`, Tailscale `100.64/10`, `fc00::/7`, `fe80::/10`) ומחזיר 403 לכתובות ציבוריות. Until a password exists the server answers **only** local/private addresses and returns 403 to public ones. |
| **סיסמאות / Passwords** | scrypt עם salt אקראי, 8 תווים לפחות, השוואה בזמן קבוע. ניסיונות כניסה מוגבלים (5 ל-10 דקות לכתובת). scrypt + random salt, 8+ characters, constant-time compare, 5 attempts per 10 minutes per address. |
| **סשנים / Sessions** | מפתח אקראי של 256 ביט בעוגיית `HttpOnly; SameSite=Strict` (ו-`Secure` מאחורי HTTPS). בשרת נשמר רק גיבוב SHA-256. 256-bit random token; only its SHA-256 is stored. |
| **הרשאות / Access control** | חשבון רגיל רואה רק את עצמו. הגדרות מערכת (מפתח Gemini, מודל, התראות, הוספת חשבון) למנהל בלבד. A regular account sees only itself; system settings are manager-only. |
| **דפדפן / Browser** | כותרות CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`. כל טקסט שמגיע מוואטסאפ מוצג אחרי escaping. |
| **קבצים / Files** | `config.json`, `auth/`, `data/` בהרשאות בעלים בלבד, ואסורים ב-git. |
| **קלט / Input** | מזהים כמו `__proto__` ו-`constructor` נדחים, גוף בקשה עד 100KB, מזהי חשבון נבדקים מול הקיימים. |

## מה **לא** מוגן / Not covered

- **HTTP בלי הצפנה:** סיסמה שמוקלדת ברשת ביתית עוברת גלויה. להגנה מלאה: [Tailscale](https://tailscale.com) או reverse proxy עם HTTPS. / Passwords travel in clear text over plain HTTP on a LAN; use Tailscale or an HTTPS reverse proxy.
- **מי ששולט במחשב** או מחזיק בקבצי `auth/` שולט בחשבון הוואטסאפ. / Whoever controls the machine or holds `auth/` controls the WhatsApp account.
- **הזרקת הנחיות (prompt injection):** כותב בקבוצה יכול לנסות להשפיע על תוכן הסיכום, כי הטקסט שלו נשלח ל-Gemini. ההנחיה מורה למודל להתייחס להודעות כנתונים בלבד, אבל אין הגנה מוחלטת. אל תפעלו לפי קישור או מספר טלפון שמופיעים בסיכום בלי לבדוק במקור. / Text written in a group is sent to Gemini; the prompt tells the model to treat it as data only, but this is not a guarantee. Verify links and phone numbers at the source.
- **הספרייה הבלתי רשמית** (Baileys) לא עברה ביקורת. / The unofficial library has not been audited.
- **DNS rebinding** נגד דשבורד בלי סיסמה ברשת מקומית: סיכון נמוך, ועוד סיבה להגדיר סיסמה. / DNS rebinding against a password-less LAN dashboard is a low risk and one more reason to set a password.

## בדיקות / Tests

```bash
npm test                  # unit tests

# security regression tests: start the server in an EMPTY folder whose config.json is
#   {"port":3123,"accounts":{}}
# and then run
node test/security.mjs
```
