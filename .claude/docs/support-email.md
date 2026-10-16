# Support email

**Writing an email means creating a `.txt` file in the user's Downloads** — `~/Downloads` on this machine (where `.eml` files land) — not just printing the draft in chat. Use `reply-<name>.txt` for support replies, for review before sending. Follow VOICE.md guidelines — direct, specific, no hedging. Offline Downloads files may carry reporter names/emails; commits, PRs, and issues may not (see `.claude/rules/support-confidentiality.md`).

**Never infer someone's gender, title, or pronouns from their name.** A first name is not evidence. In English, address them by full name or first name ("Hi Nina Hoog," / "Hi Nina,") and use they/them if a pronoun is unavoidable — never "Mr."/"Ms.". In German the formal salutation is **`Guten Tag <full name>,`**, not `Sehr geehrte Frau <surname>` / `Sehr geehrter Herr <surname>`, both of which force a guess. Match the writer's register: if they wrote `Sie`, answer with `Sie`; if they wrote `du`, answer with `du`. (2026-07-28: a German cancellation reply was drafted as "Hallo Frau Hoog" purely on the strength of the first name, and Alexander caught it before it went out.)

Additional rule (scope: hand-written support replies ONLY — product email templates under `src/services/EmailService/templates/` follow VOICE.md, which uses em-dashes deliberately; do not "fix" them): **never use dashes (em-dash or hyphen) in support emails.** Dashes split focus and make complex ideas feel fragmented. Use periods and new sentences instead. Example: "Notion changed their export format. Page emoji now lives in a `data-emoji` attribute." not "Notion changed their export format — page emoji now lives in a `data-emoji` attribute."

## Sending

**Support mail goes out from `support@2anki.net` through `himalaya`, never through the Gmail MCP.** The Gmail connector sends from Alexander's personal address, so the customer's reply lands outside the support inbox and the thread never reaches `himalaya`'s `Sent` folder. The `support` account in `~/.config/himalaya/config.toml` is the default account; it holds the IMAP and SMTP credentials, so no secret is needed on the command line. (2026-10-16: a refund offer to user 23291 went out via the Gmail MCP from the personal address while signed `support@2anki.net`; nothing in this doc had named the tool.)

- Reply to an inbound message by its envelope id so the thread stays intact: `himalaya envelope list` to find the id, then `himalaya message reply <id> --send` after the draft in Downloads is approved.
- A first contact (no inbound mail to reply to) is a file with `From: 2anki Support <support@2anki.net>`, `To:`, `Subject:`, a blank line and the approved body, sent with `himalaya message send --save Sent <path>`.
- Send only after Alexander says to send. One message per customer; a mis-sent mail is not resent from the other address.
