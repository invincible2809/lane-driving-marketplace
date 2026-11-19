// Public website content for SRK Driving School.
// Source: srkdrivingschool.co.uk and the Google Maps listing, read on 12 Nov 2026.
// Items marked CONFIRM need the owner's check before launch.
export const business = {
  name: 'SRK Driving School',
  tagline: 'Automatic driving lessons in Sutton Coldfield and north Birmingham',
  phone: '07852 998967',
  phone_e164: '+447852998967',
  email: 'info@srkdrivingschool.co.uk',
  whatsapp: 'https://wa.me/447852998967?text=' + encodeURIComponent("Hi, I'd like to book a driving lesson with SRK Driving School."),
  address: {street: '5 Ploughmans Place', locality: 'Sutton Coldfield', region: 'Birmingham', postcode: 'B75 5TR', country: 'GB'},
  geo: {lat: 52.5631, lng: -1.8247},
  // Office hours as listed on Google Maps. CONFIRM: the current site also says "7 days a week, 9am–9pm".
  hours: [
    {days: 'Monday to Friday', open: '09:30', close: '19:00', schema: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']},
    {days: 'Saturday and Sunday', open: '09:00', close: '14:00', schema: ['Saturday', 'Sunday']}
  ],
  google_maps_url: 'https://maps.app.goo.gl/akLFXEkfsWg2fdSG9',
  // Test-day photos from srkdrivingschool.co.uk (read 19 Nov 2026), resized and stripped of metadata
  // by scripts/brand/prepare-pass-photos.py. Only show learners who agreed to their photo being shared.
  pass_photos: Array.from({length: 25}, (_, i) => `/site/passes/pass-${String(i + 1).padStart(2, '0')}.jpg`),
  // Shown with its date so it never goes stale silently. Update when it changes.
  google_rating: {score: '5.0', count: 13, as_of: 'November 2026'},
  // Google reviews copied word for word from srkdrivingschool.co.uk (read 12 Nov 2026), the first three are featured, the rest follow newest first.
  // Add only real quotes: {quote, name, when, source}. The testimonials on that site signed with initials are not used.
  reviews: [
    {quote: "Very good teacher, Shahrukh from SRK Driving School, had my driving test and got a pass with 0 errors. Would recommend!", name: "Jun Wu", when: "September 2026", source: 'Google'},
    {quote: "Highly recommended! Today, I passed my driving test at Kingstanding Test Centre with Shahrukh from SRK Driving School. I tried a few instructors before, but Shahrukh taught me calmly and patiently. He explained everything clearly and in detail. Thank you so much!", name: "Rakesh Jose", when: "August 2026", source: 'Google'},
    {quote: "Really recommend, great driving instructor as made me feel at ease straight away. Thanks for teaching me - got me the pass!!", name: "Isobel", when: "July 2026", source: 'Google'},
    {quote: "I have passed my practical test with SRK driving school\nInstructor is always disciplined and calm\nVery easy and apt methods of teaching normal driving and manoeuvres\nInstructor explains every minute technique very nicely which others may neglect\nThis is my personal experience\nVery useful place to learn", name: "Renu Bala", when: "August 2026", source: 'Google'},
    {quote: "Great teacher! Felt prepared and learnt a lot from our lessons. Plus, passed first time!", name: "Mike J Fellows", when: "August 2026", source: 'Google'},
    {quote: "Thank you Sharruk for helping me pass my driving test today!", name: "GodBeFaithful", when: "July 2026", source: 'Google'},
    {quote: "Hello everyone, I'm thrilled to share that I passed my driving test today! I would like to express my deepest gratitude to Sharukh for giving me ample time to experience the best driving experience possible. I highly recommend everyone visit SRK Driving School to experience their driving lessons.\nThank you sharukh", name: "Divya Kuntal", when: "July 2026", source: 'Google'},
    {quote: "Thank you so much on helping me pass!\nYou have been an amazing teacher and have always been patient with me.", name: "Parsa Zahid", when: "July 2026", source: 'Google'},
    {quote: "really good driving school, i passed first time! would definitely recommend!", name: "Anna", when: "July 2026", source: 'Google'}
  ],
  social: {facebook: 'https://www.facebook.com/srkdrivingschool'},
  transmission: 'Automatic',
  instructor: {
    name: 'Shahrukh',
    // CONFIRM: qualification wording and, if you want to show it, your ADI certificate number.
    qualification: 'DVSA Approved Driving Instructor (ADI)',
    bio: 'I give automatic driving lessons in and around Sutton Coldfield, Kingstanding, Perry Barr, Garretts Green, Lichfield, Tamworth and Aldridge. My aim is to help you pass your test as quickly as you safely can, so you can enjoy driving yourself, your friends and family independently and safely.'
  },
  // CONFIRM spellings: the current site uses "Perry Bar" and "Garrett Green".
  areas: ['Sutton Coldfield', 'Kingstanding', 'Perry Barr', 'Garretts Green', 'Lichfield', 'Tamworth', 'Aldridge'],
  // CONFIRM prices. The current site lists "Manual or automatic" on the single lesson,
  // but the business is listed as automatic-only; automatic is shown here.
  packages: [
    {id: 'single', name: 'Single lesson', length: '1 hour', price: '£40', points: ['Book as and when suits you', 'Pick-up from home, college or work', 'Feedback after every lesson']},
    {id: 'block10', name: 'Block of 10 lessons', length: '10 hours', price: '£380', badge: 'Most popular', points: ['Save £20 compared with single lessons', 'Priority booking slots', 'Theory test guidance', 'Online progress tracker']},
    {id: 'intensive', name: 'Intensive course', length: '20 hours', price: '£760', points: ['Lessons on consecutive days where available', 'Mock test included', 'Help with booking your test', 'Suitable for all levels']},
    {id: 'testday', name: 'Test day package', length: '1 hour + car for your test', price: '£130', points: ['One-hour lesson before your test', 'Use of the car for the test', 'Local test route practice']}
  ],
  lesson_types: [
    ['Beginner lessons', 'Start from scratch with calm, structured teaching: controls, moving off, junctions and manoeuvres at your pace.'],
    ['Refresher lessons', 'Been off the road for a while? Rebuild confidence with sessions focused on what you want to work on.'],
    ['Pass Plus', 'Extra training for newly qualified drivers, including faster roads, night driving and rural roads.'],
    ['Theory test support', 'Guidance on hazard perception and the multiple-choice questions alongside your practical lessons.'],
    ['Mock tests', 'A full mock driving test on local roads so you know what to expect on the day.'],
    ['Automatic lessons', 'All lessons are in an automatic car — often a good choice for nervous or returning learners.']
  ],
  experience_options: ['Complete beginner', 'I have had some lessons', 'My test is booked', 'I have passed (refresher or Pass Plus)'],
  // CONFIRM before showing any figures such as learners passed or pass rates. Leave empty unless you can evidence them.
  stats: [],
  faq: [
    ['Do you teach in manual cars?', 'No — SRK Driving School teaches in an automatic car. An automatic licence lets you drive automatic cars only.'],
    ['Where can you pick me up?', 'From home, college or work in the areas we cover. Tell us your area when you enquire and we will confirm.'],
    ['How do I track my progress?', 'Once you are a learner, sign in with Google to see your upcoming lessons and the progress reports your instructor shares after lessons.'],
    ['Can I cancel or move a lesson?', 'Yes. Your instructor\'s cancellation terms are shown before you confirm any booking. Please give as much notice as you can.']
  ]
};
