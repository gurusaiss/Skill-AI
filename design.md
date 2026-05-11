# Git Secret Exposure Fix - Bugfix Design

## Overview

This bugfix addresses GitHub's secret scanning violations that are blocking push operations. The issue stems from API keys (GEMINI_API_KEY and GROQ_API_KEY) that were committed to the repository before `.gitignore` rules were properly configured. While current commits correctly exclude `.env` files, the historical commits still contain exposed secrets, triggering GitHub's repository rule violations.

The fix strategy involves using Git history rewriting tools to remove the sensitive `.env` file from all historical commits, followed by rotating the exposed API keys to ensure security. This approach will clean the commit history while preserving all other repository content and maintaining the integrity of the codebase.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug - when attempting to push commits to a repository that contains exposed secrets in its Git history
- **Property (P)**: The desired behavior when pushing commits - GitHub should accept the push without secret scanning violations
- **Preservation**: Existing Git workflow, .gitignore behavior, and repository structure that must remain unchanged by the fix
- **git-filter-repo**: A tool for rewriting Git history to remove files from all commits
- **BFG Repo-Cleaner**: An alternative tool for removing sensitive data from Git history
- **Secret Scanning**: GitHub's automated detection system that identifies exposed API keys, tokens, and other credentials in repository history
- **Force Push**: A Git operation that overwrites remote history with local history (required after history rewriting)

## Bug Details

### Bug Condition

The bug manifests when attempting to push commits to GitHub after the repository's commit history contains exposed API keys. GitHub's secret scanning system detects the GEMINI_API_KEY and GROQ_API_KEY values in historical commits of the `.env` file, even though current `.gitignore` rules properly exclude `.env` files from tracking.

**Formal Specification:**

```
FUNCTION isBugCondition(input)
  INPUT: input of type GitPushOperation
  OUTPUT: boolean

  RETURN input.operation == "git push"
         AND repositoryHistoryContains(".env", ["GEMINI_API_KEY", "GROQ_API_KEY"])
         AND GitHubSecretScanningDetects(input.commits)
         AND pushRejectedWithMessage("push declined due to repository rule violations")
END FUNCTION
```

### Examples

- **Example 1**: Developer runs `git push origin main` → GitHub responds with "push declined due to repository rule violations" and references secret scanning detection
- **Example 2**: Developer runs `git push origin feature-branch` → GitHub blocks the push and displays "Secret scanning found exposed credentials in commit history"
- **Example 3**: Developer force pushes with `git push --force` → GitHub still blocks because the secret exists in the history being pushed
- **Edge Case**: Developer creates a new branch from a clean commit → Push still fails if that branch's history includes the commit with exposed secrets

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- `.gitignore` rules must continue to exclude `.env` files from future commits
- Developers must continue to be able to create local `.env` files from `.env.example`
- `.env.example` with placeholder values must remain committable and tracked
- All non-sensitive commit history (code changes, documentation, features) must remain intact
- Git workflow for normal development (commit, push, pull, branch, merge) must continue to work as before

**Scope:**
All Git operations that do NOT involve the historical `.env` file should be completely unaffected by this fix. This includes:

- Committing new changes to tracked files
- Creating and merging branches
- Pulling updates from remote
- Viewing commit history and diffs for non-sensitive files
- All existing .gitignore rules for other file types

## Hypothesized Root Cause

Based on the bug description and GitHub's error message, the root cause is:

1. **Historical Commit Contains Secrets**: At some point in the repository's history, a commit was made that included the `.env` file with real API key values (GEMINI_API_KEY and GROQ_API_KEY)

2. **Git History is Immutable by Default**: Even after adding `.env` to `.gitignore`, the historical commit still exists in the repository's object database and is included when pushing

3. **GitHub Secret Scanning Analyzes Full History**: GitHub's secret scanning doesn't just check the current state of files - it scans the entire commit history being pushed, detecting the exposed keys in past commits

4. **Repository Rules Block Push**: GitHub's repository protection rules are configured to block any push operation that would introduce (or has already introduced) exposed secrets, preventing the push from completing

## Correctness Properties

Property 1: Bug Condition - Git Push Succeeds Without Secret Violations

_For any_ Git push operation where the repository history has been cleaned of exposed secrets (isBugCondition returns false after fix), the push operation SHALL complete successfully without GitHub secret scanning violations, allowing commits to be pushed to the remote repository.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - Git Workflow and Ignore Rules Unchanged

_For any_ Git operation that does NOT involve the historical `.env` file (isBugCondition returns false for non-push operations), the fixed repository SHALL behave exactly the same as before the fix, preserving all existing Git workflow functionality, .gitignore rules, commit history for non-sensitive files, and developer workflows.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct (exposed secrets in Git history):

**Primary Tool**: `git-filter-repo` (recommended) or `BFG Repo-Cleaner` (alternative)

**Specific Changes**:

1. **Install Git History Rewriting Tool**:
   - Install `git-filter-repo` via pip: `pip install git-filter-repo`
   - Alternative: Download BFG Repo-Cleaner JAR file
   - Verify installation with `git filter-repo --version`

2. **Backup Current Repository**:
   - Create a complete backup of the repository before history rewriting
   - Clone to a separate location: `git clone <repo-url> backup-repo`
   - This allows rollback if something goes wrong

3. **Remove .env from All Historical Commits**:
   - Run: `git filter-repo --path .env --invert-paths --force`
   - This removes `.env` from every commit in the repository history
   - Alternative with BFG: `java -jar bfg.jar --delete-files .env`
   - Verify removal with: `git log --all --full-history -- .env` (should return empty)

4. **Verify .gitignore is Correct**:
   - Confirm `.env` is listed in `.gitignore`
   - Confirm `.env.example` is NOT in `.gitignore` (should remain tracked)
   - Test with: `git check-ignore -v .env` (should show it's ignored)

5. **Force Push to Remote**:
   - Update remote with cleaned history: `git push origin --force --all`
   - Push all branches: `git push origin --force --tags` (if tags exist)
   - Note: This requires force push permissions on the repository

6. **Rotate Exposed API Keys**:
   - Generate new GEMINI_API_KEY at https://aistudio.google.com/app/apikey
   - Generate new GROQ_API_KEY at https://console.groq.com
   - Update local `.env` file with new keys
   - Revoke old keys in respective API consoles to prevent unauthorized use

7. **Notify Collaborators**:
   - Inform all team members that history has been rewritten
   - Instruct them to re-clone the repository or reset their local copies
   - Command for existing clones: `git fetch origin && git reset --hard origin/main`

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, confirm the bug exists by attempting a push and observing the GitHub secret scanning violation, then verify the fix works correctly by cleaning history and successfully pushing without violations.

### Exploratory Bug Condition Checking

**Goal**: Confirm the bug exists BEFORE implementing the fix. Verify that GitHub is indeed blocking pushes due to secret scanning detection in commit history.

**Test Plan**: Attempt to push commits to GitHub and observe the error message. Search Git history for the exposed `.env` file to confirm it exists in historical commits.

**Test Cases**:

1. **Push Attempt Test**: Run `git push origin main` and observe "push declined due to repository rule violations" error (will fail on unfixed repo)
2. **History Search Test**: Run `git log --all --full-history -- .env` to list all commits containing `.env` (should show historical commits)
3. **Secret Detection Test**: Run `git show <commit-hash>:.env` on a historical commit to verify it contains real API keys (should display exposed keys)
4. **Current State Test**: Run `git status` to verify `.env` is currently ignored and not staged (should show it's ignored)

**Expected Counterexamples**:

- Push operations are rejected with secret scanning violations
- Git history contains commits with `.env` file including real API key values
- Possible causes: `.env` was committed before `.gitignore` was configured, secrets were not removed from history after adding ignore rules

### Fix Checking

**Goal**: Verify that after cleaning Git history, push operations succeed without secret scanning violations.

**Pseudocode:**

```
FOR ALL push_operation WHERE isBugCondition(push_operation) == FALSE (after fix) DO
  result := git_push(push_operation)
  ASSERT result.success == TRUE
  ASSERT result.error_message NOT CONTAINS "secret scanning"
  ASSERT result.error_message NOT CONTAINS "repository rule violations"
END FOR
```

### Preservation Checking

**Goal**: Verify that after cleaning Git history, all non-sensitive Git operations and workflows continue to work exactly as before.

**Pseudocode:**

```
FOR ALL git_operation WHERE NOT involves_historical_env_file(git_operation) DO
  ASSERT git_operation_after_fix(git_operation) == git_operation_before_fix(git_operation)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:

- It generates many test cases automatically across different Git operations
- It catches edge cases that manual testing might miss (branch operations, merge scenarios, etc.)
- It provides strong guarantees that normal Git workflow is unchanged for all non-sensitive operations

**Test Plan**: Document current Git behavior for various operations BEFORE the fix, then verify identical behavior AFTER the fix.

**Test Cases**:

1. **Gitignore Preservation**: Verify that creating a new `.env` file locally is still ignored by Git (should not appear in `git status`)
2. **Commit History Preservation**: Verify that all non-sensitive commits remain in history with same hashes (except for commits that touched `.env`)
3. **Branch Operations Preservation**: Verify that creating, switching, and merging branches works identically
4. **Example File Preservation**: Verify that `.env.example` remains tracked and committable

### Unit Tests

- Test that `.env` does not appear in `git log --all --full-history -- .env` after fix
- Test that `git push origin main` succeeds without errors after fix
- Test that `.env` is still listed in `.gitignore` after fix
- Test that creating a local `.env` file is ignored by Git after fix

### Property-Based Tests

- Generate random Git operations (commit, branch, merge) and verify they work identically before and after fix
- Generate random file modifications and verify `.gitignore` rules are preserved
- Test that push operations succeed across multiple branches after history cleaning

### Integration Tests

- Test full workflow: clean history → rotate keys → push to GitHub → verify success
- Test collaborator workflow: re-clone repository → create `.env` from example → verify it's ignored
- Test that GitHub secret scanning no longer detects violations after fix
