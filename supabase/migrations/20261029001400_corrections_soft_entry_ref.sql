-- corrections.entry_id: a soft reference, like entry_events.entry_id (review finding J).
-- The FK was `on delete set null`, which UPDATEs the corrections row when its entry is deleted.
-- corrections is append-only (private.forbid_change), so undoing the capture of an entry that had
-- a correction (undo_event deletes the entry) failed with "corrections is append-only".
-- The correction keeps the id of the entry it was about; the entry may be gone.
do $$
declare c text;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any(con.conkey)
     where con.conrelid = 'public.corrections'::regclass
       and con.contype = 'f'
       and con.confrelid = 'public.entries'::regclass
       and att.attname = 'entry_id'
  loop
    execute format('alter table public.corrections drop constraint %I', c);
  end loop;
end $$;

create index if not exists corrections_entry_idx on public.corrections (entry_id);
