#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const EMAIL_DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function loadEnvFile(file) {
  if (typeof process.loadEnvFile === "function") {
    process.loadEnvFile(file);
    return;
  }

  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;

    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[match[1]] = value;
  }
}

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) {
    loadEnvFile(file);
    break;
  }
}

function usage() {
  console.log(`Usage: node scripts/link-pos-users.mjs [options]

Creates a Supabase Auth user for each active, unlinked pos_users row and stores
its id in auth_user_id. Safe to re-run: already linked rows are skipped.

Options:
  --dry-run          Print actions without writing to Auth or Postgres.
  --only <id|name>   Limit to one staff row.
  --domain <domain>  Email domain (default: pedigree.local).
  --yes              Allow a non-local Supabase URL. Required outside localhost.
  --help             Show this help.
`);
}

const options = {
  dryRun: false,
  only: null,
  domain: "pedigree.local",
  allowRemote: false,
};

const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index];

  if (arg === "--dry-run") {
    options.dryRun = true;
  } else if (arg === "--yes") {
    options.allowRemote = true;
  } else if (arg === "--help" || arg === "-h") {
    usage();
    process.exit(0);
  } else if (arg === "--only") {
    index += 1;
    options.only = argv[index] ?? null;
    if (!options.only) {
      console.error("--only requires a staff id or name.");
      process.exit(1);
    }
  } else if (arg === "--domain") {
    index += 1;
    options.domain = (argv[index] ?? "").toLowerCase();
    if (!EMAIL_DOMAIN_PATTERN.test(options.domain)) {
      console.error("--domain must be a valid lower-case email domain.");
      process.exit(1);
    }
  } else {
    console.error(`Unknown argument: ${arg}`);
    usage();
    process.exit(1);
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Fill .env.local first.",
  );
  process.exit(1);
}

let parsedUrl;
try {
  parsedUrl = new URL(url);
} catch {
  console.error("NEXT_PUBLIC_SUPABASE_URL is not a valid URL.");
  process.exit(1);
}

if (!options.allowRemote && !LOCAL_HOSTS.has(parsedUrl.hostname)) {
  console.error(
    `Refusing to write to non-local project ${parsedUrl.hostname}. Re-run with --yes if this is intentional.`,
  );
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});

function slugifyName(name) {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");

  return slug || "staff";
}

async function listAuthUsers() {
  const users = [];

  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });

    if (error) throw new Error(`Could not list Auth users: ${error.message}`);

    users.push(...data.users);
    if (data.users.length < 1000) break;
  }

  return users;
}

function indexByEmail(users) {
  const byEmail = new Map();
  for (const user of users) {
    if (user.email) byEmail.set(user.email.toLowerCase(), user);
  }
  return byEmail;
}

async function findExistingByEmail(email, byEmail) {
  const cached = byEmail.get(email.toLowerCase());
  if (cached) return cached;

  const users = await listAuthUsers();
  for (const user of users) {
    if (user.email) byEmail.set(user.email.toLowerCase(), user);
  }

  return byEmail.get(email.toLowerCase()) ?? null;
}

async function linkStaff(staff, byEmail) {
  if (!staff.active) {
    console.log(`skip  ${staff.name}: inactive`);
    return { linked: false, error: null };
  }

  if (staff.auth_user_id) {
    console.log(`skip  ${staff.name}: already linked to ${staff.auth_user_id}`);
    return { linked: false, error: null };
  }

  const base = slugifyName(staff.name);
  let email = `${base}@${options.domain}`;
  let existing = await findExistingByEmail(email, byEmail);

  if (
    existing &&
    existing.user_metadata?.pos_staff_id !== staff.id
  ) {
    email = `${base}-${staff.id.slice(0, 8)}@${options.domain}`;
    existing = await findExistingByEmail(email, byEmail);

    if (
      existing &&
      existing.user_metadata?.pos_staff_id !== staff.id
    ) {
      return {
        linked: false,
        error: `Auth user ${email} exists but belongs to another account.`,
      };
    }
  }

  let authUserId = existing?.id ?? null;
  let created = false;

  if (!authUserId) {
    if (options.dryRun) {
      console.log(`would create ${email} and link ${staff.name}`);
      return { linked: false, error: null };
    }

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: randomBytes(32).toString("base64url"),
      email_confirm: true,
      user_metadata: {
        pos_staff_id: staff.id,
        name: staff.name,
      },
    });

    if (error || !data.user) {
      return {
        linked: false,
        error: `Could not create Auth user for ${staff.name}: ${
          error?.message ?? "unknown error"
        }`,
      };
    }

    authUserId = data.user.id;
    created = true;
    byEmail.set(email.toLowerCase(), data.user);
    console.log(`create ${email} for ${staff.name}`);
  }

  if (options.dryRun) {
    console.log(`would link ${staff.name} to ${authUserId}`);
    return { linked: false, error: null };
  }

  const { data: updated, error: updateError } = await admin
    .from("pos_users")
    .update({ auth_user_id: authUserId })
    .eq("id", staff.id)
    .is("auth_user_id", null)
    .select("id");

  if (updateError || !updated?.length) {
    if (created) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(authUserId);
      if (deleteError) {
        console.error(
          `rollback failed for ${email}: ${deleteError.message}`,
        );
      } else {
        byEmail.delete(email.toLowerCase());
      }
    }

    return {
      linked: false,
      error: `Could not link ${staff.name}: ${
        updateError?.message ?? "row was already linked"
      }`,
    };
  }

  console.log(`link  ${staff.name} -> ${authUserId}`);
  return { linked: true, error: null };
}

try {
  let query = admin
    .from("pos_users")
    .select("id, name, role, active, auth_user_id")
    .order("name")
    .order("id");

  if (options.only) {
    query = /^[0-9a-f-]{36}$/i.test(options.only)
      ? query.eq("id", options.only)
      : query.eq("name", options.only);
  }

  const { data: staff, error: staffError } = await query;

  if (staffError) {
    throw new Error(
      `Could not read pos_users: ${staffError.message}. Has the auth-link migration been applied?`,
    );
  }

  if (!staff.length) {
    console.log("No matching pos_users rows.");
    process.exit(0);
  }

  const byEmail = indexByEmail(await listAuthUsers());
  let linked = 0;
  let failed = 0;

  for (const row of staff) {
    const result = await linkStaff(row, byEmail);
    if (result.linked) linked += 1;
    if (result.error) {
      failed += 1;
      console.error(`error ${row.name}: ${result.error}`);
    }
  }

  console.log(
    `\n${options.dryRun ? "Dry run: " : ""}${linked} linked, ${failed} failed, ${staff.length} inspected.`,
  );

  if (failed > 0) process.exit(1);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Unknown error");
  process.exit(1);
}
