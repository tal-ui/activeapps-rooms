-- ============================================================================
-- ActiveApps Rooms — Sprint 1: engagement templates (Foundation / 90-day / Retainer)
-- Blueprint shape: { "documents": [ { "kind", "title", "blocks": [ { "type", "content" } ] } ] }
-- ============================================================================

delete from public.room_templates where name in (
  'Foundation (EN)','90-Day Transformation (EN)','Retainer (EN)',
  'Foundation (HE)','90-Day Transformation (HE)','Retainer (HE)');

insert into public.room_templates (name, engagement_type, language, blueprint) values
('Foundation (EN)', 'foundation', 'en', $j$
{"documents":[{"kind":"sow","title":"Statement of Work — Foundation","blocks":[
 {"type":"heading","content":{"text":"Foundation Engagement","level":1}},
 {"type":"text","content":{"markdown":"This Statement of Work describes the Foundation engagement: a focused, fixed-scope build of your core go-to-market system with ActiveApps. Every deliverable below is a block you can comment on, question, and approve individually."}},
 {"type":"callout","content":{"tone":"info","markdown":"**How to use this room:** click any block to comment or ask a question. Approve blocks as you go — when everything is agreed, the *Approve the SOW* button becomes available."}},
 {"type":"heading","content":{"text":"Deliverables","level":2}},
 {"type":"deliverable","content":{"title":"Discovery & system map","description":"Interviews with stakeholders, audit of current tools and data, and a written map of the target system.","acceptance_criteria":["System map reviewed and approved in this room","Data inventory delivered as a shared sheet"],"phase":"Discovery","owner_side":"activeapps"}},
 {"type":"deliverable","content":{"title":"CRM foundation","description":"Objects, pipeline stages, required fields, and page layouts configured to the agreed map.","acceptance_criteria":["Pipeline reflects the agreed stages","Users can log in and create records","Import of existing accounts and contacts completed"],"phase":"Build","owner_side":"activeapps"}},
 {"type":"deliverable","content":{"title":"Core automations","description":"Lead routing, task creation, and Slack notifications for the key handoffs.","acceptance_criteria":["Each automation has a documented trigger and outcome","Tested end-to-end with your team"],"phase":"Build","owner_side":"activeapps"}},
 {"type":"deliverable","content":{"title":"Enablement","description":"Two working sessions with your team plus a written playbook.","acceptance_criteria":["Playbook shared in this room","Team can run the daily workflow unassisted"],"phase":"Launch","owner_side":"activeapps"}},
 {"type":"heading","content":{"text":"Assumptions","level":2}},
 {"type":"assumption","content":{"text":"A single decision-maker on your side is available for a 30-minute review twice a week.","impact_if_false":"Timeline extends by the number of missed review cycles."}},
 {"type":"assumption","content":{"text":"Existing data can be exported to CSV.","impact_if_false":"A separate migration effort is scoped as a change request."}},
 {"type":"heading","content":{"text":"Milestones","level":2}},
 {"type":"milestone","content":{"title":"Kickoff","target_date":null,"depends_on":[],"status":"planned"}},
 {"type":"milestone","content":{"title":"System map approved","target_date":null,"depends_on":[],"status":"planned"}},
 {"type":"milestone","content":{"title":"Go-live","target_date":null,"depends_on":[],"status":"planned"}},
 {"type":"heading","content":{"text":"Investment","level":2}},
 {"type":"pricing_option","content":{"name":"Foundation","description":"Everything listed above, delivered in 4–6 weeks.","price":0,"currency":"ILS","billing":"one_time","includes":["Discovery & system map","CRM foundation","Core automations","Enablement"],"recommended":true}},
 {"type":"divider","content":{}},
 {"type":"text","content":{"markdown":"Prices exclude VAT. Payment terms: 50% on approval, 50% on go-live."}}
]}]}
$j$::jsonb),

('90-Day Transformation (EN)', 'transformation_90d', 'en', $j$
{"documents":[{"kind":"sow","title":"Statement of Work — 90-Day Transformation","blocks":[
 {"type":"heading","content":{"text":"90-Day Transformation","level":1}},
 {"type":"text","content":{"markdown":"A three-phase program that rebuilds how your revenue team works: **Weeks 1–3 Diagnose**, **Weeks 4–9 Build**, **Weeks 10–13 Adopt**. Each phase ends with a milestone you approve in this room."}},
 {"type":"heading","content":{"text":"Phase 1 — Diagnose","level":2}},
 {"type":"deliverable","content":{"title":"Revenue process audit","description":"Funnel definitions, handoffs, data quality, and tooling gaps documented with owners.","acceptance_criteria":["Audit report published in this room","Top 5 gaps agreed"],"phase":"Diagnose","owner_side":"activeapps"}},
 {"type":"deliverable","content":{"title":"Target architecture","description":"System-of-record decisions, integration map, and AI touchpoints.","acceptance_criteria":["Architecture block approved"],"phase":"Diagnose","owner_side":"activeapps"}},
 {"type":"heading","content":{"text":"Phase 2 — Build","level":2}},
 {"type":"deliverable","content":{"title":"CRM & pipeline rebuild","description":"Objects, stages, scoring, and views aligned to the target architecture.","acceptance_criteria":["Pipeline live with your data","Reps trained on the new stages"],"phase":"Build","owner_side":"activeapps"}},
 {"type":"deliverable","content":{"title":"Integrations & automations","description":"Connect marketing, support, and finance tools; automate the handoffs.","acceptance_criteria":["Each integration verified with a real record","Automation log reviewed weekly"],"phase":"Build","owner_side":"activeapps"}},
 {"type":"deliverable","content":{"title":"AI assist","description":"One AI-powered workflow (e.g. call summaries into CRM, lead enrichment) in production.","acceptance_criteria":["Used by the team for two consecutive weeks"],"phase":"Build","owner_side":"activeapps"}},
 {"type":"heading","content":{"text":"Phase 3 — Adopt","level":2}},
 {"type":"deliverable","content":{"title":"Dashboards & rituals","description":"Weekly pipeline review dashboard and a documented operating cadence.","acceptance_criteria":["Dashboard used in two weekly reviews"],"phase":"Adopt","owner_side":"activeapps"}},
 {"type":"deliverable","content":{"title":"Handover","description":"Admin training, runbooks, and a 30-day support window.","acceptance_criteria":["Runbooks in this room","Admin can make a layout change unassisted"],"phase":"Adopt","owner_side":"activeapps"}},
 {"type":"heading","content":{"text":"Your commitments","level":2}},
 {"type":"deliverable","content":{"title":"Executive sponsor & weekly review","description":"A sponsor who attends a 45-minute weekly review and unblocks decisions within 2 business days.","acceptance_criteria":[],"phase":"All","owner_side":"client"}},
 {"type":"heading","content":{"text":"Assumptions","level":2}},
 {"type":"assumption","content":{"text":"Tool licenses are in place before Build starts.","impact_if_false":"Build starts when licenses are available; the 90-day clock pauses."}},
 {"type":"heading","content":{"text":"Milestones","level":2}},
 {"type":"milestone","content":{"title":"Kickoff","target_date":null,"depends_on":[],"status":"planned"}},
 {"type":"milestone","content":{"title":"Diagnose complete","target_date":null,"depends_on":[],"status":"planned"}},
 {"type":"milestone","content":{"title":"Build complete","target_date":null,"depends_on":[],"status":"planned"}},
 {"type":"milestone","content":{"title":"Adoption review","target_date":null,"depends_on":[],"status":"planned"}},
 {"type":"heading","content":{"text":"Investment","level":2}},
 {"type":"pricing_option","content":{"name":"Transformation","description":"Full program, 13 weeks.","price":0,"currency":"ILS","billing":"one_time","includes":["All three phases","One AI workflow","30-day support"],"recommended":true}},
 {"type":"pricing_option","content":{"name":"Transformation + Retainer","description":"Program plus a 6-month optimization retainer at a reduced rate.","price":0,"currency":"ILS","billing":"monthly","includes":["Everything in Transformation","Monthly optimization sprint","Priority support"],"recommended":false}}
]}]}
$j$::jsonb),

('Retainer (EN)', 'retainer', 'en', $j$
{"documents":[{"kind":"sow","title":"Retainer Agreement","blocks":[
 {"type":"heading","content":{"text":"Ongoing Retainer","level":1}},
 {"type":"text","content":{"markdown":"A monthly block of hours for optimization, new automations, and support. Hours roll over for one month. This room stays your single place for requests, status, and decisions."}},
 {"type":"heading","content":{"text":"What is included","level":2}},
 {"type":"deliverable","content":{"title":"Monthly optimization sprint","description":"A prioritized backlog reviewed at the start of each month; work delivered continuously.","acceptance_criteria":["Backlog reviewed in the monthly call","Delivered items listed in the room"],"phase":"Ongoing","owner_side":"activeapps"}},
 {"type":"deliverable","content":{"title":"Support","description":"Response within one business day on any question raised in this room.","acceptance_criteria":[],"phase":"Ongoing","owner_side":"activeapps"}},
 {"type":"heading","content":{"text":"Terms","level":2}},
 {"type":"assumption","content":{"text":"Requests are raised in this room (not via WhatsApp) so they are tracked.","impact_if_false":"Untracked requests are not counted toward the SLA."}},
 {"type":"pricing_option","content":{"name":"10 hours / month","description":"For steady-state teams.","price":0,"currency":"ILS","billing":"monthly","includes":["10 hours","Monthly review","1-business-day response"],"recommended":false}},
 {"type":"pricing_option","content":{"name":"20 hours / month","description":"For teams still evolving their process.","price":0,"currency":"ILS","billing":"monthly","includes":["20 hours","Bi-weekly review","Same-day response"],"recommended":true}},
 {"type":"text","content":{"markdown":"Billed monthly in advance. Either side may end the retainer with 30 days' notice."}}
]}]}
$j$::jsonb),

('Foundation (HE)', 'foundation', 'he', $j$
{"documents":[{"kind":"sow","title":"מסמך היקף עבודה — Foundation","blocks":[
 {"type":"heading","content":{"text":"פרויקט Foundation","level":1}},
 {"type":"text","content":{"markdown":"מסמך זה מתאר את פרויקט ה-Foundation: בנייה ממוקדת ובהיקף קבוע של מערכת ה-GTM המרכזית שלכם עם ActiveApps. כל תוצר הוא בלוק שאפשר להגיב עליו, לשאול לגביו ולאשר אותו בנפרד."}},
 {"type":"callout","content":{"tone":"info","markdown":"**איך משתמשים בחדר:** לחיצה על בלוק פותחת תגובות ושאלות. אשרו בלוקים תוך כדי קריאה — כשהכול מאושר, כפתור *אשר את ה-SOW* נפתח."}},
 {"type":"heading","content":{"text":"תוצרים","level":2}},
 {"type":"deliverable","content":{"title":"Discovery ומפת מערכת","description":"ראיונות עם בעלי עניין, סקירת הכלים והנתונים הקיימים, ומפה כתובה של המערכת המטרה.","acceptance_criteria":["מפת המערכת אושרה בחדר","מלאי הנתונים נמסר כגיליון משותף"],"phase":"Discovery","owner_side":"activeapps"}},
 {"type":"deliverable","content":{"title":"תשתית CRM","description":"אובייקטים, שלבי פייפליין, שדות חובה ופריסות עמודים לפי המפה המוסכמת.","acceptance_criteria":["הפייפליין משקף את השלבים המוסכמים","המשתמשים מתחברים ויוצרים רשומות","ייבוא חשבונות ואנשי קשר קיימים הושלם"],"phase":"Build","owner_side":"activeapps"}},
 {"type":"deliverable","content":{"title":"אוטומציות ליבה","description":"ניתוב לידים, יצירת משימות והתראות Slack במעברים המרכזיים.","acceptance_criteria":["לכל אוטומציה טריגר ותוצאה מתועדים","נבדק מקצה לקצה עם הצוות"],"phase":"Build","owner_side":"activeapps"}},
 {"type":"deliverable","content":{"title":"הטמעה","description":"שני מפגשי עבודה עם הצוות ופלייבוק כתוב.","acceptance_criteria":["הפלייבוק שותף בחדר","הצוות מריץ את תהליך העבודה היומי ללא ליווי"],"phase":"Launch","owner_side":"activeapps"}},
 {"type":"heading","content":{"text":"הנחות","level":2}},
 {"type":"assumption","content":{"text":"מקבל החלטות אחד מצדכם זמין לסקירה של 30 דקות פעמיים בשבוע.","impact_if_false":"לוח הזמנים מתארך במספר מחזורי הסקירה שהוחמצו."}},
 {"type":"heading","content":{"text":"אבני דרך","level":2}},
 {"type":"milestone","content":{"title":"Kickoff","target_date":null,"depends_on":[],"status":"planned"}},
 {"type":"milestone","content":{"title":"מפת מערכת מאושרת","target_date":null,"depends_on":[],"status":"planned"}},
 {"type":"milestone","content":{"title":"עלייה לאוויר","target_date":null,"depends_on":[],"status":"planned"}},
 {"type":"heading","content":{"text":"השקעה","level":2}},
 {"type":"pricing_option","content":{"name":"Foundation","description":"כל האמור לעיל, ב-4–6 שבועות.","price":0,"currency":"ILS","billing":"one_time","includes":["Discovery ומפת מערכת","תשתית CRM","אוטומציות ליבה","הטמעה"],"recommended":true}},
 {"type":"text","content":{"markdown":"המחירים אינם כוללים מע\"מ. תנאי תשלום: 50% באישור, 50% בעלייה לאוויר."}}
]}]}
$j$::jsonb),

('90-Day Transformation (HE)', 'transformation_90d', 'he', $j$
{"documents":[{"kind":"sow","title":"מסמך היקף עבודה — טרנספורמציה ב-90 יום","blocks":[
 {"type":"heading","content":{"text":"טרנספורמציה ב-90 יום","level":1}},
 {"type":"text","content":{"markdown":"תוכנית בשלושה שלבים: **שבועות 1–3 אבחון**, **שבועות 4–9 בנייה**, **שבועות 10–13 הטמעה**. כל שלב מסתיים באבן דרך שאתם מאשרים בחדר."}},
 {"type":"heading","content":{"text":"שלב 1 — אבחון","level":2}},
 {"type":"deliverable","content":{"title":"סקר תהליכי הכנסות","description":"הגדרות משפך, מעברים, איכות נתונים ופערי כלים — מתועדים עם בעלים.","acceptance_criteria":["דוח הסקר פורסם בחדר","5 הפערים המרכזיים סוכמו"],"phase":"אבחון","owner_side":"activeapps"}},
 {"type":"deliverable","content":{"title":"ארכיטקטורת יעד","description":"החלטות system-of-record, מפת אינטגרציות ונקודות מגע AI.","acceptance_criteria":["בלוק הארכיטקטורה אושר"],"phase":"אבחון","owner_side":"activeapps"}},
 {"type":"heading","content":{"text":"שלב 2 — בנייה","level":2}},
 {"type":"deliverable","content":{"title":"בנייה מחדש של CRM ופייפליין","description":"אובייקטים, שלבים, ניקוד ותצוגות לפי ארכיטקטורת היעד.","acceptance_criteria":["הפייפליין חי עם הנתונים שלכם","הנציגים הוכשרו לשלבים החדשים"],"phase":"בנייה","owner_side":"activeapps"}},
 {"type":"deliverable","content":{"title":"אינטגרציות ואוטומציות","description":"חיבור כלי שיווק, תמיכה וכספים; אוטומציה של המעברים.","acceptance_criteria":["כל אינטגרציה אומתה עם רשומה אמיתית"],"phase":"בנייה","owner_side":"activeapps"}},
 {"type":"deliverable","content":{"title":"AI assist","description":"תהליך אחד מבוסס AI (למשל סיכומי שיחות ל-CRM) בפרודקשן.","acceptance_criteria":["בשימוש הצוות שבועיים ברצף"],"phase":"בנייה","owner_side":"activeapps"}},
 {"type":"heading","content":{"text":"שלב 3 — הטמעה","level":2}},
 {"type":"deliverable","content":{"title":"דשבורדים ושגרות","description":"דשבורד סקירת פייפליין שבועי ושגרת עבודה מתועדת.","acceptance_criteria":["הדשבורד בשימוש בשתי סקירות שבועיות"],"phase":"הטמעה","owner_side":"activeapps"}},
 {"type":"deliverable","content":{"title":"מסירה","description":"הכשרת אדמין, runbooks וחלון תמיכה של 30 יום.","acceptance_criteria":["ה-runbooks בחדר"],"phase":"הטמעה","owner_side":"activeapps"}},
 {"type":"heading","content":{"text":"המחויבות שלכם","level":2}},
 {"type":"deliverable","content":{"title":"ספונסר וסקירה שבועית","description":"ספונסר שמשתתף בסקירה שבועית של 45 דקות ומסיר חסמים תוך יומיים.","acceptance_criteria":[],"phase":"כל השלבים","owner_side":"client"}},
 {"type":"heading","content":{"text":"אבני דרך","level":2}},
 {"type":"milestone","content":{"title":"Kickoff","target_date":null,"depends_on":[],"status":"planned"}},
 {"type":"milestone","content":{"title":"אבחון הושלם","target_date":null,"depends_on":[],"status":"planned"}},
 {"type":"milestone","content":{"title":"בנייה הושלמה","target_date":null,"depends_on":[],"status":"planned"}},
 {"type":"heading","content":{"text":"השקעה","level":2}},
 {"type":"pricing_option","content":{"name":"Transformation","description":"התוכנית המלאה, 13 שבועות.","price":0,"currency":"ILS","billing":"one_time","includes":["שלושת השלבים","תהליך AI אחד","תמיכה 30 יום"],"recommended":true}}
]}]}
$j$::jsonb),

('Retainer (HE)', 'retainer', 'he', $j$
{"documents":[{"kind":"sow","title":"הסכם Retainer","blocks":[
 {"type":"heading","content":{"text":"Retainer מתמשך","level":1}},
 {"type":"text","content":{"markdown":"בנק שעות חודשי לאופטימיזציה, אוטומציות חדשות ותמיכה. שעות נצברות לחודש אחד. החדר הזה נשאר המקום האחד לבקשות, סטטוס והחלטות."}},
 {"type":"deliverable","content":{"title":"ספרינט אופטימיזציה חודשי","description":"backlog מתועדף שנסקר בתחילת כל חודש; העבודה נמסרת ברציפות.","acceptance_criteria":["ה-backlog נסקר בשיחה החודשית"],"phase":"מתמשך","owner_side":"activeapps"}},
 {"type":"deliverable","content":{"title":"תמיכה","description":"מענה תוך יום עסקים לכל שאלה שנשאלת בחדר.","acceptance_criteria":[],"phase":"מתמשך","owner_side":"activeapps"}},
 {"type":"assumption","content":{"text":"בקשות מועלות בחדר (לא ב-WhatsApp) כדי שיהיו מתועדות.","impact_if_false":"בקשות לא מתועדות לא נספרות ל-SLA."}},
 {"type":"pricing_option","content":{"name":"10 שעות / חודש","description":"לצוותים במצב יציב.","price":0,"currency":"ILS","billing":"monthly","includes":["10 שעות","סקירה חודשית"],"recommended":false}},
 {"type":"pricing_option","content":{"name":"20 שעות / חודש","description":"לצוותים שעדיין מפתחים את התהליך.","price":0,"currency":"ILS","billing":"monthly","includes":["20 שעות","סקירה דו-שבועית","מענה באותו יום"],"recommended":true}},
 {"type":"text","content":{"markdown":"חיוב חודשי מראש. כל צד רשאי לסיים בהודעה של 30 יום."}}
]}]}
$j$::jsonb);

-- ---------------------------------------------------------------------------
-- room_create_from_template — internal: creates engagement + SOW + blocks
-- ---------------------------------------------------------------------------
create or replace function public.room_create_engagement_from_template(
  p_room_id uuid, p_template_id uuid, p_name text default null, p_opportunity_id character varying default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tpl     public.room_templates%rowtype;
  v_eng_id  uuid;
  v_doc     jsonb;
  v_doc_id  uuid;
  v_blk     jsonb;
  v_i       integer;
  v_first_doc uuid;
begin
  if not public.is_internal() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_tpl from public.room_templates where id = p_template_id;
  if v_tpl.id is null then raise exception 'template not found' using errcode = 'P0002'; end if;

  insert into public.room_engagements (room_id, type, name, opportunity_id, sort_order)
  values (p_room_id, v_tpl.engagement_type, coalesce(p_name, v_tpl.name), p_opportunity_id,
          (select coalesce(max(sort_order), 0) + 1 from public.room_engagements where room_id = p_room_id))
  returning id into v_eng_id;

  for v_doc in select * from jsonb_array_elements(coalesce(v_tpl.blueprint->'documents', '[]'::jsonb)) loop
    insert into public.room_documents (room_id, engagement_id, kind, title, created_by)
    values (p_room_id, v_eng_id, coalesce(v_doc->>'kind', 'sow'), coalesce(v_doc->>'title', 'Untitled'), public.current_member_id(p_room_id))
    returning id into v_doc_id;
    v_first_doc := coalesce(v_first_doc, v_doc_id);
    v_i := 0;
    for v_blk in select * from jsonb_array_elements(coalesce(v_doc->'blocks', '[]'::jsonb)) loop
      v_i := v_i + 10;
      insert into public.room_blocks (room_id, document_id, sort_order, type, content)
      values (p_room_id, v_doc_id, v_i, v_blk->>'type', coalesce(v_blk->'content', '{}'::jsonb));
    end loop;
  end loop;

  return jsonb_build_object('engagement_id', v_eng_id, 'document_id', v_first_doc);
end;
$$;
revoke execute on function public.room_create_engagement_from_template(uuid, uuid, text, character varying) from public, anon;
grant execute on function public.room_create_engagement_from_template(uuid, uuid, text, character varying) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- room_create — internal: create a room (optionally from a CRM account) and
-- add the creator as an activeapps admin member.
-- ---------------------------------------------------------------------------
create or replace function public.room_create(
  p_name text, p_client_name text, p_slug text, p_language text default 'he',
  p_account_id character varying default null, p_welcome_message text default null)
returns public.rooms
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles%rowtype;
  v_room    public.rooms%rowtype;
begin
  if not public.is_internal() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_profile from public.profiles where auth_user_id = auth.uid() limit 1;
  if p_slug !~ '^[a-z0-9][a-z0-9-]{1,62}$' then
    raise exception 'slug must be lowercase letters, digits and dashes' using errcode = '22023';
  end if;

  insert into public.rooms (name, client_name, slug, language, account_id, welcome_message, created_by)
  values (p_name, p_client_name, p_slug, p_language, p_account_id, p_welcome_message, v_profile.id)
  returning * into v_room;

  insert into public.room_members (room_id, user_id, email, full_name, title, side, role, status, joined_at)
  values (v_room.id, auth.uid(), v_profile.email, coalesce(nullif(v_profile.full_name, ''), v_profile.email), v_profile.title, 'activeapps', 'admin', 'active', now());

  perform public.room_emit_event(v_room.id, 'room_created', 'room', v_room.id, jsonb_build_object('name', v_room.name), false);
  return v_room;
end;
$$;
revoke execute on function public.room_create(text, text, text, text, character varying, text) from public, anon;
grant execute on function public.room_create(text, text, text, text, character varying, text) to authenticated, service_role;
