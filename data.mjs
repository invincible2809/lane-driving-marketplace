export const demoInstructors = [
['sarah','Sarah Mitchell','Calm, confident starts','Automatic',38,12,'English','Edgbaston, Birmingham','B1,B2,B3,B4,B5,B15,B16,B17,B18,B19,B20,B21,B29,B30','/assets/photo-1.jpg','Toyota Yaris Hybrid','Learning to drive should feel exciting. I specialise in helping nervous and first-time learners find their confidence, one lesson at a time. We will build a plan around your pace and your goals.'],
['james','James Wilson','A little patience. A lot of progress.','Manual',34,9,'English, Punjabi','Harborne, Birmingham','B1,B2,B3,B4,B5,B15,B16,B17,B18,B19,B20,B21,B29,B30,B31','/assets/photo-2.jpg','Volkswagen Golf','Friendly, practical lessons with clear feedback. From your first junction to your test route, I help you understand the road and feel ready for independent driving.'],
['aisha','Aisha Khan','Your journey, at your pace','Automatic',36,7,'English, Urdu','Moseley, Birmingham','B1,B2,B3,B4,B5,B9,B10,B11,B12,B13,B14,B15,B16,B17,B25,B26,B27,B28,B29','/assets/photo-3.jpg','Hyundai i20','Supportive lessons for busy people. I offer flexible afternoon and weekend sessions, with a focus on safe habits that stay with you long after test day.'],
['david','David Thompson','Make every mile count','Manual',32,16,'English','Solihull, West Midlands','B25,B26,B27,B28,B33,B36,B37,B40,B90,B91,B92,B93,B94','/assets/photo-4.jpg','Ford Fiesta','Structured lessons, friendly advice and plenty of practice. I welcome complete beginners, returning learners and people preparing for their practical test.'],
['emma','Emma Davies','Confidence for the road ahead','Manual',35,8,'English, Polish','Sutton Coldfield','B6,B7,B8,B21,B23,B24,B35,B42,B43,B44,B72,B73,B74,B75,B76','/assets/photo-5.jpg','SEAT Ibiza','Patient, encouraging instruction tailored to your experience. Evening lessons are available for learners fitting driving around work or college.'],
['raj','Raj Patel','Small steps. Open roads.','Automatic',37,11,'English, Hindi, Gujarati','Birmingham city centre','B1,B2,B3,B4,B5,B6,B7,B8,B9,B10,B11,B12,B15,B16,B18,B19,B20,B21','/assets/photo-6.jpg','Kia Niro','Approachable and down-to-earth lessons for every stage of your journey. Learn at your pace with simple explanations and a clear plan for your next lesson.']
];
export async function seed(db) {
 for (const x of demoInstructors) await db.prepare('INSERT OR IGNORE INTO instructors (id,name,title,transmission,price,experience,languages,area,districts,photo,vehicle,bio,status,demo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)').bind(...x,'demo').run();
 const statements=[];
 const today=new Date(); today.setUTCHours(0,0,0,0);
 for(let d=1;d<=21;d++) for(let i=0;i<6;i++) for(const hour of [9,13,17]) {
 if((d+i+hour)%4===0) continue;
 const start=new Date(today.getTime()+d*86400000+hour*3600000);
 const id=demoInstructors[i][0]+'-'+start.toISOString().slice(0,13);
 statements.push(db.prepare('INSERT OR IGNORE INTO slots (id,instructor_id,start,end) VALUES (?,?,?,?)').bind(id,demoInstructors[i][0],start.toISOString(),new Date(+start+7200000).toISOString()));
 }
 for(let i=0;i<statements.length;i+=50) await db.batch(statements.slice(i,i+50));
}
