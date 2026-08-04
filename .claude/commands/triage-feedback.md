---
description: Synthesize raw user feedback (email, Discord, survey responses) into themes and draft GitHub issues
argument-hint: paste the raw feedback after the command
---

Use the `pm` agent to process the feedback I'll paste below.

**First, check whether it's a regression** ("worked before, broke recently / stopped working"). If so, the answer is a commit, not a theme — investigate it yourself (or via the `engineer` / `Explore` agent) with `git log` / `git show` / `git log -S "<gate/condition>"` to find the introducing commit *before* drafting anything, and lead the output with that commit. `pm` synthesizes the public issue; it does **not** read the codebase to diagnose. (Do this even though this command says "use the `pm` agent" — routing a regression's root-cause to pm is the wrong tool.) For non-regression feedback, proceed with `pm` as below.

**Second, for any bug report, pin the reporter's entry point before diagnosing** (see `.claude/docs/first-time-fix.md`). Identify which route, job, or worker actually ran for them — manual action vs background poll vs webhook vs upload — and confirm it from their prod rows or logs when accessible. The issue draft must name that entry point. A diagnosis that starts at the unit whose name matches the symptom produces fixes that test green and never execute on the user's path (one bug burned three support round-trips in June 2026 exactly this way).

**Third, if the report says "still broken after the fix"**, treat it as a wiring/reachability bug, not a logic bug: grep every construction site of the fixed class, verify the fix is invoked on the reporter's path, and lead the output with the reachability finding before re-opening any logic.

Steps:

1. Read the feedback below the `---` line.
2. Synthesize using the feedback workflow in `.claude/agents/pm.md`.
3. For each theme rated High urgency, draft a GitHub issue:

   ```
   ## Issue: [Title]
   **Labels**: [bug / feature / ux / etc.]
   **Goal alignment**: one sentence connecting this to the goal in CLAUDE.md.

   ### Problem
   [synthesized from feedback]

   ### User signal (verbatim quotes)
   - "..."
   - "..."

   ### Proposed direction
   [one-paragraph recommendation, not a full spec]
   ```

4. End with a one-line summary: "X themes, Y high-urgency, suggest filing Z issues."

Do not file the issues yet — output drafts so I can review and post them.

---

$ARGUMENTS
