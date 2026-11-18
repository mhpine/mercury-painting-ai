-- Mercury Field Records, Preview phase 1: additive tables ONLY.
-- No DROP TABLE, no changes to existing photos/projects/walkthroughs/estimates.
-- Run in a SEPARATE TEST Supabase database if one exists. If Preview shares
-- Production Supabase, use a dedicated test project and review before running.

begin;

create table if not exists public.mercury_inspection_reports (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  photo_path text not null,
  surface_id text,
  surface_name text,
  analysis_text text not null,
  ai_findings jsonb not null default '{}'::jsonb,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint mercury_report_photo_in_project check (left(photo_path, length(project_id) + 1) = project_id || '/')
);

create index if not exists mercury_reports_project_date_idx
  on public.mercury_inspection_reports (project_id, created_at desc);

create table if not exists public.mercury_inspection_reviews (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.mercury_inspection_reports(id),
  status text not null check (status in ('pending', 'approved', 'needs_correction')),
  confirmed_texture text not null default 'Not assessed',
  notes text not null default '',
  reviewed_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists mercury_reviews_report_date_idx
  on public.mercury_inspection_reviews (report_id, created_at desc);

alter table public.mercury_inspection_reports enable row level security;
alter table public.mercury_inspection_reviews enable row level security;

-- Access matches Mercury's current Walkthrough model: the project owner,
-- or a user explicitly given edit access to the project.
-- Existing Supabase RLS on projects and shares is still respected.
drop policy if exists "mercury reports read authorized project" on public.mercury_inspection_reports;
create policy "mercury reports read authorized project"
  on public.mercury_inspection_reports for select to authenticated
  using (
    exists (
      select 1 from public.mercury_projects p
      where p.id::text = mercury_inspection_reports.project_id
      and (
        p.owner_id::text = auth.uid()::text
        or exists (
          select 1 from public.mercury_project_shares s
          where s.project_id::text = p.id::text
            and s.shared_with::text = auth.uid()::text
            and s.permission = 'edit'
        )
      )
    )
  );

drop policy if exists "mercury reports insert authorized project" on public.mercury_inspection_reports;
create policy "mercury reports insert authorized project"
  on public.mercury_inspection_reports for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.mercury_projects p
      where p.id::text = mercury_inspection_reports.project_id
      and (
        p.owner_id::text = auth.uid()::text
        or exists (
          select 1 from public.mercury_project_shares s
          where s.project_id::text = p.id::text
            and s.shared_with::text = auth.uid()::text
            and s.permission = 'edit'
        )
      )
    )
  );

drop policy if exists "mercury reviews read authorized report" on public.mercury_inspection_reviews;
create policy "mercury reviews read authorized report"
  on public.mercury_inspection_reviews for select to authenticated
  using (
    exists (
      select 1 from public.mercury_inspection_reports r
      where r.id = mercury_inspection_reviews.report_id
    )
  );

drop policy if exists "mercury reviews insert authorized report" on public.mercury_inspection_reviews;
create policy "mercury reviews insert authorized report"
  on public.mercury_inspection_reviews for insert to authenticated
  with check (
    reviewed_by = auth.uid()
    and exists (
      select 1 from public.mercury_inspection_reports r
      where r.id = mercury_inspection_reviews.report_id
    )
  );

revoke all on public.mercury_inspection_reports from anon;
revoke all on public.mercury_inspection_reviews from anon;
revoke update, delete on public.mercury_inspection_reports from authenticated;
revoke update, delete on public.mercury_inspection_reviews from authenticated;
grant select, insert on public.mercury_inspection_reports to authenticated;
grant select, insert on public.mercury_inspection_reviews to authenticated;

commit;
