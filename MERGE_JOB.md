# Merge to Main

You just completed a job. Now merge your changes to main.

## Steps

1. `git fetch origin main`
2. `git rebase origin/main`
3. If conflicts arise, resolve them - you remember what you changed and why
4. `git push origin HEAD:main`

## Conflict Resolution Rules

- Preserve the job's goal (what you just did)
- Accept main's updates where compatible
- If same lines conflict, combine both intents
- After resolving all conflicts, run `git rebase --continue`
- Repeat until rebase completes
