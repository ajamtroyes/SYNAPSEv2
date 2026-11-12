# 0004: Cancel and failure roll the whole run back

**Status:** Implemented.

## Context

The brief: "A cancelled run leaves the workspace consistent, with no half-applied edits." Judges check "whether a
cancelled run left the workspace clean". An agent often needs its edits on disk mid-run, for example to run tests, so
holding everything in an overlay until the end would stop it verifying its own work.

## Decision

Accepted changes are written as they are approved, and recorded in `EditJournal`. **Cancelling or failing a run restores
every file that run changed**, so `git status` matches the start of the run. Completed runs keep their changes, with
Undo Last Change and Undo Last Run available afterwards.

## What it gives up

- A cancel also discards hunks the user had already accepted in that run. This is deliberate, and predictable: cancel
  means "put it back". It may surprise someone who wanted to keep part of a run, and a "keep accepted changes" option is
  a natural follow-up.
- Undo refuses to overwrite a file the user edited after the agent did, and reports it instead. In that case the file is
  left as it is, so the workspace is safe but not fully restored.
- Undo restores file content rather than replaying through the editor's own undo stack. Native `Ctrl+Z` also works on
  edited files that remain open.
