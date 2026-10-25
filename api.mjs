import {seed} from './data.mjs';
export const postcodeValid = s => /^(GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})$/i.test(s.trim());
export const normalise = s => s.trim().toUpperCase().replace(/\s/g,'').replace(/(.{3})$/,' $1');
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
export async function api(request,db,env={}) {
 try {
 const url=new URL(request.url), path=url.pathname;
 const uid=request.headers.get('oai-authenticated-user-id');
 const email=request.headers.get('oai-authenticated-user-email')||'';
 const user=uid ? {id:uid,email}:null;
 const requireUser=()=>{if(!user) fail('Please sign in to continue.',401);return user;};
 const body= async()=>{if(request.headers.get('origin') && request.headers.get('origin')!==url.origin) fail('Request origin is not allowed.',403);const t=await request.text();if(t.length>16000)fail('Request is too large.',413);try{return JSON.parse(t)}catch{fail('Invalid request.')}};
 const one=(sql,...v)=>db.prepare(sql).bind(...v).first();
 const all=async(sql,...v)=>(await db.prepare(sql).bind(...v).all()).results;
 if(path==='/api/me') return json({user,profile:uid?await one('SELECT * FROM learners WHERE id=?',uid):null,admin:!!uid&&uid===env.ADMIN_USER_ID});
 if(path==='/api/profile'&&request.method==='POST') {
 requireUser(); const b=await body(); if(!b.name?.trim()||b.name.length>80||!postcodeValid(b.postcode||''))fail('Enter your name and a valid UK postcode.');
 if(!['Any','Manual','Automatic'].includes(b.transmission))fail('Choose a transmission.');
 await db.prepare('INSERT INTO learners (id,name,email,postcode,transmission,experience) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,postcode=excluded.postcode,transmission=excluded.transmission,experience=excluded.experience').bind(uid,b.name.trim(),email,normalise(b.postcode),b.transmission,String(b.experience||'New learner').slice(0,100)).run();return json({ok:true});
 }
 if(path==='/api/instructors') {
 await seed(db); const pc=url.searchParams.get('postcode')||'B1 1AA'; if(!postcodeValid(pc)) fail('Enter a valid UK postcode, for example B1 1AA.');
 const district=normalise(pc).split(' ')[0]; const transmission=url.searchParams.get('transmission')||'Any';const day=url.searchParams.get('day')||'Any';const period=url.searchParams.get('period')||'Any';const max=Number(url.searchParams.get('max')||60);
 const instructors=await all('SELECT * FROM instructors WHERE demo=1 OR status=\'verified\'');
 const slots=await all("SELECT s.* FROM slots s WHERE s.blocked=0 AND s.start>? AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.slot_id=s.id AND b.status='confirmed') ORDER BY s.start",new Date().toISOString());
 const results=instructors.filter(i=>i.districts.split(',').includes(district)&&(transmission==='Any'||i.transmission===transmission)&&i.price<=max).map(i=>({...i,slots:slots.filter(s=>{const d=new Date(s.start);const week=d.getUTCDay();const h=d.getUTCHours();return s.instructor_id===i.id&&(day==='Any'||day==='Weekdays'&&week>0&&week<6||day==='Weekend'&&(week===0||week===6))&&(period==='Any'||period==='Morning'&&h<12||period==='Afternoon'&&h>=12&&h<17||period==='Evening'&&h>=17)})})).filter(i=>i.slots.length).sort((a,b)=>a.slots[0].start.localeCompare(b.slots[0].start));
 return json({instructors:results,postcode:normalise(pc)});
 }
 if(path==='/api/bookings'&&request.method==='GET') {requireUser();return json(await all('SELECT b.*,s.start,s.end,i.name,i.photo,i.transmission,i.vehicle,i.area FROM bookings b JOIN slots s ON s.id=b.slot_id JOIN instructors i ON i.id=s.instructor_id WHERE b.learner_id=? ORDER BY s.start',uid));}
 if(path==='/api/bookings'&&request.method==='POST') {
 requireUser(); const b=await body(); if(!await one('SELECT id FROM learners WHERE id=?',uid))fail('Complete your learner profile first.');
 if(!postcodeValid(b.postcode||'')||![1,2].includes(b.duration))fail('Choose a valid pickup postcode and lesson duration.');
 const s=await one('SELECT s.*,i.price,i.districts FROM slots s JOIN instructors i ON i.id=s.instructor_id WHERE s.id=? AND s.blocked=0',b.slot_id);if(!s||s.start<new Date().toISOString())fail('This lesson is no longer available.',409);
 if(!s.districts.split(',').includes(normalise(b.postcode).split(' ')[0]))fail('The pickup postcode is outside this instructor’s coverage.');
 const id=crypto.randomUUID();try{await db.prepare("INSERT INTO bookings (id,learner_id,slot_id,postcode,duration,total,status,created) VALUES (?,?,?,?,?,?,'confirmed',?)").bind(id,uid,b.slot_id,normalise(b.postcode),b.duration,s.price*b.duration,new Date().toISOString()).run()}catch(e){if(/UNIQUE|constraint/i.test(e.message))fail('Someone just booked that slot. Please choose another.',409);throw e;}return json({id,total:s.price*b.duration},201);
 }
 if(path.startsWith('/api/bookings/')&&request.method==='PATCH') {
 requireUser(); const id=path.split('/').pop();const b=await body();const old=await one("SELECT b.*,s.start FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE b.id=? AND b.learner_id=? AND b.status='confirmed'",id,uid); if(!old)fail('Booking not found.',404);
 if(old.start<new Date().toISOString()) fail('Past lessons cannot be changed.');
 if(b.action==='cancel'){await db.prepare("UPDATE bookings SET status='cancelled' WHERE id=? AND learner_id=?").bind(id,uid).run();return json({ok:true});}
 if(b.action==='reschedule'){const s=await one('SELECT s.*,i.price FROM slots s JOIN instructors i ON i.id=s.instructor_id WHERE s.id=? AND s.blocked=0',b.slot_id);const previous=await one('SELECT instructor_id FROM slots WHERE id=?',old.slot_id);if(!s||s.instructor_id!==previous.instructor_id||s.start<new Date().toISOString())fail('Choose another available slot with the same instructor.');try{await db.prepare('UPDATE bookings SET slot_id=?,total=? WHERE id=? AND learner_id=?').bind(s.id,s.price*old.duration,id,uid).run()}catch{fail('That slot is no longer available.',409)}return json({ok:true});}fail('Unknown action.');
 }
 if(path==='/api/waitlist') {requireUser();if(request.method==='GET')return json(await all('SELECT * FROM waiting_list WHERE user_id=?',uid));const b=await body();if(!postcodeValid(b.postcode||''))fail('Enter a valid UK postcode.');if(!['Any','Manual','Automatic'].includes(b.transmission)||!['Any','Weekdays','Weekend'].includes(b.day)||!['Any','Morning','Afternoon','Evening'].includes(b.period))fail('Invalid preferences.');await db.prepare('INSERT INTO waiting_list (id,user_id,postcode,transmission,day,period,created) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(),uid,normalise(b.postcode),b.transmission,b.day,b.period,new Date().toISOString()).run();return json({ok:true});}
 if(path==='/api/instructor'&&request.method==='GET') {requireUser();const instructor=await one('SELECT * FROM instructors WHERE owner_id=?',uid);return json({instructor,slots:instructor?await all('SELECT s.*,EXISTS(SELECT 1 FROM bookings b WHERE b.slot_id=s.id AND b.status=\'confirmed\') AS booked FROM slots s WHERE s.instructor_id=? AND s.start>? ORDER BY s.start',instructor.id,new Date().toISOString()):[]});}
 if(path==='/api/instructor'&&request.method==='POST') {requireUser();const b=await body();if(!b.name?.trim()||!b.area?.trim()||!b.vehicle?.trim()||!b.districts?.trim()||!['Manual','Automatic'].includes(b.transmission)||!Number.isInteger(b.price)||b.price<15||b.price>100)fail('Complete all fields. Hourly price must be £15–£100.');const existing=await one('SELECT id FROM instructors WHERE owner_id=?',uid);if(existing)fail('Your application is already saved.');await db.prepare('INSERT INTO instructors (id,owner_id,name,title,transmission,price,experience,languages,area,districts,photo,vehicle,bio,status,demo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)').bind(crypto.randomUUID(),uid,b.name.slice(0,80),'New instructor',b.transmission,b.price,0,'English',b.area.slice(0,100),b.districts.toUpperCase().replace(/\s/g,'').slice(0,200),'',b.vehicle.slice(0,80),String(b.bio||'').slice(0,1000),'pending').run();return json({ok:true});}
 if(path==='/api/instructor/slots'&&request.method==='POST'){requireUser();const i=await one('SELECT id FROM instructors WHERE owner_id=?',uid);if(!i)fail('Create your instructor profile first.');const b=await body();const start=new Date(b.start);if(!Number.isFinite(+start)||+start<Date.now())fail('Choose a future date.');const end=new Date(+start+7200000);const conflict=await one('SELECT id FROM slots WHERE instructor_id=? AND start<? AND end>?',i.id,end.toISOString(),start.toISOString());if(conflict)fail('This overlaps an existing slot.');await db.prepare('INSERT INTO slots (id,instructor_id,start,end) VALUES (?,?,?,?)').bind(crypto.randomUUID(),i.id,start.toISOString(),end.toISOString()).run();return json({ok:true});}
 if(path==='/api/admin'){requireUser();const stats=await one("SELECT (SELECT count(*) FROM learners) learners,(SELECT count(*) FROM instructors) instructors,(SELECT count(*) FROM bookings WHERE status='confirmed') bookings,(SELECT count(*) FROM waiting_list) waiting");return json({stats,instructors:await all('SELECT id,name,area,status,demo FROM instructors'),demand:await all('SELECT postcode,count(*) requests FROM waiting_list GROUP BY postcode ORDER BY requests DESC'),canVerify:uid===env.ADMIN_USER_ID});}
 if(path==='/api/admin/verify'&&request.method==='POST'){requireUser();if(!env.ADMIN_USER_ID||uid!==env.ADMIN_USER_ID)fail('Only the configured administrator can verify instructors.',403);const b=await body();if(b.confirmed!==true)fail('Complete independent DVSA verification first.');await db.prepare("UPDATE instructors SET status='verified' WHERE id=? AND demo=0").bind(b.id).run();return json({ok:true});}
 return json({error:'Not found'},404);
 }catch(e){return json({error:e.status?e.message:'Something went wrong. Please try again.'},e.status||500)}
}
