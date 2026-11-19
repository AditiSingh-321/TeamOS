import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { readFile, readdir } from "node:fs/promises";
export async function createDatabase({ beforeSarvam = false } = {}) {
  const db = await PGlite.create({ extensions: { vector } });
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; grant usage on schema auth to anon, authenticated, service_role;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as
    'select (nullif(current_setting(''request.jwt.claims'',true),'''')::jsonb ->> ''sub'')::uuid';
    create schema realtime;
    create table realtime.messages(id uuid default gen_random_uuid(),extension text,topic text);
    alter table realtime.messages enable row level security;
    create function realtime.topic() returns text language sql stable as
      'select current_setting(''realtime.topic'',true)';
    grant usage on schema realtime to authenticated;
    grant select,insert on realtime.messages to authenticated;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text,name text,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated,service_role;
    grant select,insert on storage.objects to authenticated;
    grant all on storage.objects,storage.buckets to service_role;
  `);
  for (const file of (await readdir("supabase/migrations")).filter((name) => name.endsWith(".sql")).sort()) {
    if (beforeSarvam && file >= "20261118050000") continue;
    try { await db.exec(await readFile("supabase/migrations/" + file, "utf8")); }
    catch (error) { await db.close(); throw new Error(`Migration ${file}: ${error.message}`); }
  }
  return db;
}
export async function asUser(db, id) {
  await db.exec("reset role;set role authenticated");
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, role: "authenticated" })]);
}
export async function asWorker(db) { await db.exec("reset role;set role service_role"); }
export async function rpc(db, name, args = []) {
  return (await db.query("select public." + name + "(" + args.map((_, i) => "$" + (i + 1)).join(",") + ") as result", args)).rows[0].result;
}
