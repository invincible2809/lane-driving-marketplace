export async function runReminders(db,env={},now=new Date()) {
 const start=now.toISOString(),until=new Date(+now+86400000).toISOString();
 const before=await db.prepare("SELECT count(*) n FROM notifications WHERE event_key LIKE 'reminder:%'").first();
 await db.prepare(`INSERT OR IGNORE INTO notifications (id,user_id,event_key,booking_id,title,message,created)
 SELECT lower(hex(randomblob(16))),b.learner_id,'reminder:'||b.id||':'||b.revision||':'||b.learner_id,b.id,'Your lesson is coming up','Preview lesson with '||i.name||' starts at '||COALESCE(b.starts_at,s.start)||' (UTC). Open My lessons for details.',?
 FROM bookings b JOIN slots s ON s.id=b.slot_id JOIN instructors i ON i.id=s.instructor_id WHERE b.status='confirmed' AND COALESCE(b.starts_at,s.start)>? AND COALESCE(b.starts_at,s.start)<=?`).bind(start,start,until).run();
 await db.prepare(`INSERT OR IGNORE INTO notifications (id,user_id,event_key,booking_id,title,message,created)
 SELECT lower(hex(randomblob(16))),i.owner_id,'reminder:'||b.id||':'||b.revision||':'||i.owner_id,b.id,'A lesson is coming up','Your preview lesson starts at '||COALESCE(b.starts_at,s.start)||' (UTC). Open your instructor workspace for details.',?
 FROM bookings b JOIN slots s ON s.id=b.slot_id JOIN instructors i ON i.id=s.instructor_id WHERE b.status='confirmed' AND i.owner_id IS NOT NULL AND i.owner_id<>b.learner_id AND COALESCE(b.starts_at,s.start)>? AND COALESCE(b.starts_at,s.start)<=?`).bind(start,start,until).run();
 const after=await db.prepare("SELECT count(*) n FROM notifications WHERE event_key LIKE 'reminder:%'").first();
 const delivered=await deliverEmails(db,env,now);
 const result={reminders:after.n-before.n,delivered,emailConfigured:!!(env.RESEND_API_KEY&&env.EMAIL_FROM)};
 await db.prepare('INSERT INTO job_runs (id,kind,completed,reminders,delivered) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),'reminders',start,result.reminders,delivered).run();return result;
}
export async function deliverEmails(db,env={},now=new Date()) {
 if(!env.RESEND_API_KEY||!env.EMAIL_FROM)return 0;
 const stamp=now.toISOString();let delivered=0;
 // Superseded reminders and events should not deliver stale booking details.
 await db.prepare("UPDATE email_outbox SET status='superseded' WHERE status IN ('queued','retry') AND EXISTS (SELECT 1 FROM bookings b WHERE b.id=email_outbox.booking_id AND b.revision<>email_outbox.booking_revision)").run();
 const rows=(await db.prepare("SELECT * FROM email_outbox WHERE attempts<5 AND next_attempt<=? AND (status IN ('queued','retry') OR (status='sending' AND lease_until<?)) ORDER BY next_attempt LIMIT 10").bind(stamp,stamp).all()).results;
 for(const row of rows){
 const claim=await db.prepare("UPDATE email_outbox SET status='sending',lease_until=?,attempts=attempts+1 WHERE id=? AND (status IN ('queued','retry') OR (status='sending' AND lease_until<?))").bind(new Date(+now+300000).toISOString(),row.id,stamp).run();
 if(!claim.meta?.changes)continue;
 try{const response=await (env.MAIL_FETCH||fetch)('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':row.id},body:JSON.stringify({from:env.EMAIL_FROM,to:[row.recipient],subject:row.subject,text:row.message+'\n\nThis is a private product preview. No real lesson or payment is arranged.'})});if(!response.ok)throw new Error('delivery_failed');const result=await response.json();if(!result.id)throw new Error('delivery_failed');await db.prepare("UPDATE email_outbox SET status='sent',sent_at=?,provider_id=?,lease_until=NULL WHERE id=?").bind(new Date().toISOString(),result.id,row.id).run();delivered++;}
 catch{await db.prepare("UPDATE email_outbox SET status=?,next_attempt=?,lease_until=NULL WHERE id=?").bind(row.attempts+1>=5?'failed':'retry',new Date(+now+Math.min(3600000,60000*2**row.attempts)).toISOString(),row.id).run();}
 }
 return delivered;
}
