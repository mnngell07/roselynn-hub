export const areas = {all: 'All', personal: 'Personal', teaching: 'Teaching', dev_ai: 'Dev & AI'};
export const zone = 'Asia/Kuala_Lumpur';
const localFormat = new Intl.DateTimeFormat('sv-SE', {
  timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
const displayFormat = new Intl.DateTimeFormat('en-MY', {
  timeZone: zone, dateStyle: 'medium', timeStyle: 'short'
});
export const localDateTime = (value = new Date()) => localFormat.format(new Date(value)).replace(' ', 'T');
export const today = () => localDateTime().slice(0, 10);
export const dateKey = date => date.toISOString().slice(0, 10);
export const atDate = day => new Date(day + 'T00:00:00Z');
export function shiftDay(day, delta) {
  const date = atDate(day);
  date.setUTCDate(date.getUTCDate() + delta);
  return dateKey(date);
}
export const monday = day => shiftDay(day, -((atDate(day).getUTCDay() + 6) % 7));
export const malaysiaTimestamp = value => value ? new Date(value + '+08:00').toISOString() : null;
export const formatTime = value => value ? displayFormat.format(new Date(value)) : '';
export const formatDay = day => day ? atDate(day).toLocaleDateString('en-MY', {
  timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric'
}) : '';
export const myr = amount => new Intl.NumberFormat('en-MY', {style:'currency', currency:'MYR'}).format(amount);
export const taskStatus = {todo:'To do', in_progress:'In progress', completed:'Completed'};
export const replacementStatus = {needs_rescheduling:'Needs rescheduling', scheduled:'Scheduled', completed:'Completed'};
export const radarStatus = {to_explore:'To explore', trying_out:'Trying out', applied:'Applied'};
export const weekdays = {1:'Monday',2:'Tuesday',3:'Wednesday',4:'Thursday',5:'Friday',6:'Saturday',7:'Sunday'};
export const habitCadences = {daily:'Daily',weekly:'Weekly'};
export const habitCategories = ['Morning & Body','Space & Chores','Mind & Self-Care'];

const field = (key, label, type = 'text', extra = {}) => ({key,label,type,...extra});
const required = (key, label, type, extra) => field(key,label,type,{...extra,required:true});
const select = (key,label,options,value) => required(key,label,'select',{options,value});
const ref = (key,label,table,title,mandatory = false) => field(key,label,'select',{table,title,required:mandatory});
const date = (key,label,value = today) => required(key,label,'date',{value});
const area = select('area','Area',Object.fromEntries(Object.entries(areas).slice(1)),() => 'personal');
const upcoming = (day,hour) => (day || today()) + 'T' + hour;

export const features = {
  tasks: {
    title:'Tasks & reminders', singular:'task', icon:'✓', empty:'Add a task or reminder to get started.',
    fields:[required('title','Task'),area,select('priority','Priority',{0:'No stars',1:'★',2:'★★',3:'★★★'},0),
      select('status','Status',taskStatus,'todo'),field('due_at','Due in Malaysia time','datetime-local'),
      field('remind_at','Remind in Malaysia time','datetime-local'),field('notes','Notes','textarea')],
    label:r=>r.title, details:r=>[r.due_at && 'Due ' + formatTime(r.due_at),r.remind_at && 'Reminder ' + formatTime(r.remind_at),r.notes],
    prepare:(record,row)=>({...record,completed_at:record.status==='completed' ? row?.completed_at || new Date().toISOString() : null})
  },
  brain_dump: {
    title:'Brain dump', singular:'capture', icon:'✎', empty:'Your quick captures will appear here.',
    fields:[required('content','Capture','textarea')],
    label:r=>r.content, details:r=>[r.processed_at && 'Processed ' + formatTime(r.processed_at)]
  },
  calendar_events: {
    title:'Calendar', singular:'event', icon:'▦', empty:'Nothing scheduled for this day.',
    fields:[required('title','Event'),area,
      required('starts_at','Starts in Malaysia time','datetime-local',{value:ctx=>upcoming(ctx.day,'09:00')}),
      required('ends_at','Ends in Malaysia time','datetime-local',{value:ctx=>upcoming(ctx.day,'10:00')}),
      field('notes','Notes','textarea')],
    label:r=>r.title,details:r=>[formatTime(r.starts_at) + ' – ' + formatTime(r.ends_at),r.notes]
  },
  expenses: {
    title:'Expenses', singular:'expense', icon:'◈', empty:'No expenses logged this month.',
    fields:[required('amount_myr','Amount (MYR)','number',{min:.01,step:.01}),required('category','Category'),
      date('expense_date','Date'),field('note','Note','textarea')],
    label:r=>myr(r.amount_myr) + ' · ' + r.category,details:r=>[formatDay(r.expense_date),r.note]
  },
  weight_logs: {
    title:'Weight trend', singular:'weight', icon:'∿', empty:'Log a weight to start your trend.',
    fields:[date('log_date','Date'),required('weight_kg','Weight (kg)','number',{min:.01,step:.01}),field('note','Note','textarea')],
    label:r=>r.weight_kg + ' kg',details:r=>[formatDay(r.log_date),r.note], conflict:'log_date'
  },
  habits: {
    title:'Habit & Routine Builder', singular:'habit', icon:'♡',
    fields:[required('name','Habit name','text',{maxLength:120}),
      select('cadence','Frequency',habitCadences,'daily'),
      required('category','Category','text',{maxLength:80,value:habitCategories[0],suggestions:habitCategories})]
  },
  wellness_milestones: {
    title:'Milestone rewards', singular:'milestone', icon:'◇', empty:'Choose a goal and a reward to look forward to.',
    fields:[required('goal','Milestone'),required('reward','Reward'),field('target_date','Target date','date'),
      field('achieved_at','Achieved at','datetime-local'),field('rewarded_at','Reward claimed at','datetime-local')],
    label:r=>r.goal,details:r=>[r.reward,r.target_date && 'Target ' + formatDay(r.target_date),
      r.rewarded_at ? 'Reward claimed' : r.achieved_at && 'Milestone achieved']
  },
  language_study: {
    title:'Language learning', singular:'study session', icon:'文', empty:'Log your first 10 minutes of practice.',
    fields:[date('study_date','Study date'),required('language','Language'),
      required('minutes','Total minutes for this language that day','number',{min:1,max:1440,value:10})],
    label:r=>r.language + ' · ' + r.minutes + ' min',details:r=>[formatDay(r.study_date)],conflict:'study_date,language'
  },
  vocabulary: {
    title:'Phrase & word vault', singular:'word or phrase', icon:'Aa', empty:'Save a word or phrase you want to remember.',
    fields:[required('language','Language'),required('phrase','Word or phrase'),field('meaning','Meaning'),field('example','Example','textarea')],
    label:r=>r.phrase,details:r=>[r.language,r.meaning,r.example]
  },
  students: {
    title:'Student roster', singular:'student', icon:'♧', empty:'Add a student to start their lesson history.',
    fields:[required('name','Student name'),field('subject','Subject'),field('level','Level')],
    label:r=>r.name,details:r=>[[r.subject,r.level].filter(Boolean).join(' · ')]
  },
  student_lesson_notes: {
    title:'Lesson notes', singular:'lesson note', icon:'✎', empty:'No lesson notes yet.',
    fields:[ref('student_id','Student','students','name',true),date('lesson_date','Lesson date'),
      field('covered_today','Covered today','textarea'),field('revise_next_class','Revise next class','textarea')],
    label:(r,get)=>get('students',r.student_id)?.name || 'Student',
    details:r=>[formatDay(r.lesson_date),r.covered_today && 'Covered: ' + r.covered_today,r.revise_next_class && 'Revise: ' + r.revise_next_class]
  },
  teaching_classes: {
    title:'Weekly timetable', singular:'regular class', icon:'▦', empty:'Add a recurring class to your timetable.',
    fields:[required('title','Class title'),ref('student_id','Student','students','name'),
      select('weekday','Weekday',weekdays,1),required('start_time','Starts in Malaysia time','time'),
      required('end_time','Ends in Malaysia time','time'),field('active_from','First active date','date'),
      field('active_until','Last active date','date'),field('notes','Notes','textarea')],
    label:r=>r.title,details:(r,get)=>[weekdays[r.weekday] + ' · ' + r.start_time.slice(0,5) + '–' + r.end_time.slice(0,5),
      get('students',r.student_id)?.name,r.active_from && 'From ' + formatDay(r.active_from),
      r.active_until && 'Until ' + formatDay(r.active_until),r.notes]
  },
  replacement_classes: {
    title:'Replacement manager', singular:'replacement', icon:'!', empty:'No missed classes to reschedule.',
    fields:[ref('student_id','Link to roster','students','name'),required('student_name','Student name'),
      ref('regular_class_id','Regular class','teaching_classes','title'),date('missed_date','Missed date'),
      field('reason','Reason','textarea'),select('status','Status',replacementStatus,'needs_rescheduling'),
      field('scheduled_start_at','Replacement starts in Malaysia time','datetime-local'),
      field('scheduled_end_at','Replacement ends in Malaysia time','datetime-local')],
    label:r=>r.student_name,details:r=>['Missed ' + formatDay(r.missed_date),r.reason,r.scheduled_start_at &&
      formatTime(r.scheduled_start_at) + ' – ' + formatTime(r.scheduled_end_at)]
  },
  pre_class_checklist_items: {
    title:'Pre-class checklist', singular:'checklist item', icon:'✓', empty:'Add reusable items to your checklist.',
    fields:[required('label','Checklist item'),required('sort_order','Sort order','number',{min:0,value:0})],
    label:r=>r.label,details:()=>[]
  },
  dev_workspace: {
    title:'Parking lot', singular:'parking lot note', icon:'✎', empty:'Save your coding context before switching tasks.',
    fields:[field('parking_lot_note','Coding context or next step','textarea')],
    label:r=>r.parking_lot_note,details:()=>[],conflict:'singleton'
  },
  dev_daily_wins: {
    title:'Daily win log', singular:'win', icon:'✦', empty:'Write down a small win from today.',
    fields:[date('win_date','Date'),required('win','What went well?','textarea')],
    label:r=>r.win,details:r=>[formatDay(r.win_date)]
  },
  learning_radar: {
    title:'Tech & AI upskilling radar', singular:'resource', icon:'◉', empty:'Save a resource to explore when you have time.',
    fields:[required('title','Resource'),field('url','Link','url'),
      select('resource_type','Type',{tool:'AI tool',article:'Article',framework:'Framework',other:'Other'},'other'),
      select('status','Status',radarStatus,'to_explore'),field('notes','Notes','textarea')],
    label:r=>r.title,details:r=>[r.resource_type,r.notes]
  },
  weekly_experiments: {
    title:'Weekly experiment', singular:'experiment', icon:'✧', empty:'Pick one small thing to try this week.',
    fields:[date('week_start','Week of (Monday)',()=>monday(today())),required('title','Experiment'),
      ref('radar_item_id','Link to radar','learning_radar','title'),field('outcome','Outcome','textarea'),
      field('completed_at','Completed at','datetime-local')],
    label:r=>r.title,details:r=>['Week of ' + formatDay(r.week_start),r.outcome,r.completed_at && 'Completed']
  }
};
