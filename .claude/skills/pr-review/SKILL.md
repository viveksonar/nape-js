---
name: pr-review
description: Review a GitHub pull request on the NewKrok/nape-js repo end-to-end — checkout, rebase test, full pre-push checks (format, lint, test, build), engine-safety review, and a merge recommendation. Trigger when the user pastes a PR URL/number for nape-js, or types `/pr-review`.
---

# PR review — nape-js

This skill walks through the standard nape-js PR review process. Every PR to this repo is reviewed using this playbook collaboratively with Claude before the user decides on merge.

## Inputs

Accept any of:

- A full URL like `https://github.com/NewKrok/nape-js/pull/172`
- Just a number like `172`
- The phrase "this PR" or "the open PR" when the current branch is a PR branch

## Steps

Work through these in order. Use the TodoWrite tool to track progress. Each step is a checkpoint — if any one fails, stop and report; don't bury blockers in a long summary.

### 1. Fetch metadata + linked issue

```bash
gh pr view <N> --repo NewKrok/nape-js --json title,author,state,mergeable,headRefName,baseRefName,additions,deletions,changedFiles,body,closingIssuesReferences,commits
gh pr view <N> --repo NewKrok/nape-js --comments
```

Read the PR body and find any referenced issue (`Closes #N`, `Fixes #N`, or prose like "the issue listed"). If the issue isn't explicitly linked via `closingIssuesReferences`, search:

```bash
gh issue list --repo NewKrok/nape-js --state all --search "<keywords from PR title>" --limit 5 --json number,title,state
gh issue view <issue#> --repo NewKrok/nape-js
```

**Report**: PR title, author (is it their first contribution?), the linked issue, and the full acceptance criteria from the issue.

### 2. Fetch + inspect diff

```bash
git fetch origin pull/<N>/head:pr-<N>
git diff --stat master..pr-<N>
git log --oneline master..pr-<N>
```

**Flag immediately** if the diff includes files unrelated to the stated purpose — this almost always means the PR was forked from old master and would revert intervening commits (see "Common: stale fork pattern" below).

### 3. Rebase test

```bash
git checkout -b pr-<N>-rebase pr-<N>
git rebase master
```

If the rebase succeeds cleanly, the resulting diff is what would actually land. If there are conflicts, resolve only the trivial ones (keep both sides of unrelated demo additions, etc.) and re-run the diff stat.

```bash
git diff --stat master..pr-<N>-rebase
```

The post-rebase diff is the **true scope** of the PR. Compare it to step 2 — large reductions in line count are normal when the branch was stale.

### 4. Pre-push checks (CLAUDE.md mandates all four)

```bash
npm run format:check
npm run lint
npm test
npm run build
```

Report each as ✅ / ❌ with specifics. **Format failures** can usually be fixed with `npm run format` (suggest this to the contributor). **Test counts**: baseline is 5761 (nape-js) + 71 (nape-pixi); anything below that is a regression. **Build failure** usually means a TypeScript error vitest skipped.

### 5. Manual review — what to look for

For **every PR**:

- **Scope match**: does the PR do what its title says, nothing more, nothing less? Engine-source changes hidden in a "tests" PR are a red flag.
- **Acceptance criteria coverage**: list every checklist item from the linked issue, mark each as ✅ / ❌ / ⚠️. Even if the PR scope is narrower than the issue, the user wants the full table to decide.
- **Security**: any `eval`, `innerHTML`, file-system access, network calls, dynamic imports? Demos in `docs/demos/` are fine to use HTML in `desc` strings (controlled environment), but flag anything that touches user input.
- **Code conventions**: does it follow existing demo / engine patterns? (Compare to neighbouring files in the same directory.)
- **CLAUDE.md "no premature abstractions" rule**: are new helpers / utilities actually used by ≥2 callers, or are they speculative?

For PRs that touch **`packages/nape-js/src/` (engine source)**:

- **Mid-step guards** (`immutable_midstep`, `bodies_modifiable`, `constraints_modifiable`, etc.) — these are not bugs, they're intentional invariants. ~30 sites across the engine. **Never approve a PR that removes one** without an issue-level design discussion first. See "Engine safety" below.
- **ZPP_ class changes**: the `packages/nape-js/src/native/` tree is the modernized Haxe engine. Changes here need extra scrutiny because behaviour is encoded across many cross-referencing classes.
- **Public API changes**: any setter/getter on `Body`, `Shape`, `Space`, `Constraint`, etc. — does the change preserve existing semantics? Are there docs (TSDoc) to update?
- **Memory check**: search the user's auto-memory for relevant feedback / project entries before approving (e.g. `feedback_camera_step_lockstep.md`, `feedback_examples_first_play_preview_step.md`).

### 6. Runtime smoke test (optional but recommended)

For **demo PRs**: start `npm run serve:docs` and verify the demo renders in all relevant adapters (canvas2d / pixijs / threejs if it uses `render3dOverlay`). Test reset, click handlers, and the renderer toggle.

For **engine PRs**: write a small `/tmp/<name>-smoke.mjs` script that exercises the changed API directly against `dist/index.js`. If the PR modifies a guard or invariant, write the *adversarial* test that the contributor's tests don't cover — exactly the case the guard was protecting against. Compare behaviour PR-branch vs master.

### 7. Verdict + draft message

End with:

1. **Verdict**: ✅ ready to merge / ⚠️ needs changes / ❌ do not merge in current form
2. **Draft message for the contributor** in github-flavoured markdown, ready to paste. Structure:
   - Thank them.
   - **Blockers first** (engine-safety, security, scope mismatches).
   - **Acceptance criteria table** when relevant (issue-listed items vs PR coverage). Quote `Closes #N` if missing.
   - **Housekeeping** last (rebase, format, prettier).
   - Brief positive close — what looks good.

If the user types something like "make it gentler" or "remove X", adapt the draft. Don't push back on tone calls.

## Common: stale fork pattern

A PR diff that includes file deletions / reverts of code the user merged recently almost always means:

- The contributor forked master ~N commits ago
- Their branch doesn't include those N commits
- A vanilla GitHub merge would *revert* them

**Verify** with `git merge-base master pr-<N>` — if the base is not the current `master` HEAD or close to it, recommend `Rebase onto current master` and resolve the conflicts (typically trivial — keep both sides).

The user has seen this twice already (PR #156, PR #172). If a contributor's first response to "rebase" is confusion, give a one-liner: `git fetch upstream && git rebase upstream/master`, plus resolve any conflict by keeping both sides where the changes are additive.

## Engine safety: mid-step guards

The engine has ~30 `immutable_midstep` and `*_modifiable` guards that throw when state is mutated during `space.step()`. List them with:

```bash
grep -rn "immutable_midstep\|midstep" packages/nape-js/src/ | head -40
```

These guards exist because:
- **Arbiter classification** runs once per step. Mid-step toggle of `sensorEnabled` / `fluidEnabled` / `filter` / `material` leaves arbiters in the wrong category until the next step → silent inconsistency, not a crash.
- **Body / constraint / compound add/remove** during step would break iteration and cached island structures.
- **Geometry mutation** (translate, scale, rotate, vertex edit, radius) invalidates AABBs that the broadphase is mid-traversal of.

**If a PR removes or weakens any of these guards**: that's a behaviour change, not a test fix. The correct test for "user toggles X mid-step" is `expect(() => …).toThrow(/cannot be set during a space step/)`, not `expect(events).toContain(…)`.

The full list of guarded operations is in `packages/nape-js/src/shape/*.ts`, `packages/nape-js/src/native/space/ZPP_Space.ts`, and `packages/nape-js/src/native/phys/ZPP_Compound.ts`.

## Cleanup after review

When done, ask the user before:

- Deleting the `pr-<N>` / `pr-<N>-rebase` branches
- Stopping any background dev server (`npm run serve:docs`)
- Switching branches back to where the user started

If the user requested cleanup, do them in one go. Don't leave the working tree on the PR branch unless they ask you to.

## Output format

Lead with a one-paragraph TL;DR (verdict + key reason) before any detail. Use tables for acceptance-criteria coverage. Quote file paths as `[path](path)` markdown links (per the VSCode extension context). Keep the contributor draft message in a fenced ` ```markdown ` block so it can be copied verbatim.
