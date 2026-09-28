---
title: 'Privacy Policy'
description: 'Privacy policy for 2anki.net'
---

If you have any questions about our privacy practices, please don't hesitate to reach out to us at [support@2anki.net](mailto:support@2anki.net).

## Data Processing

Some file handling occurs on external servers to reduce browser overhead. Failed conversions are logged in the server error log (no file contents), but your uploaded files are **not** stored or emailed anywhere unless you opt in via the **Share files when a conversion fails** setting on the [/debug](/debug) page. When that opt-in is on, the uploaded files and error details are sent to the 2anki team so we can reproduce the issue.

If you accidentally upload sensitive information, contact us and we'll delete the server logs.

We log IP addresses for research purposes. If you sign in with Google, we also store your email address and name, as described below. We don't collect or harvest any other personally identifiable information.

The source code is available at [2anki/server](https://github.com/2anki/server).

## Signing in with Google and Google Drive

### Sign in with Google

When you sign in with Google, we read your email address and name from your Google account. We use your email to identify your account and sign you in, and your name to show who is signed in. We store both with your 2anki account and mark your email as verified. We don't read or store your Google profile picture, we don't share this data with anyone, and we never use it for advertising.

### Google Drive

When you pick a file with the Google Drive picker, 2anki uses the `drive.file` permission. It gives us access only to the files you choose in the picker, never the rest of your Drive. We read the file once, build your deck from it, and send the deck straight back. The working copy is deleted within 2 hours, the same as any other upload, and we don't keep your Drive access token afterward.

We do keep a short record of the files you picked (the file's name, type, size and a link back to it in your Drive) in your account, so you can convert them again from your upload list. You can remove any entry from that list at any time, and the whole list is removed when you delete your account.

You can review or revoke 2anki's access to your Google account and Drive at any time at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

2anki's use and transfer to any other app of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

## Service Providers

| Service             | Purpose                                                                                                                                                    | Privacy Policy                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Hetzner             | Dedicated servers hosting                                                                                                                                  | [Privacy Policy](https://www.hetzner.com/legal/privacy-policy)                                |
| Netlify             | Legacy domain redirects (2anki.com, notion.2anki.net)                                                                                                      | [Privacy Policy](https://www.netlify.com/privacy/)                                            |
| DigitalOcean        | Cloud storage                                                                                                                                              | [Privacy Policy](https://www.digitalocean.com/legal/privacy-policy/)                          |
| Notion              | Notion integration — pages you connect for conversion                                                                                                      | [Terms and Privacy](https://www.notion.so/Terms-and-Privacy-28ffdd083dc3473e9c2da6ec011b58ac) |
| Hotjar              | User interaction analysis                                                                                                                                  | [Privacy Policy](https://www.hotjar.com/legal/policies/privacy/)                              |
| Google Analytics    | Usage tracking                                                                                                                                             | [Privacy Policy](https://policies.google.com/privacy?hl=en-US)                                |
| Google Sign-In      | Optional sign-in — reads your email address and name, see above                                                                                            | [Privacy Policy](https://policies.google.com/privacy?hl=en-US)                                |
| Google Drive        | Optional file picker — reads only the files you choose, see above                                                                                          | [Privacy Policy](https://policies.google.com/privacy?hl=en-US)                                |
| 2anki (self-hosted) | Anonymized error reporting — no file contents or personal data, just route, status, and timing; stored on our own infrastructure and deleted after 30 days | —                                                                                             |
| Claude (Anthropic)  | Optional AI features only — flashcard generation and converting PDFs and other files into cards. Used only when you turn on an AI option.                  | [Privacy Policy](https://www.anthropic.com/legal/privacy)                                     |
| Stripe              | Payment processing and subscription management                                                                                                             | [Privacy Policy](https://stripe.com/privacy)                                                  |
| SendGrid            | Sending transactional emails                                                                                                                               | [Privacy Policy](https://www.twilio.com/en-us/legal/privacy)                                  |
