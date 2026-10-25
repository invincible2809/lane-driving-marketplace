import {seed} from './data.mjs';
import {ukParts,ukInstant,bookingStart,bookingEnd,availableStarts} from './scheduling.mjs';
import {runReminders} from './notifications.mjs';
export const postcodeValid = s => typeof s==='string' && /^(GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})$/i.test(s.trim());
export const normalise = s => s.trim().toUpperCase().replace(/\s/g,'').replace(/(.{3})$/,' $1');
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const active=['confirmed','pending'];
const stamp=()=>new Date().toISOString();
const string=(v,max=100)=>typeof v==='string'?v.trim().slice(0,max):'';
const emailValid=s=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const expiryValid=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s&&s>=stamp().slice(0,10);
const isUniqueError=e=>/constraint|conflict|unavailable|overlap|has_booking|UNIQUE/i.test(e.message);
export async function api(request,db,env={}) {
 try {
  const url=new URL(request.url),path=url.pathname,method=request.method;
  const uid=request.headers.get('oai-authenticated-user-id');
  const email=request.headers.get('oai-authenticated-user-email')||'';
  const user=uid?{id:uid,email}:null;
  const isAdmin=!!uid&&((env.ADMIN_USER_ID&&uid===env.ADMIN_USER_ID)||(env.ADMIN_EMAIL&&email.toLowerCase()===env.ADMIN_EMAIL.toLowerCase()));
  const requireUser=()=>{if(!user)fail('Please sign in to continue.',401);};
  const requireAdmin=()=>{requireUser();if(!isAdmin)fail('Administrator access is required.',403);};
  const origin=()=>{if(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)fail('Request origin is not allowed.',403);};
  const body=async()=>{origin();const t=await request.text();if(t.length>16000)fail('Request is too large.',413);try{const b=JSON.parse(t);if(!b||typeof b!=='object'||Array.isArray(b))fail('Invalid request.');return b}catch{fail('Invalid request.');}};
  const one=(sql,...v)=>db.prepare(sql).bind(...v).first();
  const all=async(sql,...v)=>(await db.prepare(sql).bind(...v).all()).results;
  const ownInstructor=async()=>{requireUser();const i=await one('SELECT * FROM instructors WHERE owner_id=?',uid);if(!i)fail('Create your instructor profile first.',404);return i;};
  const slotBookings=async id=>all("SELECT b.*,s.start,s.instructor_id FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE s.instructor_id=? AND b.status IN ('confirmed','pending')",id);
  const asBooking=b=>({...b,start:bookingStart(b),end:bookingEnd(b)});
  const available=async(i,duration=2,ignore=null)=>{
   const [slots,bookings,blocks]=await Promise.all([all('SELECT * FROM slots WHERE instructor_id=? AND blocked=0 AND end>? ORDER BY start',i.id,stamp()),slotBookings(i.id),all('SELECT * FROM blackouts WHERE instructor_id=?',i.id)]);
   return slots.flatMap(s=>availableStarts(s,bookings,blocks,i.travel_buffer,duration,ignore).filter(at=>i.demo||at.slice(0,10)<=i.registration_expiry).map(at=>({id:s.id+'@'+at,slot_id:s.id,start:at,end:new Date(Date.parse(at)+duration*3600000).toISOString()})));
  };
  const resolveSlot=async b=>{
   let slotId=b.slot_id,at=b.start;
   if(typeof slotId==='string'&&slotId.includes('@')){const n=slotId.indexOf('@');at=slotId.slice(n+1);slotId=slotId.slice(0,n);}
   if(typeof slotId!=='string')fail('Choose a lesson time.');
   const s=await one('SELECT s.*,i.price,i.districts,i.booking_mode,i.owner_id,i.status AS instructor_status,i.demo,i.registration_expiry FROM slots s JOIN instructors i ON i.id=s.instructor_id WHERE s.id=? AND s.blocked=0',slotId);
   if(!s)fail('This lesson is no longer available.',409);
   at=at||s.start;const start=new Date(at);if(!Number.isFinite(+start)||start.toISOString()!==at||+start<=Date.now())fail('Choose a valid future lesson time.');
   const duration=b.duration;if(![1,1.5,2].includes(duration))fail('Choose a 1, 1.5 or 2-hour lesson.');
   const end=new Date(+start+duration*3600000).toISOString();if(at<s.start||end>s.end||(Date.parse(at)-Date.parse(s.start))%1800000!==0)fail('The lesson must fit within an available teaching window.');
   if(!s.demo&&(s.instructor_status!=='verified'||s.registration_expiry<end.slice(0,10)))fail('This instructor is not currently available for booking.',409);
   return {...s,lessonStart:at,lessonEnd:end,duration};
  };
  if(path==='/api/me'&&method==='GET')return json({user,profile:uid?await one('SELECT * FROM learners WHERE id=?',uid):null,admin:isAdmin,notifications:uid?(await one('SELECT count(*) n FROM notifications WHERE user_id=? AND read_at IS NULL',uid)).n:0});
  if(path==='/api/profile'&&method==='POST'){
   requireUser();const b=await body();const name=string(b.name,80);if(!name||!postcodeValid(b.postcode))fail('Enter your name and a valid UK postcode.');
   if(!['Any','Manual','Automatic'].includes(b.transmission))fail('Choose a transmission.');
   await db.prepare('INSERT INTO learners (id,name,email,postcode,transmission,experience) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email,postcode=excluded.postcode,transmission=excluded.transmission,experience=excluded.experience').bind(uid,name,email,normalise(b.postcode),b.transmission,string(b.experience)||'New learner').run();return json({ok:true});
  }
  if(path==='/api/instructors'&&method==='GET'){
   const pc=url.searchParams.get('postcode')||'B1 1AA';if(!postcodeValid(pc))fail('Enter a valid UK postcode, for example B1 1AA.');await seed(db);
   const duration=Number(url.searchParams.get('duration')||2);if(![1,1.5,2].includes(duration))fail('Choose a valid duration.');
   const district=normalise(pc).split(' ')[0],transmission=url.searchParams.get('transmission')||'Any',day=url.searchParams.get('day')||'Any',period=url.searchParams.get('period')||'Any',max=Number(url.searchParams.get('max')||100);
   const instructors=await all("SELECT id,name,title,transmission,price,experience,languages,area,districts,photo,vehicle,bio,status,demo,qualification,registration_expiry,booking_mode,travel_buffer FROM instructors WHERE demo=1 OR (status='verified' AND registration_expiry>=?)",stamp().slice(0,10));
   const results=[];for(const i of instructors){if(!i.districts.split(',').includes(district)||(transmission!=='Any'&&i.transmission!==transmission)||i.price>max)continue;
    const slots=(await available(i,duration)).filter(s=>{const p=ukParts(s.start);return (day==='Any'||day==='Weekdays'&&p.weekday>0&&p.weekday<6||day==='Weekend'&&(p.weekday===0||p.weekday===6))&&(period==='Any'||period==='Morning'&&p.hour<12||period==='Afternoon'&&p.hour>=12&&p.hour<17||period==='Evening'&&p.hour>=17);});
    if(slots.length)results.push({...i,photo:i.photo||'/assets/photo-0.jpg',slots});
   }
   results.sort((a,b)=>a.slots[0].start.localeCompare(b.slots[0].start));return json({instructors:results,postcode:normalise(pc),duration});
  }
  if(path.startsWith('/api/instructors/')&&method==='GET'){
   const i=await one("SELECT id,name,title,transmission,price,experience,languages,area,districts,photo,vehicle,bio,status,demo,qualification,registration_expiry,booking_mode,travel_buffer FROM instructors WHERE id=? AND (demo=1 OR (status='verified' AND registration_expiry>=?))",path.split('/').pop(),stamp().slice(0,10));if(!i)fail('Instructor not found.',404);return json({...i,photo:i.photo||'/assets/photo-0.jpg'});
  }
  if(path==='/api/availability'&&method==='GET'){
   const i=await one("SELECT * FROM instructors WHERE id=? AND (demo=1 OR status='verified')",url.searchParams.get('instructor'));if(!i)fail('Instructor not found.',404);
   const duration=Number(url.searchParams.get('duration')||2);if(![1,1.5,2].includes(duration))fail('Invalid lesson duration.');let ignore=null;
   if(url.searchParams.get('booking')){requireUser();const b=await one('SELECT b.id FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE b.id=? AND b.learner_id=? AND s.instructor_id=?',url.searchParams.get('booking'),uid,i.id);if(!b)fail('Booking not found.',404);ignore=b.id;}
   return json({slots:await available(i,duration,ignore)});
  }
  if(path==='/api/bookings'&&method==='GET'){
   requireUser();return json((await all('SELECT b.*,s.start,s.end,s.instructor_id,i.name,i.photo,i.transmission,i.vehicle,i.area,i.demo FROM bookings b JOIN slots s ON s.id=b.slot_id JOIN instructors i ON i.id=s.instructor_id WHERE b.learner_id=? ORDER BY COALESCE(b.starts_at,s.start)',uid)).map(asBooking));
  }
  if(path==='/api/bookings'&&method==='POST'){
   requireUser();const b=await body();if(!await one('SELECT id FROM learners WHERE id=?',uid))fail('Complete your learner profile first.');if(!postcodeValid(b.postcode))fail('Enter a valid pickup postcode.');
   const s=await resolveSlot(b);if(s.owner_id===uid)fail('You cannot book your own teaching time.');if(!s.districts.split(',').includes(normalise(b.postcode).split(' ')[0]))fail('The pickup postcode is outside this instructor’s coverage.');
   const id=crypto.randomUUID(),status=s.booking_mode==='approval'?'pending':'confirmed',total=Math.round(s.price*b.duration*100)/100;
   await db.prepare('INSERT INTO bookings (id,learner_id,slot_id,postcode,duration,total,status,created,starts_at,ends_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(id,uid,s.id,normalise(b.postcode),b.duration,total,status,stamp(),s.lessonStart,s.lessonEnd).run();return json({id,total,status},201);
  }
  if(path.startsWith('/api/bookings/')&&method==='PATCH'){
   requireUser();const id=path.split('/').pop(),b=await body();const old=await one("SELECT b.*,s.start,s.instructor_id FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE b.id=? AND b.learner_id=? AND b.status IN ('confirmed','pending')",id,uid);if(!old)fail('Booking not found.',404);if(bookingStart(old)<=stamp())fail('Past lessons cannot be changed.');
   let changed;
   if(b.action==='cancel')changed=await db.prepare("UPDATE bookings SET status='cancelled',proposed_slot_id=NULL,proposed_start=NULL,revision=revision+1 WHERE id=? AND revision=?").bind(id,old.revision).run();
   else if(['reschedule','accept_proposal'].includes(b.action)){
    if(b.action==='accept_proposal'&&!old.proposed_slot_id)fail('There is no proposed time to accept.');
    const s=await resolveSlot(b.action==='accept_proposal'?{slot_id:old.proposed_slot_id,start:old.proposed_start,duration:old.duration}:{...b,duration:old.duration});if(s.instructor_id!==old.instructor_id)fail('Choose another time with the same instructor.');
    changed=await db.prepare('UPDATE bookings SET slot_id=?,starts_at=?,ends_at=?,proposed_slot_id=NULL,proposed_start=NULL,revision=revision+1 WHERE id=? AND revision=?').bind(s.id,s.lessonStart,s.lessonEnd,id,old.revision).run();
   }else if(b.action==='decline_proposal')changed=await db.prepare('UPDATE bookings SET proposed_slot_id=NULL,proposed_start=NULL,revision=revision+1 WHERE id=? AND revision=?').bind(id,old.revision).run();
   else fail('Unknown booking action.');if(changed&&!changed.meta.changes)fail('This booking changed. Refresh before trying again.',409);return json({ok:true});
  }
  if(path==='/api/waitlist'){
   requireUser();if(method==='GET')return json(await all('SELECT * FROM waiting_list WHERE user_id=?',uid));if(method!=='POST')fail('Method not allowed.',405);const b=await body();if(!postcodeValid(b.postcode))fail('Enter a valid UK postcode.');if(!['Any','Manual','Automatic'].includes(b.transmission)||!['Any','Weekdays','Weekend'].includes(b.day)||!['Any','Morning','Afternoon','Evening'].includes(b.period))fail('Invalid preferences.');await db.prepare('INSERT INTO waiting_list (id,user_id,postcode,transmission,day,period,created) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(),uid,normalise(b.postcode),b.transmission,b.day,b.period,stamp()).run();return json({ok:true});
  }
  if(path==='/api/instructor'&&method==='GET'){
   requireUser();const instructor=await one('SELECT * FROM instructors WHERE owner_id=?',uid);if(!instructor)return json({instructor:null});
   const id=instructor.id;const [slots,rules,blocks,documents,bookings,reviews]=await Promise.all([
    all("SELECT s.*,EXISTS(SELECT 1 FROM bookings b WHERE b.slot_id=s.id AND b.status IN ('confirmed','pending')) AS booked FROM slots s WHERE s.instructor_id=? AND s.end>? ORDER BY s.start",id,stamp()),
    all('SELECT * FROM recurring_rules WHERE instructor_id=? ORDER BY from_day',id),all('SELECT * FROM blackouts WHERE instructor_id=? AND end>? ORDER BY start',id,stamp()),all('SELECT id,filename,content_type,bytes,created FROM verification_documents WHERE instructor_id=?',id),
    all('SELECT b.*,s.start,s.end,l.name AS learner_name FROM bookings b JOIN slots s ON s.id=b.slot_id JOIN learners l ON l.id=b.learner_id WHERE s.instructor_id=? ORDER BY COALESCE(b.starts_at,s.start)',id),all('SELECT decision,note,created FROM verification_reviews WHERE instructor_id=? ORDER BY created DESC LIMIT 10',id)]);
   return json({instructor,slots,rules,blocks,documents,bookings:bookings.map(asBooking),reviews});
  }
  if(path==='/api/instructor'&&['POST','PATCH'].includes(method)){
   requireUser();const b=await body(),existing=await one('SELECT * FROM instructors WHERE owner_id=?',uid);
   if(b.action==='submit'){
    if(!existing)fail('Save your profile first.');if(!existing.registration_number||!expiryValid(existing.registration_expiry))fail('Add valid DVSA registration details and expiry first.');
    if(!await one('SELECT id FROM verification_documents WHERE instructor_id=?',existing.id))fail('Upload registration evidence before submitting.');
    if(existing.status==='verified')fail('Your profile is already verified.');await db.prepare("UPDATE instructors SET status='pending',review_note='' WHERE id=?").bind(existing.id).run();return json({ok:true});
   }
   const name=string(b.name,80),area=string(b.area),vehicle=string(b.vehicle,80),districts=string(b.districts,300).toUpperCase().replace(/\s/g,'');
   if(!name||!area||!vehicle||!districts||districts.split(',').some(d=>!/^([A-Z]{1,2}\d[A-Z\d]?|GIR)$/.test(d))||!['Manual','Automatic'].includes(b.transmission)||!Number.isInteger(b.price)||b.price<15||b.price>100)fail('Complete your profile with valid postcode districts and an hourly price of £15–£100.');
   const qualification=b.qualification||existing?.qualification||'ADI',registration=string(b.registration_number,10),expiry=string(b.registration_expiry,10),mode=b.booking_mode||'instant',buffer=Number(b.travel_buffer||0),experience=Number(b.experience||0);
   if(!['ADI','PDI'].includes(qualification)||registration&&!/^\d{4,10}$/.test(registration)||expiry&&!expiryValid(expiry)||!['instant','approval'].includes(mode)||![0,15,30,45,60].includes(buffer)||!Number.isInteger(experience)||experience<0||experience>60)fail('Check your qualification, registration, expiry date and booking preferences.');
   const languages=string(b.languages,100)||'English',bio=string(b.bio,1500),title=string(b.title,80)||'Your journey, at your pace';
   if(existing){const reset=existing.name!==name||existing.registration_number!==registration||existing.registration_expiry!==expiry||existing.qualification!==qualification;
    await db.prepare('UPDATE instructors SET name=?,area=?,vehicle=?,districts=?,transmission=?,price=?,qualification=?,registration_number=?,registration_expiry=?,booking_mode=?,travel_buffer=?,experience=?,languages=?,bio=?,title=?,email=?,status=?,verified_at=? WHERE id=?').bind(name,area,vehicle,districts,b.transmission,b.price,qualification,registration,expiry,mode,buffer,experience,languages,bio,title,email,reset?'draft':existing.status,reset?null:existing.verified_at,existing.id).run();
   }else await db.prepare("INSERT INTO instructors (id,owner_id,name,title,transmission,price,experience,languages,area,districts,photo,vehicle,bio,status,demo,email,qualification,registration_number,registration_expiry,booking_mode,travel_buffer) VALUES (?,?,?,?,?,?,?,?,?,?,'',?,?,'draft',0,?,?,?,?,?,?)").bind(crypto.randomUUID(),uid,name,title,b.transmission,b.price,experience,languages,area,districts,vehicle,bio,email,qualification,registration,expiry,mode,buffer).run();return json({ok:true});
  }
  if(path==='/api/instructor/documents'&&method==='POST'){
   const i=await ownInstructor();origin();if(!env.BUCKET)fail('Private document storage is not configured.',503);
   const max=5*1024*1024;if(Number(request.headers.get('content-length'))>max+16384)fail('Maximum document size is 5 MB.',413);
   const raw=await request.arrayBuffer();if(raw.byteLength>max+16384)fail('Maximum document size is 5 MB.',413);
   let form;try{form=await new Response(raw,{headers:{'Content-Type':request.headers.get('content-type')||''}}).formData()}catch{fail('Upload a PDF, JPEG or PNG document.');}
   const f=form.get('document');if(!f||typeof f.arrayBuffer!=='function'||!f.size||f.size>max)fail('Choose a document up to 5 MB.');
   if((await one('SELECT count(*) n FROM verification_documents WHERE instructor_id=?',i.id)).n>=5)fail('You can upload up to five documents.');
   const bytes=await f.arrayBuffer(),a=new Uint8Array(bytes),head=new TextDecoder().decode(a.slice(0,5));let type='';if(head==='%PDF-')type='application/pdf';else if(a[0]===255&&a[1]===216&&a[2]===255)type='image/jpeg';else if(a.slice(0,8).join(',')==='137,80,78,71,13,10,26,10')type='image/png';if(!type||f.type!==type)fail('Use a valid PDF, JPEG or PNG file.');
   const id=crypto.randomUUID(),key='verification/'+i.id+'/'+id;await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:type}});
   try{await db.batch([db.prepare('INSERT INTO verification_documents (id,instructor_id,object_key,filename,content_type,bytes,created) VALUES (?,?,?,?,?,?,?)').bind(id,i.id,key,string(f.name,150)||'document',type,f.size,stamp()),db.prepare("UPDATE instructors SET status='draft',verified_at=NULL WHERE id=?").bind(i.id)]);}catch(e){await env.BUCKET.delete(key);throw e;}return json({id},201);
  }
  if(path.startsWith('/api/documents/')){
   requireUser();const id=path.split('/').pop(),doc=await one('SELECT d.*,i.owner_id FROM verification_documents d JOIN instructors i ON i.id=d.instructor_id WHERE d.id=?',id);if(!doc||(!isAdmin&&doc.owner_id!==uid))fail('Document not found.',404);
   if(method==='GET'){const object=await env.BUCKET?.get(doc.object_key);if(!object)fail('Document not found.',404);return new Response(object.body,{headers:{'Content-Type':doc.content_type,'Content-Disposition':'attachment; filename="verification-document.'+(doc.content_type==='application/pdf'?'pdf':doc.content_type==='image/png'?'png':'jpg')+'"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});}
   if(method==='DELETE'){origin();if(doc.owner_id!==uid)fail('Only the instructor can remove their documents.',403);await db.batch([db.prepare('DELETE FROM verification_documents WHERE id=?').bind(id),db.prepare("UPDATE instructors SET status='draft',verified_at=NULL WHERE id=?").bind(doc.instructor_id)]);await env.BUCKET?.delete(doc.object_key);return json({ok:true});}
  }
  if(path==='/api/instructor/slots'&&method==='POST'){
   const i=await ownInstructor(),b=await body();let start,end;
   try{start=b.day?ukInstant(b.day,b.start_time):new Date(b.start).toISOString();end=b.day?ukInstant(b.day,b.end_time):new Date(Date.parse(start)+(Number(b.hours)||2)*3600000).toISOString();}catch(e){fail(e.message);}
   if(start<=stamp()||end<=start||Date.parse(end)-Date.parse(start)>43200000)fail('Choose a future teaching window of up to 12 hours.');
   const id=crypto.randomUUID();await db.prepare('INSERT INTO slots (id,instructor_id,start,end) VALUES (?,?,?,?)').bind(id,i.id,start,end).run();return json({id},201);
  }
  if(path.startsWith('/api/instructor/slots/')&&method==='PATCH'){
   const i=await ownInstructor(),b=await body();if(typeof b.blocked!=='boolean')fail('Choose whether the slot is blocked.');
   const r=await db.prepare('UPDATE slots SET blocked=? WHERE id=? AND instructor_id=?').bind(b.blocked?1:0,path.split('/').pop(),i.id).run();if(!r.meta.changes)fail('Slot not found.',404);return json({ok:true});
  }
  if(path==='/api/instructor/recurring'&&method==='POST'){
   const i=await ownInstructor(),b=await body();if(!Number.isInteger(b.weekday)||b.weekday<0||b.weekday>6)fail('Choose a weekday.');let first,last;try{first=ukInstant(b.from_day,'12:00');last=ukInstant(b.until_day,'12:00');ukInstant(b.from_day,b.start_time);ukInstant(b.from_day,b.end_time);}catch(e){fail(e.message);}
   if(last<first||Date.parse(last)-Date.parse(first)>83*86400000||b.from_day<ukParts(Date.now()).day||b.end_time<=b.start_time)fail('Choose a date range of up to 12 weeks and an end time after the start time.');
   const id=crypto.randomUUID(),statements=[db.prepare('INSERT INTO recurring_rules (id,instructor_id,weekday,start_time,end_time,from_day,until_day) VALUES (?,?,?,?,?,?,?)').bind(id,i.id,b.weekday,b.start_time,b.end_time,b.from_day,b.until_day)];
   for(let at=Date.parse(first);at<=Date.parse(last);at+=86400000){const day=new Date(at).toISOString().slice(0,10);if(new Date(day+'T12:00Z').getUTCDay()!==b.weekday)continue;let start,end;try{start=ukInstant(day,b.start_time);end=ukInstant(day,b.end_time);}catch(e){fail(e.message);}if(start<=stamp())continue;if(Date.parse(end)-Date.parse(start)>43200000)fail('Teaching windows can be up to 12 hours.');statements.push(db.prepare('INSERT INTO slots (id,instructor_id,start,end,recurring_id) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),i.id,start,end,id));}
   if(statements.length===1)fail('No future dates match this weekly schedule.');await db.batch(statements);return json({id,windows:statements.length-1},201);
  }
  if(path.startsWith('/api/instructor/recurring/')&&method==='DELETE'){
   const i=await ownInstructor();origin();const id=path.split('/').pop();if(!await one('SELECT id FROM recurring_rules WHERE id=? AND instructor_id=?',id,i.id))fail('Schedule not found.',404);
   await db.batch([db.prepare('UPDATE recurring_rules SET active=0 WHERE id=?').bind(id),db.prepare("UPDATE slots SET blocked=1 WHERE recurring_id=? AND instructor_id=? AND start>? AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.slot_id=slots.id AND b.status IN ('confirmed','pending'))").bind(id,i.id,stamp())]);return json({ok:true});
  }
  if(path==='/api/instructor/blocks'&&method==='POST'){
   const i=await ownInstructor(),b=await body();let start,end;try{start=ukInstant(b.from_day,'00:00');const until=ukInstant(b.until_day,'12:00');const next=new Date(Date.parse(until)+86400000).toISOString().slice(0,10);end=ukInstant(next,'00:00');}catch(e){fail(e.message);}if(end<=start||Date.parse(end)-Date.parse(start)>91*86400000||end<=stamp())fail('Choose a valid date range of up to 90 days.');const id=crypto.randomUUID();await db.prepare('INSERT INTO blackouts (id,instructor_id,start,end,reason) VALUES (?,?,?,?,?)').bind(id,i.id,start,end,string(b.reason,80)||'Unavailable').run();return json({id},201);
  }
  if(path.startsWith('/api/instructor/blocks/')&&method==='DELETE'){
   const i=await ownInstructor();origin();await db.prepare('DELETE FROM blackouts WHERE id=? AND instructor_id=?').bind(path.split('/').pop(),i.id).run();return json({ok:true});
  }
  if(path.startsWith('/api/instructor/bookings/')&&method==='PATCH'){
   const i=await ownInstructor(),id=path.split('/').pop(),b=await body();const old=await one("SELECT b.*,s.start FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE b.id=? AND s.instructor_id=? AND b.status IN ('confirmed','pending')",id,i.id);if(!old)fail('Booking not found.',404);if(bookingStart(old)<=stamp())fail('Past lessons cannot be changed.');
   let changed;
   if(['accept','decline','cancel'].includes(b.action)){
    if(['accept','decline'].includes(b.action)&&old.status!=='pending')fail('Only pending requests can be accepted or declined.');const status={accept:'confirmed',decline:'declined',cancel:'cancelled'}[b.action];changed=await db.prepare('UPDATE bookings SET status=?,proposed_slot_id=NULL,proposed_start=NULL,revision=revision+1 WHERE id=? AND revision=?').bind(status,id,old.revision).run();
   }else if(b.action==='propose'){
    const s=await resolveSlot({...b,duration:old.duration});if(s.instructor_id!==i.id)fail('Choose a time in your own calendar.');const choices=await available(i,old.duration,old.id);if(!choices.some(x=>x.slot_id===s.id&&x.start===s.lessonStart))fail('That time is unavailable.',409);changed=await db.prepare('UPDATE bookings SET proposed_slot_id=?,proposed_start=?,revision=revision+1 WHERE id=? AND revision=?').bind(s.id,s.lessonStart,id,old.revision).run();
   }else fail('Unknown booking action.');if(changed&&!changed.meta.changes)fail('This booking changed. Refresh before trying again.',409);return json({ok:true});
  }
  if(path==='/api/instructor/available'&&method==='GET'){
   const i=await ownInstructor(),id=url.searchParams.get('booking');const b=await one('SELECT b.* FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE b.id=? AND s.instructor_id=?',id,i.id);if(!b)fail('Booking not found.',404);return json({slots:await available(i,b.duration,b.id)});
  }
  if(path==='/api/notifications'&&method==='GET'){
   requireUser();return json({notifications:await all('SELECT id,title,message,created,read_at FROM notifications WHERE user_id=? ORDER BY created DESC LIMIT 100',uid),emailConfigured:!!(env.RESEND_API_KEY&&env.EMAIL_FROM)});
  }
  if(path==='/api/notifications/read'&&method==='POST'){
   requireUser();const b=await body();if(b.id)await db.prepare('UPDATE notifications SET read_at=? WHERE id=? AND user_id=?').bind(stamp(),b.id,uid).run();else await db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').bind(stamp(),uid).run();return json({ok:true});
  }
  if(path==='/api/jobs/reminders'&&['GET','POST'].includes(method)){
   origin();const secret=env.JOB_SECRET&&request.headers.get('Authorization')==='Bearer '+env.JOB_SECRET;
   if(!isAdmin&&!secret&&!(env.PRIVATE_JOB_ACCESS==='true'&&!uid))fail('Reminder worker access is required.',403);if(method==='GET')return json({lastRun:await one('SELECT * FROM job_runs ORDER BY completed DESC LIMIT 1'),emailConfigured:!!(env.RESEND_API_KEY&&env.EMAIL_FROM),outbox:await all('SELECT status,count(*) count FROM email_outbox GROUP BY status')});return json(await runReminders(db,env));
  }
  if(path==='/api/admin'&&method==='GET'){
   requireAdmin();return json({stats:await one("SELECT (SELECT count(*) FROM learners) learners,(SELECT count(*) FROM instructors) instructors,(SELECT count(*) FROM bookings WHERE status IN ('confirmed','pending')) bookings,(SELECT count(*) FROM waiting_list) waiting"),instructors:await all('SELECT id,name,area,status,demo,qualification,registration_expiry FROM instructors'),demand:await all('SELECT postcode,count(*) requests FROM waiting_list GROUP BY postcode ORDER BY requests DESC'),canVerify:true,emailConfigured:!!(env.RESEND_API_KEY&&env.EMAIL_FROM),outbox:await all('SELECT status,count(*) count FROM email_outbox GROUP BY status'),lastJob:await one('SELECT * FROM job_runs ORDER BY completed DESC LIMIT 1')});
  }
  if(path.startsWith('/api/admin/instructors/')&&method==='GET'){
   requireAdmin();const id=path.split('/').pop(),i=await one('SELECT * FROM instructors WHERE id=? AND demo=0',id);if(!i)fail('Application not found.',404);return json({instructor:i,documents:await all('SELECT id,filename,content_type,bytes,created FROM verification_documents WHERE instructor_id=?',id),reviews:await all('SELECT * FROM verification_reviews WHERE instructor_id=? ORDER BY created DESC',id)});
  }
  if(path==='/api/admin/verify'&&method==='POST'){
   requireAdmin();const b=await body(),i=await one('SELECT * FROM instructors WHERE id=? AND demo=0',b.id);if(!i||i.status!=='pending')fail('Only submitted applications can be reviewed.',409);
   const note=string(b.note,2000);if(note.length<10)fail('Add a review note explaining the checks or changes needed.');if(!['approve','changes_requested','reject'].includes(b.decision))fail('Choose a review decision.');
   const docs=await all('SELECT id FROM verification_documents WHERE instructor_id=? ORDER BY id',i.id);const evidence=docs.map(x=>x.id).join(',');
   if(b.decision==='approve'&&(!docs.length||!i.registration_number||!expiryValid(i.registration_expiry)||b.identity_checked!==true||b.dvsa_checked!==true||b.eligibility_checked!==true))fail('Review the uploaded evidence, confirm all checks, and check the registration expiry.');
   if(b.decision==='approve'&&i.owner_id===uid)fail('A different administrator must independently review your own application.',403);
   const status={approve:'verified',changes_requested:'changes_requested',reject:'rejected'}[b.decision],at=stamp();
   const results=await db.batch([db.prepare("UPDATE instructors SET status=?,review_note=?,verified_at=? WHERE id=? AND status='pending' AND registration_number=? AND registration_expiry=? AND name=? AND qualification=? AND COALESCE((SELECT group_concat(id) FROM (SELECT id FROM verification_documents WHERE instructor_id=? ORDER BY id)),'')=?").bind(status,note,status==='verified'?at:null,i.id,i.registration_number,i.registration_expiry,i.name,i.qualification,i.id,evidence),db.prepare('INSERT INTO verification_reviews (id,instructor_id,reviewer_id,decision,note,created) SELECT ?,?,?,?,?,? WHERE changes()>0').bind(crypto.randomUUID(),i.id,uid,b.decision,note,at)]);
   if(!results[0].meta.changes)fail('The application changed while you were reviewing. Reload and check it again.',409);
   await db.prepare('INSERT INTO notifications (id,user_id,event_key,title,message,created) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),i.owner_id,'review:'+crypto.randomUUID(),'Your instructor application was reviewed',status==='verified'?'Your profile is verified and eligible to appear in search until your registration expires.':note,at).run();return json({ok:true,status});
  }
  return json({error:'Not found'},404);
 }catch(e){if(isUniqueError(e))return json({error:/blackout_has_booking|slot_has_booking/.test(e.message)?'This time has an active booking. Cancel or reschedule it before blocking the time.':'That time is unavailable or overlaps another lesson or teaching window. Refresh and choose another.'},409);return json({error:e.status?e.message:'Something went wrong. Please try again.'},e.status||500);}
}
