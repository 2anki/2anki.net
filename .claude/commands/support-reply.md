---
description: Draft a reply to a support email - Alexander reviews and sends
argument-hint: paste the user email
---

Use the `pm` agent (with engineer if technical diagnosis is needed).

1. Read the user email below the `---` line.
2. If the issue requires technical investigation (conversion error, billing edge case, account state), use Grep to find the relevant code path before drafting — and for bugs, pin the reporter's runtime entry point first (manual action vs background job vs webhook; see `.claude/docs/first-time-fix.md`).
3. Draft a reply that:
   - Opens with acknowledgement (one sentence, not effusive).
   - Answers the question directly. If we know the answer, give it. If not, say what we'll do next and when.
   - If it's a bug, file a draft GitHub issue inline (don't send to user, but include in your output).
   - Closes warmly but briefly.
4. **The "fixed" gate.** Never draft the word "fixed" (or equivalent) for a bug unless all of: the fix is merged, deployed, confirmed reachable on the reporter's own trigger path, and — when their data is inspectable — their prod rows or a prod log line show the resolved behavior. Anything less, the draft says what actually happened: "shipped a change; your next sync should show X — tell me if it doesn't." If the reporter has already bounced one fix claim, the bar is observation, not inference: watch their account exhibit the fixed behavior in prod before the draft goes out. Two false "fixed" claims in one June 2026 thread is the reason this gate exists.
5. If the email contradicts a previous "fixed" reply, the diagnosis starts from reachability (was the fix ever invoked on their path?), not from the fixed logic.
6. Flag if this email reveals a recurring theme worth feeding into `/triage-feedback` later.

Output:
- **Draft reply** (ready to copy-paste-send)
- **Internal note** (anything Alexander should know but not say to the user)
- **Issue draft** (if applicable)

---

$ARGUMENTS
