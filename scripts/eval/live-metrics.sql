-- =========================================================================
--  Objective 5: measurements that need real usage (run after the user study)
--  Paste into the Supabase SQL editor and run one block at a time.
--  Read-only: nothing here changes data.
--
--  Test and demo accounts are left out everywhere (emails ending in
--  @seed.campus or @demo.campus). Set the dates in the `params` CTE of each
--  block to the user-study window.
-- =========================================================================

-- ------------------------------------------------------------------------
-- 1. AI suggestions: how often a suggestion is booked, and which card
--    (app logs rec_shown when cards appear, rec_accepted with the 0-based rank)
-- ------------------------------------------------------------------------
with params as (select timestamptz '2026-11-01 00:00+08' as since, timestamptz '2026-12-31 23:59+08' as until),
ev as (
  select e.* from public.evaluation_events e
  join public.profiles p on p.id = e.user_id, params
  where e.at between params.since and params.until
    and p.email not like '%@seed.campus' and p.email not like '%@demo.campus'
)
select
  count(*) filter (where kind = 'rec_shown')                                   as times_suggestions_shown,
  count(*) filter (where kind = 'rec_accepted')                                as suggestions_booked,
  round(100.0 * count(*) filter (where kind = 'rec_accepted')
        / nullif(count(*) filter (where kind = 'rec_shown'), 0), 1)            as acceptance_rate_pct,
  round(avg(num_value + 1) filter (where kind = 'rec_accepted'), 2)            as mean_rank_of_booked_card,
  round(100.0 * count(*) filter (where kind = 'rec_accepted' and num_value = 0)
        / nullif(count(*) filter (where kind = 'rec_accepted'), 0), 1)         as top_card_share_pct
from ev;

-- rank distribution of booked suggestions
select num_value + 1 as card, count(*) as bookings
from public.evaluation_events e join public.profiles p on p.id = e.user_id
where e.kind = 'rec_accepted' and p.email not like '%@seed.campus' and p.email not like '%@demo.campus'
group by 1 order by 1;

-- ------------------------------------------------------------------------
-- 2. Chatbot: share of answers students marked helpful (thumbs up/down)
-- ------------------------------------------------------------------------
select count(*) as rated,
       count(*) filter (where bool_value) as helpful,
       round(100.0 * count(*) filter (where bool_value) / nullif(count(*), 0), 1) as helpful_pct
from public.evaluation_events e join public.profiles p on p.id = e.user_id
where e.kind = 'chat_feedback' and p.email not like '%@seed.campus' and p.email not like '%@demo.campus';

-- ------------------------------------------------------------------------
-- 3. No-shows before vs after check-in + auto-release
--    `switched_on` = the day check-in grace was turned on for these rooms.
--    A no-show is an approved past booking that nobody attended: marked
--    no_show by a manager, or released by the system (cancel_reason
--    'no_checkin'). Room-hours wasted = hours of those bookings.
-- ------------------------------------------------------------------------
with params as (select timestamptz '2026-11-01 00:00+08' as switched_on),
b as (
  select r.*, case when r.start_time < params.switched_on then 'before' else 'after' end as period
  from public.reservations r join public.profiles p on p.id = r.user_id, params
  where r.end_time < now()
    and (r.status = 'approved' or r.cancel_reason = 'no_checkin')
    and p.email not like '%@seed.campus' and p.email not like '%@demo.campus'
)
select period,
       count(*)                                                              as past_bookings,
       count(*) filter (where no_show or cancel_reason = 'no_checkin')       as no_shows,
       round(100.0 * count(*) filter (where no_show or cancel_reason = 'no_checkin') / nullif(count(*), 0), 1) as no_show_pct,
       round(sum(extract(epoch from (end_time - start_time)) / 3600)
             filter (where no_show) ::numeric, 1)                            as room_hours_held_but_unused,
       round(sum(extract(epoch from (end_time - start_time)) / 3600)
             filter (where cancel_reason = 'no_checkin') ::numeric, 1)       as room_hours_given_back_by_auto_release
from b group by period order by period desc;

-- ------------------------------------------------------------------------
-- 4. Remote control (MQTT): time from the button press to the device
--    confirming it did it, by delivery path (mqtt = pushed, http = picked up
--    by the 5 s status poll)
-- ------------------------------------------------------------------------
select via,
       count(*) as commands,
       round((percentile_cont(0.5)  within group (order by extract(epoch from (done_at - issued_at))))::numeric * 1000) as median_ms,
       round((percentile_cont(0.95) within group (order by extract(epoch from (done_at - issued_at))))::numeric * 1000) as p95_ms,
       round(max(extract(epoch from (done_at - issued_at)))::numeric * 1000) as max_ms
from public.room_commands
where status = 'done' and done_at is not null
group by via order by via;

-- commands that never completed
select status, count(*) from public.room_commands group by status order by status;

-- ------------------------------------------------------------------------
-- 5. Usage overview for the report (by facility type)
-- ------------------------------------------------------------------------
select c.venue, c.name as facility_type,
       count(r.*)                                                      as bookings,
       count(r.*) filter (where r.status = 'approved')                 as approved,
       count(r.*) filter (where r.status = 'cancelled')                as cancelled,
       round(avg(extract(epoch from (r.end_time - r.start_time)) / 60)) as avg_minutes,
       round(avg(r.participants), 1)                                    as avg_group
from public.facility_categories c
join public.facilities f on f.category_id = c.id
left join public.reservations r on r.facility_id = f.id
  and r.user_id not in (select id from public.profiles where email like '%@seed.campus' or email like '%@demo.campus')
group by c.venue, c.name order by bookings desc;

-- ------------------------------------------------------------------------
-- 6. Objective 2 on the live database: any overlapping active bookings ever?
--    (must return 0)
-- ------------------------------------------------------------------------
select count(*) as overlapping_pairs
from public.reservations a join public.reservations b
  on a.facility_id = b.facility_id and a.id < b.id
 and a.status in ('pending', 'approved') and b.status in ('pending', 'approved')
 and tstzrange(a.start_time, a.end_time) && tstzrange(b.start_time, b.end_time);
