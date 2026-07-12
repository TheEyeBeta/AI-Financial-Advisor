# Orphan auth-user purge recovery

If an orphan purge dry-run or execute step behaves unexpectedly:

1. **Stop further executes** — do not re-run `/execute` until you have a fresh dry-run snapshot.
2. **Inspect the dry-run response** — note `snapshot_id`, `candidate_count`, and each `auth_id` / email.
3. **Verify in Supabase**
   - `auth.users` — check whether the auth record still exists.
   - `core.users` — confirm whether `auth_id` is present (a matching row means the account is not an orphan).
4. **If a legitimate user was deleted**
   - Ask the user to sign up again with the same email, or restore `auth.users` from a Supabase backup if available.
   - `core.users` may be recreated by `handle_new_user` on next OAuth/email signup depending on provider metadata.
5. **Audit logs**
   - Application logs: search for `Orphan purge dry-run` / `Orphan purge execute`.
   - Database (after migration `0028`): `core.orphan_purge_audit` and `core.orphan_purge_snapshots`.

Prevention: always run **dry-run** first, review candidates, then **execute** with the returned `confirmation_token` within 15 minutes.
