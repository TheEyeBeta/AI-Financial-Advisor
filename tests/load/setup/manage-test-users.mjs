#!/usr/bin/env node
// Deterministic setup/cleanup for load-test users. Run directly with node —
// this is NOT a k6 script and NEVER runs inside a k6 VU. The service-role
// key is used here, in a single privileged process the operator controls
// directly, and is never passed into k6 (k6 scripts only ever receive
// short-lived user JWTs via K6_AUTH_TOKEN(S)).
//
// WARNING: this script requires SUPABASE_SERVICE_ROLE_KEY and performs
// privileged, server-side-only operations (creating/deleting auth users).
// Never run it from a browser context, never log the service-role key, and
// never commit a .env file containing it.
//
// Usage:
//   node tests/load/setup/manage-test-users.mjs setup   --run-id <id> --count 150
//   node tests/load/setup/manage-test-users.mjs cleanup --run-id <id>
//   node tests/load/setup/manage-test-users.mjs cleanup --run-id <id> --dry-run
//
// Naming: every user created is tagged <prefix>-<runId>-<index>@<domain>,
// e.g. loadtest-20260716T120000Z-42@k6.invalid — this run-scoped naming is
// what makes cleanup safe: cleanup only ever targets rows whose email
// matches this run's exact prefix, never a broad "delete all test users"
// sweep, and never touches a row that doesn't match.

import { createClient } from "@supabase/supabase-js";

const USAGE = `
Usage:
  node manage-test-users.mjs setup   --run-id <id> --count <n> [--password <pw>]
  node manage-test-users.mjs cleanup --run-id <id> [--dry-run]

Required env:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  LOAD_TEST_USER_EMAIL_DOMAIN   (must NOT resolve to a real mailbox domain; default: k6.invalid)
`;

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command };
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const value = rest[i + 1];
      args[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
      i += 1;
    }
  }
  return args;
}

function requireEnv(name) {
  const value = (process.env[name] || "").trim();
  if (!value) {
    console.error(`Missing required env var: ${name}\n${USAGE}`);
    process.exit(1);
  }
  return value;
}

function testUserEmail(domain, runId, index) {
  return `loadtest-${runId}-${index}@${domain}`;
}

async function setupUsers({ runId, count, password, client, domain }) {
  if (!runId) {
    console.error("setup requires --run-id");
    process.exit(1);
  }
  const n = Number(count || 10);
  console.log(`Provisioning ${n} test users for run ${runId} (idempotent — safe to re-run).`);

  const created = [];
  const tokens = [];

  for (let i = 1; i <= n; i += 1) {
    const email = testUserEmail(domain, runId, i);

    // Idempotent by construction: creation is attempted directly, and
    // "already registered" (handled below) is treated as success rather
    // than an error — safe to re-run this command for the same run ID.
    const { data, error } = await client.auth.admin.createUser({
      email,
      password: password || `LoadTest-${runId}-${i}!`,
      email_confirm: true,
      user_metadata: { load_test_run_id: runId, load_test: true },
    });

    if (error) {
      if (/already registered|already exists/i.test(error.message || "")) {
        console.log(`  [skip] ${email} already exists`);
        continue;
      }
      console.error(`  [error] ${email}: ${error.message}`);
      continue;
    }

    created.push({ email, id: data.user.id });

    const { data: session, error: sessionError } = await client.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (sessionError) {
      console.warn(`  [warn] could not generate a session link for ${email}: ${sessionError.message}`);
    } else {
      tokens.push(session);
    }

    console.log(`  [ok] ${email}`);
  }

  console.log(`\nCreated/confirmed ${created.length} users for run ${runId}.`);
  console.log(
    "\nNOTE: this script provisions accounts but does NOT print bearer JWTs — generating a " +
      "usable session token per user requires either a real sign-in flow or a service-role-privileged " +
      "admin API call whose output must stay out of k6's logs. Populate K6_AUTH_TOKENS_JSON by signing " +
      "each test account in via the normal password-grant flow from a trusted, non-k6 process, then pass " +
      "the resulting short-lived JWTs to k6 — never the service-role key itself.",
  );
}

async function cleanupUsers({ runId, dryRun, client, domain }) {
  if (!runId) {
    console.error("cleanup requires --run-id");
    process.exit(1);
  }

  console.log(`Cleaning up test users for run ${runId}${dryRun ? " (dry run — no changes made)" : ""}.`);

  // Cleanup is scoped by run ID via the email prefix — never a broad
  // "delete all load-test users" or "delete all users" sweep, and it never
  // touches a row whose email doesn't match this exact run's prefix.
  const prefix = `loadtest-${runId}-`;
  const suffix = `@${domain}`;

  let page = 1;
  let matched = 0;
  let deleted = 0;

  // Supabase's admin listUsers is paginated; walk pages looking for exact
  // prefix+suffix matches only.
  while (true) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      console.error(`listUsers failed: ${error.message}`);
      process.exit(1);
    }
    if (!data || data.users.length === 0) break;

    for (const user of data.users) {
      const email = (user.email || "").toLowerCase();
      if (!email.startsWith(prefix) || !email.endsWith(suffix)) continue;
      if (user.user_metadata?.load_test_run_id !== runId) continue; // belt-and-braces double match

      matched += 1;
      if (dryRun) {
        console.log(`  [would delete] ${email} (${user.id})`);
        continue;
      }
      const { error: deleteError } = await client.auth.admin.deleteUser(user.id);
      if (deleteError) {
        console.error(`  [error] failed to delete ${email}: ${deleteError.message}`);
        continue;
      }
      deleted += 1;
      console.log(`  [deleted] ${email}`);
    }

    if (data.users.length < 200) break;
    page += 1;
  }

  console.log(
    `\nMatched ${matched} users for run ${runId}${dryRun ? "" : `, deleted ${deleted}`}.`,
  );
  if (matched === 0) {
    console.log("Nothing matched this run ID — either already cleaned up, or setup never ran with it.");
  }
  console.log(
    "\nThis only removes auth.users rows for this run ID (cascading to core.users and dependent " +
      "rows via existing FK ON DELETE CASCADE per the schema). It never issues a broad DELETE against " +
      "any application table, and it never touches a user whose email doesn't match this run's prefix.",
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.command || !["setup", "cleanup"].includes(args.command)) {
    console.error(USAGE);
    process.exit(1);
  }

  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const domain = (process.env.LOAD_TEST_USER_EMAIL_DOMAIN || "k6.invalid").trim();

  if (!domain.endsWith(".invalid") && !domain.endsWith(".test")) {
    console.error(
      `LOAD_TEST_USER_EMAIL_DOMAIN="${domain}" does not end in .invalid or .test — refusing to run. ` +
        "Load-test users must use a domain that cannot deliver real mail, so a misconfigured cleanup " +
        "can never be mistaken for touching a real account (RFC 2606 reserves .invalid/.test for exactly this).",
    );
    process.exit(1);
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (args.command === "setup") {
    await setupUsers({ runId: args.runId, count: args.count, password: args.password, client, domain });
  } else {
    await cleanupUsers({ runId: args.runId, dryRun: Boolean(args.dryRun), client, domain });
  }
}

main().catch((error) => {
  console.error("Fatal error:", error.message || error);
  process.exit(1);
});
