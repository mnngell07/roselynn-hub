import {SUPABASE_URL, SUPABASE_ANON_KEY} from './config.js';
import {
  areas, features, weekdays, taskStatus, replacementStatus, radarStatus, zone, habitCadences,
  today, atDate, dateKey, shiftDay, monday, localDateTime, malaysiaTimestamp, formatDay, myr
} from './features.js';

const $ = selector => document.querySelector(selector);
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}
function button(text, action, style = 'quiet') {
  const node = element('button', style, text);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}
function group(className, ...nodes) {
  const node = element('div', className);
  node.append(...nodes);
  return node;
}

const tables = [...Object.keys(features), 'daily_focus', 'habit_checkoffs', 'pre_class_checklist_checks'];
const db = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const state = {
  user: null, generation: 0, area: 'all', data: {}, loaded: false, pending: null, writing: false,
  day: today(), calendarDay: today(), calendarMode: 'month', lesson: '', roster: '',
  syncedAt: null, error: ''
};
let chart;
let editor;
let timerLabel;
let captureDraft = '';
const records = table => state.data[table] || [];
const get = (table, id) => records(table).find(row => row.id === id);
const newest = rows => [...rows].sort((a,b) => b.created_at.localeCompare(a.created_at));
const descending = (rows, key) => [...rows].sort((a,b) => b[key].localeCompare(a[key]));
const active = table => newest(records(table)).filter(row => !row.archived_at);
const areaRows = table => records(table).filter(row => state.area === 'all' || state.area === row.area);
const errorMessage = error => error?.message || 'Something interrupted the request. Try again.';

const quotes = [
  'Small steps still move you forward.', 'Make room for the work and the rest.',
  'A little progress is enough for today.', 'Begin with the next thing you can do.',
  'You can learn slowly and still learn well.', 'Give yourself the patience you offer other people.',
  'One finished thing is worth noticing.', 'A pause can help you begin again.'
];
function renderDate() {
  $('#today-label').textContent = new Intl.DateTimeFormat('en-MY', {
    timeZone: zone, weekday:'long', day:'numeric', month:'long'
  }).format(new Date());
  const dayIndex = Math.floor(atDate(today()).getTime() / 86400000);
  $('#quote').textContent = '“' + quotes[dayIndex % quotes.length] + '”';
}

function renderStatus() {
  const status = $('#status');
  if (state.error) status.textContent = state.error;
  else if (!state.loaded) status.textContent = 'Loading your dashboard…';
  else if (state.writing) status.textContent = 'Saving…';
  else if (state.syncedAt) {
    status.textContent = 'Synced at ' + new Intl.DateTimeFormat('en-MY', {
      timeZone: zone, hour:'numeric',minute:'2-digit'
    }).format(state.syncedAt) + ' MYT';
  }
  $('#refresh').disabled = !!state.pending || !state.user;
  document.querySelectorAll('.habit-check').forEach(control => { control.disabled = state.writing; });
}

async function readTable(table) {
  const rows = [];
  const pageSize = 500;
  let cursor;
  for (;;) {
    let query = db.from(table).select('*').order('id').limit(pageSize);
    if (cursor) query = query.gt('id', cursor);
    const {data, error} = await query;
    if (error) {
      const habitTable = table === 'habits' || table === 'habit_checkoffs';
      if (habitTable && ['PGRST205','42P01'].includes(error.code)) return null;
      throw new Error(table + ': ' + error.message);
    }
    rows.push(...data);
    if (data.length === 0) return rows;
    cursor = data.at(-1).id;
  }
}
function sync() {
  if (!state.user || state.writing && state.pending) return state.pending;
  if (state.pending) return state.pending;
  const generation = state.generation;
  state.pending = (async () => {
    try {
      const data = Object.fromEntries(await Promise.all(tables.map(async table => [table, await readTable(table)])));
      if (generation !== state.generation) return;
      const changed = !state.loaded || JSON.stringify(data) !== JSON.stringify(state.data);
      state.data = data;
      state.loaded = true;
      state.syncedAt = new Date();
      state.error = '';
      if (changed) render();
    } catch (error) {
      if (generation !== state.generation) return;
      state.error = 'Sync failed. ' + errorMessage(error);
    } finally {
      if (generation === state.generation) {
        state.pending = null;
        renderStatus();
      }
    }
  })();
  renderStatus();
  return state.pending;
}

async function mutate({table, row, values, remove = false, conflict}) {
  if (!state.user || state.writing) return false;
  const generation = state.generation;
  state.writing = true;
  state.error = '';
  renderStatus();
  try {
    await state.pending;
    if (generation !== state.generation) return false;
    const target = db.from(table);
    let request;
    if (remove) request = target.delete().eq('id', row.id);
    else if (row) request = target.update(values).eq('id', row.id);
    else if (conflict) request = target.upsert(values, {onConflict:conflict});
    else request = target.insert(values);
    const {error} = await request.select('id').single();
    if (error) throw error;
    if (generation !== state.generation) return false;
    await sync();
    return generation === state.generation;
  } catch (error) {
    if (generation !== state.generation) return false;
    state.error = 'Save failed. ' + errorMessage(error);
    if ($('#editor').open) $('#edit-status').textContent = state.error;
    return false;
  } finally {
    if (generation === state.generation) {
      state.writing = false;
      renderStatus();
    }
  }
}
function removeRow(table,row) {
  if (window.confirm('Delete this entry?')) void mutate({table,row,remove:true});
}

function sessionChanged(user) {
  if (state.user?.id === user?.id && state.generation) return;
  state.generation++;
  state.user = user;
  state.loaded = false;
  state.data = {};
  state.pending = null;
  state.writing = false;
  state.error = '';
  state.syncedAt = null;
  state.area = 'all';
  state.roster = '';
  state.lesson = '';
  captureDraft = '';
  if ($('#editor').open) $('#editor').close();
  $('#login').hidden = !!user;
  $('#dashboard').hidden = !user;
  $('#account').hidden = !user;
  render();
  if (user) void sync();
}
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!db) return;
  const form = event.currentTarget;
  const submit = form.querySelector('button');
  const data = new FormData(form);
  const output = $('#login-status');
  submit.disabled = true;
  output.textContent = 'Signing in…';
  try {
    const {error} = await db.auth.signInWithPassword({
      email: data.get('email').trim(), password: data.get('password')
    });
    if (error) throw error;
    output.textContent = '';
  } catch (error) {
    output.textContent = errorMessage(error);
  } finally {
    form.elements.password.value = '';
    submit.disabled = false;
  }
});
$('#logout').addEventListener('click', async () => {
  $('#logout').disabled = true;
  try {
    const {error} = await db.auth.signOut({scope:'local'});
    if (error) throw error;
    sessionChanged(null);
  } catch (error) {
    state.error = 'Sign-out failed. ' + errorMessage(error);
    renderStatus();
  } finally {
    $('#logout').disabled = false;
  }
});
$('#refresh').addEventListener('click', sync);

function fieldInput(field, row, context) {
  const label = element('label', '', field.label);
  let current = row?.[field.key];
  if (!row) current = field.key in (context.defaults || {}) ? context.defaults[field.key] :
    typeof field.value === 'function' ? field.value(context) : field.value;
  let input;
  if (field.type === 'select') {
    input = element('select');
    let options = field.options;
    if (field.table) {
      options = Object.fromEntries(records(field.table)
        .filter(item => !item.archived_at || item.id === current)
        .map(item => [item.id, item[field.title]]));
      const placeholder = element('option', '', field.required ? 'Choose one' : 'None');
      placeholder.value = '';
      input.append(placeholder);
    }
    for (const [value,text] of Object.entries(options)) {
      const option = element('option','',text);
      option.value = value;
      input.append(option);
    }
  } else {
    input = element(field.type === 'textarea' ? 'textarea' : 'input');
    if (field.type !== 'textarea') input.type = field.type;
    if (field.min !== undefined) input.min = field.min;
    if (field.max !== undefined) input.max = field.max;
    if (field.step !== undefined) input.step = field.step;
    if (field.maxLength !== undefined) input.maxLength = field.maxLength;
  }
  input.name = field.key;
  input.required = !!field.required;
  if (current !== undefined && current !== null) {
    input.value = field.type === 'datetime-local' && row ? localDateTime(current) :
      field.type === 'time' ? String(current).slice(0,5) : current;
  }
  label.append(input);
  if (field.suggestions) {
    const list = element('datalist');
    list.id = 'edit-options-' + field.key;
    input.setAttribute('list',list.id);
    for (const value of new Set([...field.suggestions,...records('habits').map(habit=>habit.category)])) {
      const option = element('option');
      option.value = value;
      list.append(option);
    }
    label.append(list);
  }
  return label;
}
function openEditor(table,row,context = {}) {
  const feature = features[table];
  context = {...context,defaults:{...context.defaults}};
  if (feature.fields.some(field => field.key === 'area')) {
    context.defaults.area ??= state.area === 'all' ? 'personal' : state.area;
  }
  editor = {table,row,feature};
  $('#edit-title').textContent = (row ? 'Edit ' : 'Add ') + feature.singular;
  $('#edit-status').textContent = '';
  $('#fields').replaceChildren(...feature.fields.map(field => fieldInput(field,row,context)));
  if (feature.conflict && !row && table !== 'dev_workspace') {
    $('#fields').append(element('p','dialog-tip','Saving the same date' +
      (table === 'language_study' ? ' and language' : '') + ' updates that entry.'));
  }
  if (table === 'replacement_classes') {
    const form = $('#edit-form');
    form.elements.student_id.addEventListener('change', () => {
      const student = get('students',form.elements.student_id.value);
      if (student) form.elements.student_name.value = student.name;
    });
  }
  $('#editor').showModal();
}
$('#cancel-edit').addEventListener('click', () => $('#editor').close());
$('#editor').addEventListener('close', () => { editor = null; });
$('#edit-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!editor || state.writing) return;
  const {table,row,feature} = editor;
  const form = event.currentTarget;
  const submit = form.querySelector('[type=submit]');
  const formData = new FormData(form);
  try {
    const values = Object.fromEntries(feature.fields.map(field => {
      const raw = formData.get(field.key).trim();
      if (!raw && field.required) throw new Error('Enter ' + field.label.toLowerCase() + '.');
      if (field.type === 'datetime-local') return [field.key,malaysiaTimestamp(raw)];
      if (field.type === 'number') return [field.key,Number(raw)];
      if (field.type === 'date' || field.type === 'select' || field.type === 'url') return [field.key,raw || null];
      return [field.key,raw];
    }));
    if (table === 'calendar_events' && values.ends_at <= values.starts_at) throw new Error('Choose an end time after the start.');
    if (table === 'teaching_classes' && values.end_time <= values.start_time) throw new Error('Choose an end time after the start.');
    if (table === 'weekly_experiments' && monday(values.week_start) !== values.week_start) throw new Error('Pick a Monday for the week.');
    if (table === 'replacement_classes') {
      const start = values.scheduled_start_at;
      const end = values.scheduled_end_at;
      if (Boolean(start) !== Boolean(end) || start && end <= start || values.status === 'scheduled' && !start) {
        throw new Error('Enter both replacement times in order when scheduling.');
      }
    }
    submit.disabled = true;
    $('#edit-status').textContent = 'Saving…';
    const saved = await mutate({
      table,row,values:feature.prepare ? feature.prepare(values,row) : values,conflict:feature.conflict
    });
    if (saved && $('#editor').open) $('#editor').close();
    else if ($('#editor').open) $('#edit-status').textContent = state.error || 'Save interrupted. Try again.';
  } catch (error) {
    $('#edit-status').textContent = errorMessage(error);
  } finally {
    submit.disabled = false;
  }
});

function badge(text, style = '') {
  return element('span','tag ' + style,text);
}
function heading(title, icon, style, action) {
  const identity = group('inline',element('span','icon ' + style,icon),element('h3','',title));
  identity.firstChild.setAttribute('aria-hidden','true');
  const head = group('card-heading',identity);
  if (action) head.append(action);
  return head;
}
function card(title,icon,style = '',action) {
  const section = element('section','card');
  section.append(heading(title,icon,style,action));
  return section;
}
function addButton(table, context) {
  const node = button('+ Add', () => openEditor(table,null,context),'primary');
  node.setAttribute('aria-label','Add ' + features[table].singular);
  return node;
}
function taskToggle(row) {
  const complete = row.status !== 'completed';
  return button(complete ? 'Done' : 'Reopen', () => mutate({table:'tasks',row,values:{
    status:complete ? 'completed' : 'todo', completed_at:complete ? new Date().toISOString() : null
  }}));
}
function paintTaskReminder(tag) {
  const urgent = tag.dataset.trigger && Date.parse(tag.dataset.trigger) <= Date.now();
  tag.classList.toggle('alert',Boolean(urgent));
  tag.textContent = urgent ? 'Due now' : tag.dataset.status;
}
function rowView(table,row,{tools = [], deleteEntry = true} = {}) {
  const feature = features[table];
  const content = group('',element('strong','',feature.label(row,get)));
  if (row.area) content.append(badge(areas[row.area],row.area));
  if (table === 'tasks') {
    const status = badge(taskStatus[row.status],row.status === 'completed' ? 'done' : '');
    if (row.status !== 'completed') {
      const times = [row.remind_at,row.due_at].filter(Boolean).map(value=>Date.parse(value));
      if (times.length) {
        status.dataset.trigger = new Date(Math.min(...times)).toISOString();
        status.dataset.status = taskStatus[row.status];
        paintTaskReminder(status);
      }
    }
    content.append(status);
    if (row.priority) {
      const stars = badge('★'.repeat(row.priority));
      stars.setAttribute('aria-label',row.priority + ' priority stars');
      content.append(stars);
    }
    tools = [taskToggle(row),...tools];
  }
  if (table === 'replacement_classes') content.append(badge(replacementStatus[row.status],
    row.status === 'needs_rescheduling' ? 'alert' : row.status === 'completed' ? 'done' : ''));
  if (table === 'learning_radar') {
    content.append(badge(radarStatus[row.status],row.status === 'applied' ? 'done' : ''));
    if (row.url && /^https?:\/\//i.test(row.url)) {
      const anchor = element('a','tag','Open resource');
      anchor.href = row.url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      content.append(anchor);
    }
  }
  for (const detail of feature.details(row,get).filter(Boolean)) content.append(element('p','meta',detail));
  const edit = button('Edit',()=>openEditor(table,row));
  edit.setAttribute('aria-label','Edit ' + feature.label(row,get));
  const controls = group('controls',...tools,edit);
  if (deleteEntry) {
    const remove = button('Delete',()=>removeRow(table,row),'quiet danger');
    remove.setAttribute('aria-label','Delete ' + feature.label(row,get));
    controls.append(remove);
  }
  return group('row' + (row.status === 'completed' && table === 'tasks' ? ' completed' : ''),content,controls);
}
function addRows(section,table,rows,options) {
  if (!rows.length) section.append(element('p','empty',features[table].empty));
  else for (const row of rows) section.append(rowView(table,row,options?.(row)));
}
function listCard(table,rows = newest(records(table)),style = '',context,options) {
  const {title,icon} = features[table];
  const section = card(title,icon,style,addButton(table,context));
  addRows(section,table,rows,options);
  return section;
}

function renderPinned() {
  const focus = $('#focus');
  focus.replaceChildren(heading('Top 3 today','✦','rose'));
  const daily = records('daily_focus').filter(row => row.focus_date === today());
  for (let slot = 1; slot <= 3; slot++) {
    const pin = daily.find(row => row.slot === slot);
    const selected = get('tasks',pin?.task_id);
    const label = element('label','','Focus ' + slot);
    const select = element('select');
    const placeholder = element('option','','Choose a task');
    placeholder.value = '';
    select.append(placeholder);
    const assigned = new Set(daily.filter(row => row.slot !== slot).map(row => row.task_id));
    for (const task of newest(records('tasks'))) {
      if (assigned.has(task.id) || task.status === 'completed' && task.id !== selected?.id) continue;
      const option = element('option','',(task.status === 'completed' ? '✓ ' : '') + task.title);
      option.value = task.id;
      select.append(option);
    }
    select.value = selected?.id || '';
    select.addEventListener('change',async () => {
      select.disabled = true;
      const saved = await mutate({
        table:'daily_focus',row:pin,remove:!select.value && !!pin,
        values:{focus_date:today(),slot,task_id:select.value}
      });
      if (!saved) select.value = selected?.id || '';
      select.disabled = false;
    });
    label.append(select);
    const line = group('row',label);
    label.style.flex = '1';
    if (selected) line.append(taskToggle(selected));
    focus.append(line);
  }

  const capture = $('#capture');
  const captureForm = element('form','capture-box');
  const input = element('textarea');
  input.setAttribute('aria-label','Brain dump');
  input.placeholder = 'What’s on your mind?';
  input.required = true;
  input.value = captureDraft;
  input.addEventListener('input',() => { captureDraft = input.value; });
  const captureButton = element('button','primary','Save thought');
  captureButton.type = 'submit';
  captureForm.append(input,captureButton);
  captureForm.addEventListener('submit', async event => {
    event.preventDefault();
    const content = input.value.trim();
    if (!content || state.writing) return;
    const draft = input.value;
    captureButton.disabled = true;
    if (await mutate({table:'brain_dump',values:{content}})) {
      if (captureDraft === draft) captureDraft = '';
      renderPinned();
    }
    captureButton.disabled = false;
  });
  capture.replaceChildren(heading('Brain dump','✎','rose'),captureForm);
  const captures = newest(records('brain_dump'));
  if (captures.length) {
    const details = element('details');
    details.open = state.capturesOpen || false;
    details.addEventListener('toggle',() => { if (details.isConnected) state.capturesOpen = details.open; });
    const pending = captures.filter(row=>!row.processed_at).length;
    details.append(element('summary','muted',pending + ' unprocessed · ' + captures.length + ' saved'));
    addRows(details,'brain_dump',captures,row=>({
      tools:[button(row.processed_at ? 'Restore' : 'Mark processed',() => mutate({
        table:'brain_dump',row,values:{processed_at:row.processed_at ? null : new Date().toISOString()}
      }))]
    }));
    capture.append(details);
  }
}

function section(title, ...cards) {
  const block = element('section');
  block.append(element('h2','section-title',title),group('cards',...cards));
  return block;
}
function calendarCard() {
  const selected = state.calendarDay;
  const isWeek = state.calendarMode === 'week';
  const month = selected.slice(0,7);
  const monthStart = month + '-01';
  const monthDate = atDate(monthStart);
  const weekStart = monday(selected);
  const nextMonth = new Date(Date.UTC(monthDate.getUTCFullYear(),monthDate.getUTCMonth()+1,1));
  const weekCount = Math.ceil((atDate(dateKey(nextMonth)) - atDate(monday(monthStart))) / (7 * 86400000));
  const first = isWeek ? weekStart : monday(monthStart);
  const events = [...areaRows('calendar_events')].sort((a,b)=>a.starts_at.localeCompare(b.starts_at));
  const eventsByDay = day => events.filter(event => localDateTime(event.starts_at).slice(0,10) <= day &&
    localDateTime(Date.parse(event.ends_at) - 1).slice(0,10) >= day);
  const cardNode = card('Calendar','▦','',addButton('calendar_events',{day:selected}));
  cardNode.classList.add('wide');
  const navigate = delta => {
    state.calendarDay = isWeek ? shiftDay(selected,delta * 7) :
      dateKey(new Date(Date.UTC(monthDate.getUTCFullYear(),monthDate.getUTCMonth()+delta,1)));
    render();
  };
  const modes = group('tabs');
  for (const mode of ['month','week']) {
    const control = button(mode === 'month' ? 'Month' : 'Week',() => {
      state.calendarMode = mode;
      render();
    });
    control.setAttribute('aria-pressed',String(mode === state.calendarMode));
    modes.append(control);
  }
  cardNode.append(group('calendar-head',
    group('controls',button('Previous',()=>navigate(-1)),element('strong','',isWeek ?
      formatDay(weekStart) + ' – ' + formatDay(shiftDay(weekStart,6)) :
      monthDate.toLocaleDateString('en-MY',{timeZone:'UTC',month:'long',year:'numeric'})),
    button('Next',()=>navigate(1))),
    group('controls',button('Today',()=>{state.calendarDay = today();render();}),modes)));
  const grid = group('calendar-grid');
  for (const weekday of Object.values(weekdays)) grid.append(element('span','weekday',weekday.slice(0,3)));
  for (let index = 0; index < (isWeek ? 7 : weekCount * 7); index++) {
    const day = shiftDay(first,index);
    const count = eventsByDay(day).length;
    const control = button(String(Number(day.slice(-2))),() => {
      state.calendarDay = day;
      render();
      $('#sections').querySelector('[data-calendar-day="' + day + '"]')?.focus();
    },'day' + (day === today() ? ' today' : '') + (day.slice(0,7) !== month ? ' out' : ''));
    control.dataset.calendarDay = day;
    control.setAttribute('aria-pressed',String(day === selected));
    control.setAttribute('aria-label',formatDay(day) + ', ' + count + ' events');
    if (count) control.append(element('small','',count + (count === 1 ? ' event' : ' events')));
    grid.append(control);
  }
  const agenda = group('day-list',element('strong','',formatDay(selected)));
  addRows(agenda,'calendar_events',eventsByDay(selected));
  cardNode.append(grid,agenda);
  return cardNode;
}

function habitRow(habit, period, checked) {
  const control = element('input');
  control.type = 'checkbox';
  control.className = 'habit-check';
  control.id = 'habit-check-' + habit.id;
  control.checked = checked;
  control.disabled = state.writing;
  control.addEventListener('change',async () => {
    const focused = document.activeElement === control;
    const saved = await mutate({
      table:'habit_checkoffs',
      values:{habit_id:habit.id,cadence:habit.cadence,period_start:period,checked:control.checked},
      conflict:'habit_id,cadence,period_start'
    });
    if (!saved) control.checked = checked;
    if (focused && document.activeElement === document.body) document.getElementById(control.id)?.focus();
  });
  const text = element('label','check');
  text.append(control,element('span','',habit.name));
  const edit = button('Edit',()=>openEditor('habits',habit));
  edit.setAttribute('aria-label','Edit ' + habit.name);
  const remove = button('Delete',()=>{
    if (window.confirm('Delete this habit and its check-off history?')) {
      void mutate({table:'habits',row:habit,remove:true});
    }
  },'quiet danger');
  remove.setAttribute('aria-label','Delete ' + habit.name);
  return group('row habit-row',text,group('controls',edit,remove));
}

function habitPeriod(cadence, period, title, subtitle) {
  const habits = records('habits').filter(habit=>habit.cadence === cadence)
    .sort((a,b)=>a.created_at.localeCompare(b.created_at) || a.name.localeCompare(b.name));
  const checked = new Set(records('habit_checkoffs').filter(row=>
    row.cadence === cadence && row.period_start === period && row.checked).map(row=>row.habit_id));
  const count = habits.filter(habit=>checked.has(habit.id)).length;
  const block = element('section','habit-period');
  const progress = element('progress','habit-progress');
  progress.max = habits.length || 1;
  progress.value = count;
  progress.setAttribute('aria-label',title + ' habits completed');
  progress.setAttribute('aria-valuetext',count + ' of ' + habits.length + ' complete');
  block.append(group('habit-period-heading',element('h4','',title),
    element('span','habit-count',count + ' of ' + habits.length + ' complete')),
    element('p','muted',subtitle),progress);
  if (!habits.length) block.append(element('p','empty','No ' + habitCadences[cadence].toLowerCase() + ' habits yet.'));
  const categories = new Map();
  for (const habit of habits) {
    if (!categories.has(habit.category)) categories.set(habit.category,[]);
    categories.get(habit.category).push(habit);
  }
  for (const [category,items] of categories) {
    block.append(element('h5','habit-category',category),
      ...items.map(habit=>habitRow(habit,period,checked.has(habit.id))));
  }
  return block;
}
function habitCard() {
  const day = today();
  const week = monday(day);
  const {title,icon} = features.habits;
  if (state.data.habits === null || state.data.habit_checkoffs === null) {
    const setupCard = card(title,icon,'rose');
    setupCard.classList.add('wide');
    setupCard.append(element('p','muted','Run the Habit & Routine Builder migration in Supabase, then tap Sync now.'));
    return setupCard;
  }
  const node = card(title,icon,'rose',addButton('habits'));
  node.classList.add('wide');
  node.append(group('habit-periods',
    habitPeriod('daily',day,'Today',formatDay(day)),
    habitPeriod('weekly',week,'This week',formatDay(week) + ' – ' + formatDay(shiftDay(week,6)))));
  return node;
}
function languageCard() {
  const rows = descending(records('language_study'),'study_date');
  const totals = new Map();
  for (const row of rows) totals.set(row.study_date,(totals.get(row.study_date) || 0) + row.minutes);
  let cursor = today();
  if ((totals.get(cursor) || 0) < 10) cursor = shiftDay(cursor,-1);
  let streak = 0;
  while ((totals.get(cursor) || 0) >= 10) {
    streak++;
    cursor = shiftDay(cursor,-1);
  }
  const node = card('Language learning','文','rose',addButton('language_study'));
  node.append(element('p','metric',streak + (streak === 1 ? ' day' : ' days')),
    element('p','muted',(totals.get(today()) || 0) + ' / 10 min today'));
  addRows(node,'language_study',rows);
  return node;
}
function personalSection() {
  const month = today().slice(0,7);
  const expenses = descending(records('expenses'),'expense_date').filter(row=>row.expense_date.startsWith(month));
  const expenseCard = card('Expenses','◈','rose',addButton('expenses'));
  // Sum integer sen so repeated decimal amounts don’t accumulate rounding errors.
  const total = expenses.reduce((sum,row)=>sum + Math.round(Number(row.amount_myr) * 100),0);
  expenseCard.append(element('p','metric',myr(total / 100)),element('p','muted',
    atDate(month + '-01').toLocaleDateString('en-MY',{timeZone:'UTC',month:'long',year:'numeric'})));
  addRows(expenseCard,'expenses',expenses);
  const weights = descending(records('weight_logs'),'log_date');
  const weightCard = card('Weight trend','∿','rose',addButton('weight_logs'));
  if (weights.length && window.Chart) {
    const canvas = element('canvas');
    canvas.id = 'weight-chart';
    canvas.setAttribute('aria-label','Weight trend in kilograms. Individual entries are listed below.');
    canvas.setAttribute('role','img');
    weightCard.append(group('chart',canvas));
  }
  addRows(weightCard,'weight_logs',weights);
  return section('Personal',habitCard(),expenseCard,weightCard,listCard('wellness_milestones'),
    languageCard(),listCard('vocabulary'));
}
function drawWeightChart() {
  const canvas = $('#weight-chart');
  if (!canvas) return;
  const data = descending(records('weight_logs'),'log_date').reverse();
  chart = new window.Chart(canvas,{
    type:'line',
    data:{labels:data.map(row=>formatDay(row.log_date)),datasets:[{
      label:'Weight (kg)',data:data.map(row=>Number(row.weight_kg)),borderColor:'#be185d',
      backgroundColor:'#f472b628',fill:true,tension:.32,pointRadius:3
    }]},
    options:{responsive:true,maintainAspectRatio:false,animation:false,
      plugins:{legend:{display:false}},scales:{y:{title:{display:true,text:'kg'}}}}
  });
}

function teachingWeek() {
  const start = monday(state.calendarDay);
  const end = shiftDay(start,6);
  const classes = records('teaching_classes').flatMap(row=>{
    const day = shiftDay(start,row.weekday - 1);
    if (row.active_from && day < row.active_from || row.active_until && day > row.active_until) return [];
    return [{row,day,time:malaysiaTimestamp(day + 'T' + row.start_time.slice(0,5)),
      key:'regular_class_id'}];
  });
  const replacements = records('replacement_classes').flatMap(row=>{
    if (!row.scheduled_start_at || row.status === 'needs_rescheduling') return [];
    const day = localDateTime(row.scheduled_start_at).slice(0,10);
    return day >= start && day <= end ?
      [{row,day,time:row.scheduled_start_at,key:'replacement_class_id'}] : [];
  });
  return {start,end,classes,replacements};
}
function checklistCard(week) {
  const node = card('Pre-class checklist','✓','blue',addButton('pre_class_checklist_items'));
  const lessons = [...week.classes,...week.replacements].sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  const selected = lessons.find(lesson=>lesson.row.id === state.lesson) || lessons[0];
  const items = active('pre_class_checklist_items').sort((a,b)=>a.sort_order-b.sort_order);
  if (selected) {
    const label = element('label','','Lesson');
    const select = element('select');
    for (const lesson of lessons) {
      const title = lesson.row.title || lesson.row.student_name + ' · Replacement';
      const option = element('option','',formatDay(lesson.day) + ' · ' + localDateTime(lesson.time).slice(11) + ' · ' + title);
      option.value = lesson.row.id;
      select.append(option);
    }
    select.value = selected.row.id;
    select.addEventListener('change',()=>{state.lesson = select.value;render();});
    label.append(select);
    node.append(label);
  } else {
    node.append(element('p','empty','Add a regular or scheduled replacement class to check off items for a lesson.'));
  }
  if (!items.length) node.append(element('p','empty',features.pre_class_checklist_items.empty));
  for (const item of items) {
    const content = element('label','check');
    if (selected) {
      const existing = records('pre_class_checklist_checks').find(row => row.item_id === item.id &&
        row[selected.key] === selected.row.id && Date.parse(row.lesson_start_at) === Date.parse(selected.time));
      const checkbox = element('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!existing;
      checkbox.addEventListener('change',async () => {
        checkbox.disabled = true;
        const saved = await mutate({table:'pre_class_checklist_checks',row:existing,remove:!!existing,
          values:{item_id:item.id,[selected.key]:selected.row.id,lesson_start_at:selected.time}});
        if (!saved) checkbox.checked = !!existing;
        checkbox.disabled = false;
      });
      content.append(checkbox);
    }
    content.append(item.label);
    node.append(group('row',content,group('controls',
      button('Edit',()=>openEditor('pre_class_checklist_items',item)),
      button('Archive',()=>mutate({table:'pre_class_checklist_items',row:item,
        values:{archived_at:new Date().toISOString()}})))));
  }
  return node;
}
function teachingSection() {
  const week = teachingWeek();
  const classes = [...week.classes].sort((a,b)=>Date.parse(a.time) - Date.parse(b.time));
  const timetable = card('Weekly timetable','▦','blue',addButton('teaching_classes'));
  const weekMove = delta => {state.calendarDay = shiftDay(week.start,delta*7);render();};
  timetable.append(group('calendar-head',button('Previous',()=>weekMove(-1)),
    element('strong','',formatDay(week.start) + ' – ' + formatDay(week.end)),
    button('Next',()=>weekMove(1))));
  addRows(timetable,'teaching_classes',classes.map(lesson=>lesson.row));
  const outOfWeek = records('teaching_classes').filter(row=>!classes.some(item=>item.row.id === row.id));
  if (outOfWeek.length) {
    const details = element('details');
    details.append(element('summary','muted','Other recurring classes'));
    addRows(details,'teaching_classes',outOfWeek);
    timetable.append(details);
  }

  const replacements = descending(records('replacement_classes'),'missed_date')
    .sort((a,b)=>Object.keys(replacementStatus).indexOf(a.status)-Object.keys(replacementStatus).indexOf(b.status));
  const roster = listCard('students',active('students'),'blue',undefined,row=>({
    deleteEntry:false,
    tools:[
      button('Log lesson',()=>openEditor('student_lesson_notes',null,{defaults:{student_id:row.id}})),
      button(state.roster === row.id ? 'All notes' : 'View notes',()=>{state.roster = state.roster === row.id ? '' : row.id;render();}),
      button('Archive',()=>mutate({table:'students',row,values:{archived_at:new Date().toISOString()}}))
    ]
  }));
  const archived = newest(records('students')).filter(row=>row.archived_at);
  if (archived.length) {
    const details = element('details');
    details.append(element('summary','muted','Archived students'));
    addRows(details,'students',archived,row=>({deleteEntry:false,tools:[
      button('Restore',()=>mutate({table:'students',row,values:{archived_at:null}}))
    ]}));
    roster.append(details);
  }
  const notes = descending(records('student_lesson_notes'),'lesson_date').filter(row=>!state.roster || row.student_id === state.roster);
  const notesCard = listCard('student_lesson_notes',notes,'blue',{defaults:{student_id:state.roster}});
  if (state.roster) notesCard.append(button('Show notes for all students',()=>{state.roster = '';render();}));
  return section('Teaching',timetable,listCard('replacement_classes',replacements,'coral'),roster,notesCard,checklistCard(week));
}

const timerDurations = {focus:1500,break:300};
function timerSeconds(row) {
  if (row?.timer_ends_at) return Math.max(0,Math.ceil((Date.parse(row.timer_ends_at) - Date.now()) / 1000));
  return row?.paused_seconds ?? timerDurations[row?.timer_phase || 'focus'];
}
function paintTimer() {
  if (!timerLabel?.isConnected) return;
  const time = timerSeconds(records('dev_workspace')[0]);
  timerLabel.textContent = String(Math.floor(time / 60)).padStart(2,'0') + ':' + String(time % 60).padStart(2,'0');
}
function timerCard() {
  const row = records('dev_workspace')[0];
  const phase = row?.timer_phase || 'focus';
  const next = phase === 'focus' ? 'break' : 'focus';
  const running = !!row?.timer_ends_at;
  const saveTimer = values => mutate({table:'dev_workspace',row,values,conflict:'singleton'});
  const node = card('Pomodoro','◷','rose');
  timerLabel = element('p','timer');
  timerLabel.setAttribute('role','timer');
  node.append(element('p','muted',phase === 'focus' ? 'Focus · 25 minutes' : 'Break · 5 minutes'),timerLabel,
    group('controls',
      button(running ? 'Pause' : row?.paused_seconds ? 'Resume' : 'Start',()=>{
        const seconds = timerSeconds(row);
        if (running) {
          return saveTimer({timer_ends_at:null,paused_seconds:seconds || null,
            timer_phase:seconds ? phase : next});
        }
        return saveTimer({timer_ends_at:new Date(Date.now() + seconds*1000).toISOString(),paused_seconds:null});
      },'primary'),
      button('Reset',()=>saveTimer({timer_ends_at:null,paused_seconds:null})),
      button(next === 'break' ? 'Switch to break' : 'Switch to focus',
        ()=>saveTimer({timer_phase:next,timer_ends_at:null,paused_seconds:null}))));
  return node;
}
function devSection() {
  const row = records('dev_workspace')[0];
  const parking = card('Parking lot','✎','',button(row?.parking_lot_note ? 'Edit' : '+ Add',
    ()=>openEditor('dev_workspace',row),'primary'));
  parking.append(element('p',row?.parking_lot_note ? 'parking-note' : 'empty',
    row?.parking_lot_note || features.dev_workspace.empty));
  const experiments = descending(records('weekly_experiments'),'week_start');
  return section('Dev & AI',timerCard(),parking,listCard('dev_daily_wins',descending(records('dev_daily_wins'),'win_date'),'rose'),
    listCard('learning_radar'),listCard('weekly_experiments',experiments));
}

function render() {
  renderDate();
  renderStatus();
  chart?.destroy();
  chart = null;
  timerLabel = null;
  const sections = $('#sections');
  const tabs = $('#areas');
  tabs.replaceChildren();
  $('#focus').replaceChildren();
  $('#capture').replaceChildren();
  sections.replaceChildren();
  if (!state.user || !state.loaded) return;
  for (const [area,label] of Object.entries(areas)) {
    const tab = button(label,()=>{
      state.area = area;
      render();
      tabs.querySelector('[aria-pressed="true"]')?.focus();
    });
    tab.setAttribute('aria-pressed',String(state.area === area));
    tabs.append(tab);
  }
  renderPinned();
  const tasks = [...areaRows('tasks')].sort((a,b)=>
    Number(a.status==='completed')-Number(b.status==='completed') ||
    b.priority-a.priority ||
    (a.due_at || '9999').localeCompare(b.due_at || '9999') ||
    b.created_at.localeCompare(a.created_at));
  const taskCard = listCard('tasks',tasks,'rose');
  taskCard.classList.add('wide');
  sections.append(section('Planner',taskCard,calendarCard()));
  if (state.area === 'all' || state.area === 'personal') sections.append(personalSection());
  if (state.area === 'all' || state.area === 'teaching') sections.append(teachingSection());
  if (state.area === 'all' || state.area === 'dev_ai') sections.append(devSection());
  drawWeightChart();
  paintTimer();
}

renderDate();
if (db) {
  $('#login-status').textContent = 'Checking your session…';
  db.auth.onAuthStateChange((_event,session) => {
    const user = session?.user || null;
    // Run Data API requests after the auth callback releases its lock.
    window.setTimeout(() => {
      if (_event === 'INITIAL_SESSION') $('#login-status').textContent = '';
      sessionChanged(user);
    },0);
  });
} else {
  $('#login-status').textContent = 'The sign-in library could not load. Reconnect and reload to sign in.';
  $('#login-form button').disabled = true;
}

function refreshWhenVisible() {
  if (document.visibilityState === 'visible' && state.user && !state.writing) void sync();
}
document.addEventListener('visibilitychange',refreshWhenVisible);
window.addEventListener('online',refreshWhenVisible);
window.setInterval(refreshWhenVisible,30000);
window.setInterval(() => {
  if (today() !== state.day) {
    if (state.calendarDay === state.day) state.calendarDay = today();
    state.day = today();
    render();
  }
  paintTimer();
  document.querySelectorAll('[data-trigger]').forEach(paintTaskReminder);
},1000);

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js').catch(error => console.warn('PWA setup failed:',error.message));
}
