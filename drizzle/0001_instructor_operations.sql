ALTER TABLE instructors ADD COLUMN email TEXT NOT NULL DEFAULT '';
ALTER TABLE instructors ADD COLUMN qualification TEXT NOT NULL DEFAULT 'ADI';
ALTER TABLE instructors ADD COLUMN registration_number TEXT NOT NULL DEFAULT '';
ALTER TABLE instructors ADD COLUMN registration_expiry TEXT NOT NULL DEFAULT '';
ALTER TABLE instructors ADD COLUMN booking_mode TEXT NOT NULL DEFAULT 'instant';
ALTER TABLE instructors ADD COLUMN travel_buffer INTEGER NOT NULL DEFAULT 0;
ALTER TABLE instructors ADD COLUMN review_note TEXT NOT NULL DEFAULT '';
ALTER TABLE instructors ADD COLUMN verified_at TEXT;
ALTER TABLE slots ADD COLUMN recurring_id TEXT;
ALTER TABLE bookings ADD COLUMN starts_at TEXT;
ALTER TABLE bookings ADD COLUMN ends_at TEXT;
ALTER TABLE bookings ADD COLUMN proposed_slot_id TEXT REFERENCES slots(id);
ALTER TABLE bookings ADD COLUMN proposed_start TEXT;
ALTER TABLE bookings ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX instructor_owner_unique ON instructors(owner_id) WHERE owner_id IS NOT NULL;
CREATE TABLE verification_documents (id TEXT PRIMARY KEY, instructor_id TEXT NOT NULL REFERENCES instructors(id), object_key TEXT NOT NULL UNIQUE, filename TEXT NOT NULL, content_type TEXT NOT NULL, bytes INTEGER NOT NULL, created TEXT NOT NULL);
CREATE TABLE verification_reviews (id TEXT PRIMARY KEY, instructor_id TEXT NOT NULL REFERENCES instructors(id), reviewer_id TEXT NOT NULL, decision TEXT NOT NULL, note TEXT NOT NULL, created TEXT NOT NULL);
CREATE TABLE recurring_rules (id TEXT PRIMARY KEY, instructor_id TEXT NOT NULL REFERENCES instructors(id), weekday INTEGER NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, from_day TEXT NOT NULL, until_day TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE blackouts (id TEXT PRIMARY KEY, instructor_id TEXT NOT NULL REFERENCES instructors(id), start TEXT NOT NULL, end TEXT NOT NULL, reason TEXT NOT NULL DEFAULT 'Unavailable');
CREATE TABLE notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, event_key TEXT NOT NULL UNIQUE, booking_id TEXT REFERENCES bookings(id), title TEXT NOT NULL, message TEXT NOT NULL, created TEXT NOT NULL, read_at TEXT);
CREATE INDEX notification_user ON notifications(user_id,created);
CREATE TABLE email_outbox (id TEXT PRIMARY KEY, booking_id TEXT REFERENCES bookings(id), booking_revision INTEGER NOT NULL DEFAULT 0, event_key TEXT NOT NULL UNIQUE, recipient TEXT NOT NULL, subject TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, next_attempt TEXT NOT NULL, lease_until TEXT, sent_at TEXT, provider_id TEXT);
CREATE TABLE job_runs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, completed TEXT NOT NULL, reminders INTEGER NOT NULL, delivered INTEGER NOT NULL);
DROP INDEX one_active_booking_per_slot;
CREATE INDEX active_bookings ON bookings(slot_id,status);
CREATE TRIGGER booking_insert_guard BEFORE INSERT ON bookings WHEN NEW.status IN ('confirmed','pending') BEGIN
 SELECT RAISE(ABORT,'booking_unavailable') WHERE NOT EXISTS (SELECT 1 FROM slots s JOIN instructors i ON i.id=s.instructor_id WHERE s.id=NEW.slot_id AND s.blocked=0 AND COALESCE(NEW.starts_at,s.start)>=s.start AND COALESCE(NEW.ends_at,s.end)<=s.end AND COALESCE(NEW.starts_at,s.start)<COALESCE(NEW.ends_at,s.end) AND (i.demo=1 OR (i.status='verified' AND i.registration_expiry>=substr(COALESCE(NEW.ends_at,s.end),1,10))));
 SELECT RAISE(ABORT,'booking_unavailable') WHERE EXISTS (SELECT 1 FROM blackouts x JOIN slots s ON s.instructor_id=x.instructor_id WHERE s.id=NEW.slot_id AND x.start<COALESCE(NEW.ends_at,s.end) AND x.end>COALESCE(NEW.starts_at,s.start));
 SELECT RAISE(ABORT,'booking_conflict') WHERE EXISTS (SELECT 1 FROM bookings b JOIN slots old ON old.id=b.slot_id JOIN slots s ON s.id=NEW.slot_id JOIN instructors i ON i.id=s.instructor_id WHERE b.status IN ('confirmed','pending') AND (old.instructor_id=s.instructor_id OR b.learner_id=NEW.learner_id) AND julianday(COALESCE(b.starts_at,old.start))<julianday(COALESCE(NEW.ends_at,s.end))+CASE WHEN old.instructor_id=s.instructor_id THEN i.travel_buffer/1440.0 ELSE 0 END AND julianday(COALESCE(b.ends_at,strftime('%Y-%m-%dT%H:%M:%fZ',old.start,'+'||b.duration||' hours')))>julianday(COALESCE(NEW.starts_at,s.start))-CASE WHEN old.instructor_id=s.instructor_id THEN i.travel_buffer/1440.0 ELSE 0 END);
END;
CREATE TRIGGER booking_update_guard BEFORE UPDATE OF status,slot_id,starts_at,ends_at ON bookings WHEN NEW.status IN ('confirmed','pending') BEGIN
 SELECT RAISE(ABORT,'booking_unavailable') WHERE NOT EXISTS (SELECT 1 FROM slots s JOIN instructors i ON i.id=s.instructor_id WHERE s.id=NEW.slot_id AND s.blocked=0 AND COALESCE(NEW.starts_at,s.start)>=s.start AND COALESCE(NEW.ends_at,s.end)<=s.end AND COALESCE(NEW.starts_at,s.start)<COALESCE(NEW.ends_at,s.end) AND (i.demo=1 OR (i.status='verified' AND i.registration_expiry>=substr(COALESCE(NEW.ends_at,s.end),1,10))));
 SELECT RAISE(ABORT,'booking_unavailable') WHERE EXISTS (SELECT 1 FROM blackouts x JOIN slots s ON s.instructor_id=x.instructor_id WHERE s.id=NEW.slot_id AND x.start<COALESCE(NEW.ends_at,s.end) AND x.end>COALESCE(NEW.starts_at,s.start));
 SELECT RAISE(ABORT,'booking_conflict') WHERE EXISTS (SELECT 1 FROM bookings b JOIN slots old ON old.id=b.slot_id JOIN slots s ON s.id=NEW.slot_id JOIN instructors i ON i.id=s.instructor_id WHERE b.id<>NEW.id AND b.status IN ('confirmed','pending') AND (old.instructor_id=s.instructor_id OR b.learner_id=NEW.learner_id) AND julianday(COALESCE(b.starts_at,old.start))<julianday(COALESCE(NEW.ends_at,s.end))+CASE WHEN old.instructor_id=s.instructor_id THEN i.travel_buffer/1440.0 ELSE 0 END AND julianday(COALESCE(b.ends_at,strftime('%Y-%m-%dT%H:%M:%fZ',old.start,'+'||b.duration||' hours')))>julianday(COALESCE(NEW.starts_at,s.start))-CASE WHEN old.instructor_id=s.instructor_id THEN i.travel_buffer/1440.0 ELSE 0 END);
END;
CREATE TRIGGER slots_no_overlap BEFORE INSERT ON slots BEGIN
 SELECT RAISE(ABORT,'slot_overlap') WHERE EXISTS (SELECT 1 FROM slots WHERE id<>NEW.id AND instructor_id=NEW.instructor_id AND start<NEW.end AND end>NEW.start);
END;
CREATE TRIGGER slots_block_guard BEFORE UPDATE OF blocked ON slots WHEN NEW.blocked=1 BEGIN
 SELECT RAISE(ABORT,'slot_has_booking') WHERE EXISTS (SELECT 1 FROM bookings WHERE slot_id=NEW.id AND status IN ('confirmed','pending'));
END;
CREATE TRIGGER blackout_guard BEFORE INSERT ON blackouts BEGIN
 SELECT RAISE(ABORT,'blackout_has_booking') WHERE EXISTS (SELECT 1 FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE s.instructor_id=NEW.instructor_id AND b.status IN ('confirmed','pending') AND COALESCE(b.starts_at,s.start)<NEW.end AND COALESCE(b.ends_at,strftime('%Y-%m-%dT%H:%M:%fZ',s.start,'+'||b.duration||' hours'))>NEW.start);
END;
CREATE TRIGGER booking_notice_insert AFTER INSERT ON bookings BEGIN
 INSERT INTO notifications (id,user_id,event_key,booking_id,title,message,created)
 SELECT lower(hex(randomblob(16))), NEW.learner_id, 'booking:'||NEW.id||':'||NEW.revision||':'||NEW.learner_id,NEW.id,CASE WHEN NEW.status='pending' THEN 'Lesson request received' ELSE 'Lesson confirmed' END,'Preview lesson with '||i.name||' · '||COALESCE(NEW.starts_at,s.start)||' (UTC). Duration: '||NEW.duration||' hours. No payment collected.',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM slots s JOIN instructors i ON i.id=s.instructor_id WHERE s.id=NEW.slot_id;
 INSERT INTO notifications (id,user_id,event_key,booking_id,title,message,created)
 SELECT lower(hex(randomblob(16))),i.owner_id,'booking:'||NEW.id||':'||NEW.revision||':'||i.owner_id,NEW.id,CASE WHEN NEW.status='pending' THEN 'New lesson request' ELSE 'New lesson booking' END,'A learner has booked '||COALESCE(NEW.starts_at,s.start)||' (UTC). Open your instructor workspace to view or respond.',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM slots s JOIN instructors i ON i.id=s.instructor_id WHERE s.id=NEW.slot_id AND i.owner_id IS NOT NULL AND i.owner_id<>NEW.learner_id;
END;
CREATE TRIGGER booking_notice_update AFTER UPDATE ON bookings WHEN NEW.revision<>OLD.revision BEGIN
 INSERT INTO notifications (id,user_id,event_key,booking_id,title,message,created)
 SELECT lower(hex(randomblob(16))),NEW.learner_id,'booking:'||NEW.id||':'||NEW.revision||':'||NEW.learner_id,NEW.id,CASE WHEN NEW.proposed_start IS NOT NULL THEN 'New lesson time proposed' WHEN NEW.status='cancelled' THEN 'Lesson cancelled' WHEN NEW.status='declined' THEN 'Lesson request declined' WHEN NEW.status='confirmed' AND OLD.status='pending' THEN 'Lesson request accepted' ELSE 'Lesson updated' END,'Preview lesson with '||i.name||' · '||COALESCE(NEW.starts_at,s.start)||' (UTC). Status: '||NEW.status||'. Open My lessons to review changes.',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM slots s JOIN instructors i ON i.id=s.instructor_id WHERE s.id=NEW.slot_id;
 INSERT INTO notifications (id,user_id,event_key,booking_id,title,message,created)
 SELECT lower(hex(randomblob(16))),i.owner_id,'booking:'||NEW.id||':'||NEW.revision||':'||i.owner_id,NEW.id,'Lesson updated','A preview booking has changed. Status: '||NEW.status||'. Open your instructor workspace for details.',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM slots s JOIN instructors i ON i.id=s.instructor_id WHERE s.id=NEW.slot_id AND i.owner_id IS NOT NULL AND i.owner_id<>NEW.learner_id;
END;
CREATE TRIGGER notification_email AFTER INSERT ON notifications WHEN NEW.booking_id IS NOT NULL BEGIN
 INSERT OR IGNORE INTO email_outbox (id,event_key,booking_id,booking_revision,recipient,subject,message,next_attempt)
 SELECT NEW.id,NEW.event_key,NEW.booking_id,b.revision,CASE WHEN NEW.user_id=b.learner_id THEN l.email ELSE i.email END,'Lane preview · '||NEW.title,NEW.message,NEW.created FROM bookings b JOIN learners l ON l.id=b.learner_id JOIN slots s ON s.id=b.slot_id JOIN instructors i ON i.id=s.instructor_id WHERE b.id=NEW.booking_id AND CASE WHEN NEW.user_id=b.learner_id THEN l.email ELSE i.email END<>'';
END;
